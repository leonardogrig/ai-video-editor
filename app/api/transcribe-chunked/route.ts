import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import {
  supportedLanguages,
  languageToISOCode,
} from "@/app/constants/languages";
import { resolveProvider } from "@/app/services/transcriptionProviders";

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

export const runtime = "nodejs";
export const maxDuration = 3600;

const CONCURRENCY = 8;
const TRANSCRIBE_TIMEOUT_MS = 60_000;
const FFMPEG_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

const withTimeout = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      }
    );
  });

async function checkFFmpegAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("ffmpeg -version", (error) => resolve(!error));
  });
}

interface SpeechSegment {
  start: number;
  end: number;
  text?: string;
  error?: string;
  skipped?: boolean;
}

async function cleanupTempFiles(filePaths: string[]) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        await unlinkAsync(filePath);
      }
    } catch (e) {
      console.warn(`Failed to delete temp file: ${filePath}`, e);
    }
  }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendProgressUpdate = async (data: any) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

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
        provider: providerId = "groq",
      } = body;
      const provider = resolveProvider(providerId);

      if (!filePath || !fileName || !segmentsRaw) {
        await sendProgressUpdate({
          type: "error",
          message: "Missing video file path or segments data",
        });
        return;
      }

      if (!fs.existsSync(filePath)) {
        await sendProgressUpdate({
          type: "error",
          message: "Video file not found on server",
        });
        return;
      }

      const normalizedLanguage = (language as string).toLowerCase();
      if (!supportedLanguages.includes(normalizedLanguage)) {
        await sendProgressUpdate({
          type: "error",
          message: "Unsupported language specified",
          supportedLanguages,
        });
        return;
      }

      const languageCode = languageToISOCode[normalizedLanguage] || "en";
      const segments = (
        typeof segmentsRaw === "string" ? JSON.parse(segmentsRaw) : segmentsRaw
      ) as SpeechSegment[];

      if (!Array.isArray(segments) || segments.length === 0) {
        await sendProgressUpdate({
          type: "error",
          message: "Invalid segments data",
        });
        return;
      }

      await sendProgressUpdate({
        type: "status",
        status: "starting",
        message: "Starting transcription process...",
        totalSegments: segments.length,
      });

      const isFFmpegAvailable = await checkFFmpegAvailability();
      if (!isFFmpegAvailable) {
        await sendProgressUpdate({
          type: "error",
          message: "FFmpeg is not installed or not in your system PATH",
        });
        return;
      }

      if (!provider.isConfigured()) {
        await sendProgressUpdate({
          type: "error",
          message: `${provider.label} is not configured. Please add ${provider.envVarName} to your environment variables.`,
        });
        return;
      }

      const baseName = path.parse(fileName).name;
      const audioSourcePath = path.join(
        process.cwd(),
        "public",
        "temp",
        `${baseName}.wav`
      );

      if (!fs.existsSync(audioSourcePath)) {
        await sendProgressUpdate({
          type: "status",
          status: "extracting",
          message:
            "Pre-extracting audio from video (one-time cost, reused across all segments)...",
        });
        const publicTempDir = path.join(process.cwd(), "public", "temp");
        if (!fs.existsSync(publicTempDir)) {
          fs.mkdirSync(publicTempDir, { recursive: true });
        }
        await withTimeout(
          execAsync(
            `ffmpeg -y -i "${filePath}" -vn -ac 1 -ar 16000 -c:a pcm_s16le "${audioSourcePath}"`
          ),
          10 * 60_000,
          "Audio extraction timed out"
        );
      }

      const validSegments = segments.filter(
        (segment) => segment.end - segment.start >= 0.1
      );

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
          message:
            "No valid segments to transcribe - all segments are too short (< 0.1s)",
        });
        return;
      }

      await sendProgressUpdate({
        type: "batch_info",
        batchSize: CONCURRENCY,
        message: `Running ${CONCURRENCY} transcriptions in parallel`,
      });

      const results: SpeechSegment[] = new Array(validSegments.length);
      let completedCount = 0;

      const processSegment = async (
        segment: SpeechSegment,
        index: number
      ): Promise<SpeechSegment> => {
        const { start, end } = segment;
        const duration = end - start;

        await sendProgressUpdate({
          type: "segment_processing",
          segmentIndex: index,
          currentSegment: index + 1,
          totalSegments: validSegments.length,
          percent: Math.round(
            ((completedCount + 1) / validSegments.length) * 100
          ),
          segmentInfo: {
            start: start.toFixed(2),
            end: end.toFixed(2),
            duration: duration.toFixed(2),
          },
          message: `Processing segment ${index + 1}/${validSegments.length}: ${start.toFixed(2)}s to ${end.toFixed(2)}s`,
        });

        if (duration < 0.1) {
          return { ...segment, text: "No speech detected", skipped: true };
        }

        const segmentPath = path.join(
          tempDir,
          `segment_${process.pid}_${Date.now()}_${index}.mp3`
        );
        tempFiles.push(segmentPath);

        try {
          // Fast-seek on the pre-extracted PCM WAV (`-ss` before `-i` is
          // constant-time for PCM). Re-encode to MP3: self-syncing frame
          // headers are robust to server-side parsing, unlike stream-copied
          // WAV which can have RIFF-size quirks.
          await withTimeout(
            execAsync(
              `ffmpeg -y -ss ${start} -i "${audioSourcePath}" -t ${duration} -c:a libmp3lame -q:a 4 "${segmentPath}"`
            ),
            FFMPEG_TIMEOUT_MS,
            `FFmpeg slice timed out for segment ${index + 1}`
          );

          if (
            !fs.existsSync(segmentPath) ||
            fs.statSync(segmentPath).size < 512
          ) {
            return {
              ...segment,
              text: "No speech detected",
              error: "Audio segment too small for transcription",
            };
          }

          let lastErr: any;
          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              const { text: transcriptionText } = await withTimeout(
                provider.transcribe({ filePath: segmentPath, languageCode }),
                TRANSCRIBE_TIMEOUT_MS,
                `Transcription timed out for segment ${index + 1}`
              );

              await sendProgressUpdate({
                type: "segment_complete",
                segmentIndex: index,
                currentSegment: index + 1,
                totalSegments: validSegments.length,
                result: transcriptionText,
                segment: { ...segment, text: transcriptionText },
                message: `Completed segment ${index + 1}/${validSegments.length}`,
              });

              return { ...segment, text: transcriptionText };
            } catch (err: any) {
              lastErr = err;
              const status =
                err?.status ??
                err?.response?.status ??
                err?.cause?.status;
              const msg = String(err?.message || "");
              const isRateLimited =
                status === 429 || /rate.?limit/i.test(msg);
              const isTransient =
                status === 500 ||
                status === 502 ||
                status === 503 ||
                status === 504;
              if (
                (isRateLimited || isTransient) &&
                attempt < MAX_RETRIES
              ) {
                const backoff = Math.min(
                  30_000,
                  1000 * Math.pow(2, attempt) + Math.random() * 500
                );
                await new Promise((r) => setTimeout(r, backoff));
                continue;
              }
              throw err;
            }
          }
          throw lastErr;
        } catch (error) {
          const rawMessage =
            error instanceof Error ? error.message : String(error);
          let errorMessage = rawMessage || "Failed to transcribe";
          if (/could not be decoded|decode/i.test(rawMessage))
            errorMessage = `Audio format incompatible with ${provider.label}`;
          else if (/too short|duration too short/i.test(rawMessage))
            errorMessage = "Audio segment too short for transcription";
          else if (/timed out/i.test(rawMessage))
            errorMessage = "Transcription request timed out";
          else if (/authenticate|authentication|API key|401/i.test(rawMessage))
            errorMessage = `Invalid ${provider.label} API key or authentication error`;
          else if (/rate.?limit|429/i.test(rawMessage))
            errorMessage = `${provider.label} API rate limit exceeded`;

          console.error(
            `[transcribe-chunked] segment ${index + 1} (${segment.start}-${segment.end}s) failed:`,
            rawMessage
          );

          await sendProgressUpdate({
            type: "segment_error",
            segmentIndex: index,
            currentSegment: index + 1,
            totalSegments: validSegments.length,
            error: errorMessage,
            message: `Error on segment ${index + 1}: ${errorMessage}`,
          });

          return { ...segment, text: "", error: errorMessage };
        }
      };

      // Worker-pool concurrency: CONCURRENCY workers drain a shared index.
      let nextIdx = 0;
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (true) {
          const idx = nextIdx++;
          if (idx >= validSegments.length) return;
          const result = await processSegment(validSegments[idx], idx);
          results[idx] = result;
          completedCount++;
          await sendProgressUpdate({
            type: "progress",
            completedCount,
            totalCount: validSegments.length,
            percent: Math.round(
              (completedCount / validSegments.length) * 100
            ),
            message: `Completed ${completedCount}/${validSegments.length}`,
          });
        }
      });
      await Promise.all(workers);

      const processedSegments = results.filter(Boolean);
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
        languageCode,
        message: `Transcription complete. Processed ${processedSegments.length} of ${segments.length} segments.`,
      });

      await cleanupTempFiles(tempFiles);
    } catch (error) {
      await sendProgressUpdate({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to transcribe video. An unknown error occurred.",
      });
      try {
        await cleanupTempFiles(tempFiles);
      } catch (cleanupError) {
        console.error("Error during cleanup:", cleanupError);
      }
    } finally {
      try {
        await writer.close();
      } catch {
        /* writer may already be closed */
      }
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
