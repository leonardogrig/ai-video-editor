import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { supportedLanguages, languageToISOCode } from '@/app/constants/languages';

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// Configuration for the API route
export const config = {
  api: {
    responseLimit: false,
  },
};

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Add a timeout wrapper for promises
const withTimeout = (
  promise: Promise<any>,
  timeoutMs: number,
  errorMessage: string
) => {
  // Create a promise that rejects in <timeoutMs> milliseconds
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  // Returns a race between the timeout and the passed promise
  return Promise.race([promise, timeoutPromise]);
};

// Check for FFmpeg availability at the start
async function checkFFmpegAvailability() {
  return new Promise<boolean>((resolve) => {
    exec("ffmpeg -version", (error) => {
      resolve(!error);
    });
  });
}

// Define interfaces for the segment types
interface SpeechSegment {
  start: number;
  end: number;
  text?: string;
  error?: string;
  skipped?: boolean;
}

// Add a function to check if Groq is properly configured
function isGroqConfigured() {
  return !!process.env.GROQ_API_KEY;
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendProgressUpdate = async (data: any) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  const globalTimeoutId = setTimeout(async () => {
    console.error("Global timeout reached for transcription request");
    await sendProgressUpdate({
      type: "error",
      message: "Global timeout reached",
    });
    await writer.close();
  }, 30 * 60 * 1000);

  const tempFiles: string[] = [];

  const processTranscription = async () => {
    try {
      const tempDir = path.join(os.tmpdir(), "whisper-transcription");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const body = await request.json();
      const {
        filePath,
        fileName,
        segments: segmentsRaw,
        language = "english",
      } = body;

      if (!filePath || !fileName || !segmentsRaw) {
        await sendProgressUpdate({
          type: "error",
          message: "Missing video file path or segments data",
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }

      if (!fs.existsSync(filePath)) {
        await sendProgressUpdate({
          type: "error",
          message: "Video file not found on server",
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }

      const normalizedLanguage = language.toLowerCase();
      if (!supportedLanguages.includes(normalizedLanguage)) {
        await sendProgressUpdate({
          type: "error",
          message: "Unsupported language specified",
          supportedLanguages: supportedLanguages,
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }

      const languageCode = languageToISOCode[normalizedLanguage] || "en";
      const segments = typeof segmentsRaw === "string" ? JSON.parse(segmentsRaw) : segmentsRaw;

      if (!Array.isArray(segments) || segments.length === 0) {
        await sendProgressUpdate({
          type: "error",
          message: "Invalid segments data",
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }

      await sendProgressUpdate({
        type: "status",
        status: "starting",
        message: "Starting transcription process...",
        totalSegments: segments.length,
      });

      const videoPath = filePath;
      tempFiles.push(videoPath);

      await sendProgressUpdate({
        type: "status",
        status: "checking",
        message: "Checking FFmpeg availability...",
      });

      const isFFmpegAvailable = await checkFFmpegAvailability();
      if (!isFFmpegAvailable) {
        await sendProgressUpdate({
          type: "error",
          message: "FFmpeg is not installed or not in your system PATH",
          installationInstructions: {
            windows: "1. Download FFmpeg from https://ffmpeg.org/download.html (select Windows builds)\n2. Extract the ZIP file to a folder (e.g., C:\\ffmpeg)\n3. Add FFmpeg to PATH:\n   - Right-click on 'This PC' and select 'Properties'\n   - Click on 'Advanced system settings'\n   - Click 'Environment Variables'\n   - Under System Variables, find 'Path' and click 'Edit'\n   - Click 'New' and add the path to ffmpeg's bin folder (e.g., C:\\ffmpeg\\bin)\n   - Click 'OK' on all dialogs\n4. Restart your computer\n5. Open a new command prompt and verify by typing: ffmpeg -version",
            mac: "Install with Homebrew: brew install ffmpeg",
            linux: "Install with apt: sudo apt install ffmpeg\nor\nInstall with yum: sudo yum install ffmpeg",
          },
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        await cleanupTempFiles(tempFiles);
        return;
      }

      if (!isGroqConfigured()) {
        await sendProgressUpdate({
          type: "error",
          message: "Groq API key is not configured. Please add GROQ_API_KEY to your environment variables.",
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }

      const validSegments = segments.filter((segment) => {
        const duration = segment.end - segment.start;
        return duration >= 0.1;
      });

      await sendProgressUpdate({
        type: "status",
        status: "filtered",
        validSegments: validSegments.length,
        totalSegments: segments.length,
        message: `Found ${validSegments.length} valid segments out of ${segments.length} total`,
      });

      if (validSegments.length === 0) {
        await sendProgressUpdate({
          type: "error",
          message: "No valid segments to transcribe - all segments are too short (< 0.1s)",
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        await cleanupTempFiles(tempFiles);
        return;
      }

      const segmentsToProcess = validSegments;
      const processedSegments: SpeechSegment[] = [];
      const BATCH_SIZE = 1;
      const SUPER_BATCH_SIZE = 10;
      let completedCount = 0;

      const processSegment = async (segment: SpeechSegment, index: number): Promise<SpeechSegment> => {
        const { start, end } = segment;
        const duration = end - start;

        await sendProgressUpdate({
          type: "segment_processing",
          segmentIndex: index,
          currentSegment: index + 1,
          totalSegments: segmentsToProcess.length,
          percent: Math.round(((index + 1) / segmentsToProcess.length) * 100),
          segmentInfo: {
            start: start.toFixed(2),
            end: end.toFixed(2),
            duration: duration.toFixed(2),
          },
          message: `Processing segment ${index + 1}/${segmentsToProcess.length}: ${start.toFixed(2)}s to ${end.toFixed(2)}s`,
        });

        if (duration < 0.1) {
          return {
            ...segment,
            text: "No speech detected",
            skipped: true,
          };
        }

        const segmentPath = path.join(tempDir, `segment_chunk_${index}.mp3`);
        tempFiles.push(segmentPath);

        try {
          await sendProgressUpdate({
            type: "status",
            segmentIndex: index,
            status: "extracting",
            currentSegment: index + 1,
            totalSegments: segmentsToProcess.length,
            message: `Extracting audio for segment ${index + 1}/${segmentsToProcess.length}`,
          });

          await withTimeout(
            execAsync(
              `ffmpeg -i "${videoPath}" -ss ${start} -t ${duration} -ar 16000 -ac 1 -af "volume=2.0,highpass=f=200,lowpass=f=3000,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a libmp3lame -q:a 2 "${segmentPath}"`
            ),
            60000,
            `FFmpeg extraction timed out for segment ${index + 1}`
          );

          if (!fs.existsSync(segmentPath) || fs.statSync(segmentPath).size === 0) {
            await sendProgressUpdate({
              type: "segment_error",
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              message: `Error: Failed to extract audio for segment ${index + 1}`,
            });
            return {
              ...segment,
              text: "No speech detected",
              error: "Failed to extract audio segment",
            };
          }

          const fileSizeBytes = fs.statSync(segmentPath).size;

          if (fileSizeBytes < 512) {
            try {
              await withTimeout(
                execAsync(
                  `ffmpeg -i "${videoPath}" -ss ${start} -t ${duration} -ar 16000 -ac 1 -af "volume=4.0,highpass=f=200,lowpass=f=3000,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a libmp3lame -q:a 2 "${segmentPath}"`
                ),
                30000,
                `FFmpeg extraction retry timed out for segment ${index + 1}`
              );

              const newSizeBytes = fs.statSync(segmentPath).size;

              if (newSizeBytes < 512) {
                await sendProgressUpdate({
                  type: "segment_warning",
                  currentSegment: index + 1,
                  totalSegments: segmentsToProcess.length,
                  message: `Skipping segment ${index + 1}: audio file too small for transcription even after volume boost`,
                });
                return {
                  ...segment,
                  text: "No speech detected",
                  error: "Audio segment too small for transcription",
                };
              }
            } catch (error) {
              await sendProgressUpdate({
                type: "segment_warning",
                currentSegment: index + 1,
                totalSegments: segmentsToProcess.length,
                message: `Skipping segment ${index + 1}: audio file too small for transcription`,
              });
              return {
                ...segment,
                text: "No speech detected",
                error: "Audio segment too small for transcription",
              };
            }
          }

          try {
            await sendProgressUpdate({
              type: "status",
              segmentIndex: index,
              status: "transcribing",
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              message: `Transcribing audio for segment ${index + 1}/${segmentsToProcess.length}`,
            });

            if (!fs.existsSync(segmentPath)) {
              throw new Error(`File ${segmentPath} does not exist`);
            }

            const fileStream = fs.createReadStream(segmentPath);

            const transcription = await withTimeout(
              groq.audio.transcriptions.create({
                file: fileStream,
                model: "distil-whisper-large-v3-en",
                response_format: "verbose_json",
                temperature: 0.0,
              }),
              30000,
              `Transcription timed out for segment ${index + 1}`
            );

            fileStream.close();

            const transcriptionText = transcription.text?.trim() || "";

            await sendProgressUpdate({
              type: "segment_complete",
              segmentIndex: index,
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              result: transcriptionText,
              segment: {
                ...segment,
                text: transcriptionText,
              },
              message: `Completed segment ${index + 1}/${segmentsToProcess.length}`,
            });

            return {
              ...segment,
              text: transcriptionText,
            };
          } catch (error) {
            let errorMessage = "Failed to transcribe";
            if (error instanceof Error) {
              if (error.message.includes("could not be decoded") || error.message.includes("decode")) {
                errorMessage = "Audio format incompatible with Groq API";
              } else if (error.message.includes("too short") || error.message.includes("duration too short")) {
                errorMessage = "Audio segment too short for transcription";
              } else if (error.message.includes("timed out")) {
                errorMessage = "Transcription request timed out";
              } else if (error.message.includes("authenticate") || error.message.includes("authentication") || error.message.includes("API key")) {
                errorMessage = "Invalid Groq API key or authentication error";
              } else if (error.message.includes("rate limit") || error.message.includes("rate_limit")) {
                errorMessage = "Groq API rate limit exceeded";
              }
            }

            await sendProgressUpdate({
              type: "segment_error",
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              error: errorMessage,
              message: `Error transcribing segment ${index + 1}: ${errorMessage}`,
            });

            return {
              ...segment,
              text: "",
              error: errorMessage,
            };
          }
        } catch (error) {
          let errorMsg = "Failed to extract audio segment";
          if (error instanceof Error && error.message.includes("timed out")) {
            errorMsg = "FFmpeg extraction timed out";
          }

          await sendProgressUpdate({
            type: "segment_error",
            currentSegment: index + 1,
            totalSegments: segmentsToProcess.length,
            error: errorMsg,
            message: `Error with segment ${index + 1}: ${errorMsg}`,
          });

          return {
            ...segment,
            text: "",
            error: errorMsg,
          };
        }
      };

      await sendProgressUpdate({
        type: "batch_info",
        batchSize: BATCH_SIZE,
        message: `Processing segments sequentially to avoid Groq API rate limits`,
      });

      for (let superBatchIndex = 0; superBatchIndex < Math.ceil(segmentsToProcess.length / SUPER_BATCH_SIZE); superBatchIndex++) {
        const startSegmentIndex = superBatchIndex * SUPER_BATCH_SIZE;
        const endSegmentIndex = Math.min(startSegmentIndex + SUPER_BATCH_SIZE, segmentsToProcess.length);
        const currentSuperBatch = segmentsToProcess.slice(startSegmentIndex, endSegmentIndex);

        await sendProgressUpdate({
          type: "super_batch_start",
          superBatchNumber: superBatchIndex + 1,
          totalSuperBatches: Math.ceil(segmentsToProcess.length / SUPER_BATCH_SIZE),
          startSegment: startSegmentIndex + 1,
          endSegment: endSegmentIndex,
          completedCount,
          totalCount: segmentsToProcess.length,
          percent: Math.round((completedCount / segmentsToProcess.length) * 100),
          message: `Processing segments ${startSegmentIndex + 1} to ${endSegmentIndex} of ${segmentsToProcess.length} (Completed: ${completedCount})`,
        });

        for (let i = 0; i < currentSuperBatch.length; i += BATCH_SIZE) {
          const batch = currentSuperBatch.slice(i, i + BATCH_SIZE);
          const batchStartIndex = startSegmentIndex + i;

          await sendProgressUpdate({
            type: "batch_start",
            batchNumber: Math.floor(batchStartIndex / BATCH_SIZE) + 1,
            totalBatches: Math.ceil(segmentsToProcess.length / BATCH_SIZE),
            superBatchNumber: superBatchIndex + 1,
            startSegment: batchStartIndex + 1,
            endSegment: Math.min(batchStartIndex + BATCH_SIZE, segmentsToProcess.length),
            message: `Processing batch ${Math.floor(batchStartIndex / BATCH_SIZE) + 1}/${Math.ceil(segmentsToProcess.length / BATCH_SIZE)}`,
          });

          const batchPromises = batch.map((segment, index) => ({
            index: batchStartIndex + index,
            promise: processSegment(segment, batchStartIndex + index),
          }));

          const results = await Promise.allSettled(batchPromises.map((item) => item.promise));

          for (let j = 0; j < results.length; j++) {
            const result = results[j];
            completedCount++;

            if (result.status === "fulfilled") {
              processedSegments.push(result.value);
            } else {
              processedSegments.push({
                ...batch[j],
                text: "",
                error: "Failed to process segment: " + (result.reason?.message || "Unknown error"),
              });
            }
          }

          if (i + BATCH_SIZE < currentSuperBatch.length) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        await sendProgressUpdate({
          type: "super_batch_complete",
          superBatchNumber: superBatchIndex + 1,
          totalSuperBatches: Math.ceil(segmentsToProcess.length / SUPER_BATCH_SIZE),
          completedCount,
          totalCount: segmentsToProcess.length,
          percent: Math.round((completedCount / segmentsToProcess.length) * 100),
          message: `Completed segments ${startSegmentIndex + 1} to ${endSegmentIndex} of ${segmentsToProcess.length} (Total completed: ${completedCount})`,
        });

        if (superBatchIndex + 1 < Math.ceil(segmentsToProcess.length / SUPER_BATCH_SIZE)) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      const allSegments = segments.map((segment) => {
        const processed = processedSegments.find(
          (s) => s.start === segment.start && s.end === segment.end
        );
        return processed || { ...segment, text: "", skipped: true };
      });

      await sendProgressUpdate({
        type: "complete",
        segments: allSegments,
        processedCount: processedSegments.length,
        totalCount: segments.length,
        language: normalizedLanguage,
        languageCode: languageCode,
        message: `Transcription complete. Processed ${processedSegments.length} of ${segments.length} segments.`,
      });

      await cleanupTempFiles(tempFiles.filter((file) => file !== videoPath));
    } catch (error) {
      if (error instanceof Error) {
        await sendProgressUpdate({
          type: "error",
          message: error.message || "Failed to transcribe video",
        });
      } else {
        await sendProgressUpdate({
          type: "error",
          message: "Failed to transcribe video. An unknown error occurred.",
        });
      }

      try {
        await cleanupTempFiles(tempFiles);
      } catch (cleanupError) {
        console.error("Error during cleanup:", cleanupError);
      }
    } finally {
      clearTimeout(globalTimeoutId);
      await writer.close();
    }
  };

  processTranscription();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Helper function to clean up temp files asynchronously
async function cleanupTempFiles(filePaths: string[]) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        // For Windows, attempt to wait a moment before deleting to allow handles to be released
        await new Promise((resolve) => setTimeout(resolve, 100));
        await unlinkAsync(filePath);
        console.log(`Successfully deleted temp file: ${filePath}`);
      }
    } catch (e) {
      console.warn(`Failed to delete temp file: ${filePath}`, e);
      // Continue with other files even if one fails to delete
    }
  }
}
