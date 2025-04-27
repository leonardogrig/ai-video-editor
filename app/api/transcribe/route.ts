import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { supportedLanguages, languageToISOCode } from '@/app/constants/languages';

const execAsync = promisify(exec);
const unlinkAsync = promisify(fs.unlink);

// Configuration for the API route
export const config = {
  api: {
    responseLimit: false,
    bodyParser: {
      sizeLimit: Infinity // No size limit for local development
    }
  },
};

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Add a timeout wrapper for promises
const withTimeout = (promise: Promise<any>, timeoutMs: number, errorMessage: string) => {
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
    exec('ffmpeg -version', (error) => {
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
  // Create a TransformStream for sending progress updates
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  // Helper to send progress updates through the stream
  const sendProgressUpdate = async (data: any) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };
  
  // Set a global timeout for the entire request (30 minutes max)
  const globalTimeoutId = setTimeout(async () => {
    console.error("Global timeout reached for transcription request");
    await sendProgressUpdate({ type: 'error', message: "Global timeout reached" });
    await writer.close();
  }, 30 * 60 * 1000); // 30 minutes for large videos
  
  // Track created files for cleanup
  const tempFiles: string[] = [];
  
  // Process in background and return stream immediately
  const processTranscription = async () => {
    try {
      // Create a temp directory for files
      const tempDir = path.join(os.tmpdir(), 'whisper-transcription');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Parse the FormData request body
      const formData = await request.formData();
      const videoFile = formData.get('videoFile') as File;
      const segmentsStr = formData.get('segments') as string;
      const language = formData.get('language') as string || 'english';
      
      if (!videoFile || !segmentsStr) {
        await sendProgressUpdate({ type: 'error', message: "Missing video file or segments data" });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }
      
      // Validate language parameter
      const normalizedLanguage = language.toLowerCase();
      if (!supportedLanguages.includes(normalizedLanguage)) {
        await sendProgressUpdate({ 
          type: 'error', 
          message: "Unsupported language specified",
          supportedLanguages: supportedLanguages 
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }
      
      // Convert to ISO-639-1 code
      const languageCode = languageToISOCode[normalizedLanguage] || 'en';
      
      // Parse segments from the string
      const segments = JSON.parse(segmentsStr);
      
      if (!Array.isArray(segments) || segments.length === 0) {
        await sendProgressUpdate({ type: 'error', message: "Invalid segments data" });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }
      
      // Initial status update
      await sendProgressUpdate({ 
        type: 'status', 
        status: 'starting',
        message: 'Starting transcription process...',
        totalSegments: segments.length
      });
      
      // Generate a unique filename to avoid collisions
      const uniquePrefix = Date.now() + '_' + Math.random().toString(36).substring(2, 10);
      const videoPath = path.join(tempDir, `${uniquePrefix}_${videoFile.name}`);
      tempFiles.push(videoPath);
      
      // Save the uploaded video file to a temporary location
      await sendProgressUpdate({ 
        type: 'status', 
        status: 'saving',
        message: 'Saving uploaded video file...' 
      });
      
      const videoBytes = await videoFile.arrayBuffer();
      const videoBuffer = Buffer.from(videoBytes);
      fs.writeFileSync(videoPath, videoBuffer);
      
      // Check FFmpeg availability
      await sendProgressUpdate({ 
        type: 'status', 
        status: 'checking', 
        message: 'Checking FFmpeg availability...' 
      });
      
      const isFFmpegAvailable = await checkFFmpegAvailability();
      if (!isFFmpegAvailable) {
        await sendProgressUpdate({ 
          type: 'error', 
          message: "FFmpeg is not installed or not in your system PATH",
          installationInstructions: {
            windows: "1. Download FFmpeg from https://ffmpeg.org/download.html (select Windows builds)\n2. Extract the ZIP file to a folder (e.g., C:\\ffmpeg)\n3. Add FFmpeg to PATH:\n   - Right-click on 'This PC' and select 'Properties'\n   - Click on 'Advanced system settings'\n   - Click 'Environment Variables'\n   - Under System Variables, find 'Path' and click 'Edit'\n   - Click 'New' and add the path to ffmpeg's bin folder (e.g., C:\\ffmpeg\\bin)\n   - Click 'OK' on all dialogs\n4. Restart your computer\n5. Open a new command prompt and verify by typing: ffmpeg -version",
            mac: "Install with Homebrew: brew install ffmpeg",
            linux: "Install with apt: sudo apt install ffmpeg\nor\nInstall with yum: sudo yum install ffmpeg"
          }
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        await cleanupTempFiles(tempFiles);
        return;
      }

      if (!isGroqConfigured()) {
        await sendProgressUpdate({ 
          type: 'error', 
          message: "Groq API key is not configured. Please add GROQ_API_KEY to your environment variables."
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        return;
      }

      // Process each segment
      const transcribedSegments: SpeechSegment[] = [];
      console.log(`Processing ${segments.length} segments for transcription...`);
      
      await sendProgressUpdate({ 
        type: 'status', 
        status: 'filtering',
        message: 'Filtering segments by duration...' 
      });

      // First, filter out segments that are too short (minimum 0.1s required by Whisper)
      const validSegments = segments.filter(segment => {
        const duration = segment.end - segment.start;
        if (duration < 0.1) {
          console.log(`Skipping segment that's too short: ${segment.start.toFixed(2)}s to ${segment.end.toFixed(2)}s (${duration.toFixed(2)}s)`);
          return false;
        }
        return true;
      });

      console.log(`Found ${validSegments.length} valid segments out of ${segments.length} total`);
      
      await sendProgressUpdate({ 
        type: 'status', 
        status: 'filtered',
        validSegments: validSegments.length,
        totalSegments: segments.length,
        message: `Found ${validSegments.length} valid segments out of ${segments.length} total` 
      });
      
      if (validSegments.length === 0) {
        await sendProgressUpdate({ 
          type: 'error', 
          message: "No valid segments to transcribe - all segments are too short (< 0.1s)" 
        });
        await writer.close();
        clearTimeout(globalTimeoutId);
        await cleanupTempFiles(tempFiles);
        return;
      }

      // Limit to max segments and add parallel processing
      // For local development, allow for much larger number of segments
      const maxSegments = 100; // Increased from 30 to 100 for local use
      const segmentsToProcess = validSegments.length > maxSegments 
        ? validSegments.slice(0, maxSegments) 
        : validSegments;
      
      if (segmentsToProcess.length < validSegments.length) {
        console.log(`Limiting to ${maxSegments} segments out of ${validSegments.length} total valid segments to prevent timeout`);
        await sendProgressUpdate({ 
          type: 'warning', 
          message: `Limiting to ${maxSegments} segments out of ${validSegments.length} total valid segments to prevent timeout` 
        });
      }

      // Define a helper function to process a single segment
      const processSegment = async (segment: SpeechSegment, index: number): Promise<SpeechSegment> => {
        const { start, end } = segment;
        const duration = end - start;
        
        console.log(`Processing segment ${index + 1}/${segmentsToProcess.length}: ${start}s to ${end}s (duration: ${duration.toFixed(2)}s)`);
        
        // Send progress update to client with fixed segment numbers
        // Note: We use index+1 consistently rather than inferring from batch progress
        // for consistent progress updates
        await sendProgressUpdate({ 
          type: 'segment_processing', 
          segmentIndex: index,
          currentSegment: index + 1,
          totalSegments: segmentsToProcess.length,
          percent: Math.round(((index + 1)/segmentsToProcess.length)*100),
          segmentInfo: {
            start: start.toFixed(2),
            end: end.toFixed(2),
            duration: duration.toFixed(2)
          },
          message: `Processing segment ${index + 1}/${segmentsToProcess.length}: ${start.toFixed(2)}s to ${end.toFixed(2)}s` 
        });
        
        // Skip segments that are too short
        if (duration < 0.1) {
          console.log(`Segment too short, skipping: ${duration.toFixed(2)}s`);
          return {
            ...segment,
            text: ""
          };
        }
        
        // Create temp file for the segment with unique name - use MP3 format for better compatibility with Groq
        const segmentPath = path.join(tempDir, `segment_${uniquePrefix}_${index}.mp3`);
        tempFiles.push(segmentPath);
        
        try {
          // Send progress update for extraction step
          await sendProgressUpdate({
            type: 'status',
            segmentIndex: index,
            status: 'extracting',
            currentSegment: index + 1,
            totalSegments: segmentsToProcess.length,
            message: `Extracting audio for segment ${index + 1}/${segmentsToProcess.length}`
          });
          
          // Extract segment audio using ffmpeg with enhanced audio processing - output to MP3
          await withTimeout(
            execAsync(`ffmpeg -i "${videoPath}" -ss ${start} -t ${duration} -ar 16000 -ac 1 -af "volume=2.0,highpass=f=200,lowpass=f=3000,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a libmp3lame -q:a 2 "${segmentPath}"`),
            60000, // 60 second timeout for extraction
            `FFmpeg extraction timed out for segment ${index+1}`
          );
          
          // Check if the file exists and has content
          if (!fs.existsSync(segmentPath) || fs.statSync(segmentPath).size === 0) {
            console.error(`Error: Generated segment file is empty or doesn't exist`);
            await sendProgressUpdate({
              type: 'segment_error',
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              message: `Error: Failed to extract audio for segment ${index + 1}`
            });
            return {
              ...segment,
              text: "",
              error: "Failed to extract audio segment"
            };
          }
          
          const fileSizeBytes = fs.statSync(segmentPath).size;
          console.log(`Segment ${index+1} extracted successfully. File size: ${(fileSizeBytes/1024).toFixed(2)} KB`);
          
          // Skip segments that are too small for Whisper
          if (fileSizeBytes < 1024) {
            console.log(`Segment ${index+1} file too small (${(fileSizeBytes/1024).toFixed(2)} KB), skipping transcription`);
            await sendProgressUpdate({
              type: 'segment_warning',
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              message: `Skipping segment ${index + 1}: audio file too small for transcription`
            });
            return {
              ...segment,
              text: "",
              error: "Audio segment too small for transcription"
            };
          }
          
          // Use Groq API for transcription with proper file handling
          try {
            console.log(`Sending segment ${index+1} to Groq API for transcription...`);
            
            // Update with transcription step
            await sendProgressUpdate({
              type: 'status',
              segmentIndex: index,
              status: 'transcribing',
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              message: `Transcribing audio for segment ${index + 1}/${segmentsToProcess.length}`
            });

            // Ensure the file exists before attempting to read it
            if (!fs.existsSync(segmentPath)) {
              throw new Error(`File ${segmentPath} does not exist`);
            }

            // Log client configuration and file info
            console.log(`API configuration: Using Groq API with key ${process.env.GROQ_API_KEY ? 'configured' : 'missing'}`);
            console.log(`File path: ${segmentPath}, size: ${(fs.statSync(segmentPath).size / 1024).toFixed(2)} KB`);
            
            // Open the file for reading as a stream for the Groq API
            const fileStream = fs.createReadStream(segmentPath);
            
            const transcription = await withTimeout(
              groq.audio.transcriptions.create({
                file: fileStream,
                model: "distil-whisper-large-v3-en",
                response_format: "verbose_json",
                temperature: 0.0, // Use lowest temperature for most accurate transcription
              }),
              30000, // 30 second timeout
              `Transcription timed out for segment ${index+1}`
            );
            
            // Close the file stream after use
            fileStream.close();
            
            // Extract the transcript text from Groq's response
            const transcriptionText = transcription.text?.trim() || "";
            
            // Log successful transcription with more details
            console.log(`Groq API response received for segment ${index+1}:`);
            console.log(`  - Text: "${transcriptionText.substring(0, 100)}${transcriptionText.length > 100 ? '...' : ''}"`);
            console.log(`  - Text length: ${transcriptionText.length} characters`);
            
            // Send transcription result update
            await sendProgressUpdate({
              type: 'segment_complete',
              segmentIndex: index,
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              result: transcriptionText,
              segment: {
                ...segment,
                text: transcriptionText
              },
              message: `Completed segment ${index + 1}/${segmentsToProcess.length}`
            });
            
            return {
              ...segment,
              text: transcriptionText
            };
          } catch (error) {
            // Handle transcription errors
            console.error(`Error transcribing segment ${index + 1}:`, error);
            
            let errorMessage = "Failed to transcribe";
            if (error instanceof Error) {
              console.error(`Error type: ${error.name}`);
              console.error(`Error message: ${error.message}`);
              
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
              type: 'segment_error',
              currentSegment: index + 1,
              totalSegments: segmentsToProcess.length,
              error: errorMessage,
              message: `Error transcribing segment ${index + 1}: ${errorMessage}`
            });
            
            return {
              ...segment,
              text: "",
              error: errorMessage
            };
          }
        } catch (error) {
          // Handle extraction errors
          console.error(`Error extracting segment ${index + 1}:`, error);
          
          let errorMsg = "Failed to extract audio segment";
          if (error instanceof Error && error.message.includes("timed out")) {
            errorMsg = "FFmpeg extraction timed out";
          }
          
          await sendProgressUpdate({
            type: 'segment_error',
            currentSegment: index + 1,
            totalSegments: segmentsToProcess.length,
            error: errorMsg,
            message: `Error with segment ${index + 1}: ${errorMsg}`
          });
          
          return {
            ...segment,
            text: "",
            error: errorMsg
          };
        }
      };

      // Process segments in parallel with a controlled batch size
      const BATCH_SIZE = 3; // Process 3 segments at a time
      const processedSegments: SpeechSegment[] = [];
      
      // Send batch processing info
      await sendProgressUpdate({
        type: 'batch_info',
        batchSize: BATCH_SIZE,
        message: `Processing segments in batches of ${BATCH_SIZE} for better performance`
      });
      
      // Process in batches
      for (let i = 0; i < segmentsToProcess.length; i += BATCH_SIZE) {
        const batch = segmentsToProcess.slice(i, i + BATCH_SIZE);
        const batchStartIndex = i;
        
        await sendProgressUpdate({
          type: 'batch_start',
          batchNumber: Math.floor(i / BATCH_SIZE) + 1,
          totalBatches: Math.ceil(segmentsToProcess.length / BATCH_SIZE),
          startSegment: i + 1,
          endSegment: Math.min(i + BATCH_SIZE, segmentsToProcess.length),
          message: `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(segmentsToProcess.length / BATCH_SIZE)}`
        });
        
        // Process this batch in parallel - map each segment to a promise
        const batchPromises = batch.map((segment, index) => {
          // Return an object with the segment and its processing promise
          return {
            index: batchStartIndex + index,
            promise: processSegment(segment, batchStartIndex + index)
          };
        });
        
        // Wait for all promises to settle (both fulfilled and rejected)
        const results = await Promise.allSettled(batchPromises.map(item => item.promise));
        
        // Process results and push them to processedSegments in the correct order
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled') {
            processedSegments.push(result.value);
          } else {
            // If there was an error, add a placeholder with error info
            processedSegments.push({
              ...batch[j],
              text: "",
              error: "Failed to process segment"
            });
          }
        }
      }

      // Fill in any missing segments with empty text
      const allSegments = segments.map(segment => {
        // Check if this segment was processed
        const processed = processedSegments.find(
          s => s.start === segment.start && s.end === segment.end
        );
        
        if (processed) {
          return processed;
        } else {
          // If not processed (too short, skipped, or beyond limit), add with empty text
          return {
            ...segment,
            text: "",
            skipped: true
          };
        }
      });

      // Send the final complete message with all segments
      await sendProgressUpdate({
        type: 'complete',
        segments: allSegments,
        processedCount: processedSegments.length,
        totalCount: segments.length,
        language: normalizedLanguage,
        languageCode: languageCode,
        message: `Transcription complete. Processed ${processedSegments.length} of ${segments.length} segments.`
      });
      
      // Clean up the temp files asynchronously after response is sent
      await cleanupTempFiles(tempFiles);

    } catch (error) {
      // Send error message
      if (error instanceof Error) {
        await sendProgressUpdate({ 
          type: 'error', 
          message: error.message || 'Failed to transcribe video' 
        });
      } else {
        await sendProgressUpdate({ 
          type: 'error', 
          message: 'Failed to transcribe video. An unknown error occurred.' 
        });
      }
      
      // Try to clean up temp files even on error
      try {
        await cleanupTempFiles(tempFiles);
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
      
      console.error('Failed to transcribe:', error);
    } finally {
      // Clear the global timeout and close the stream
      clearTimeout(globalTimeoutId);
      await writer.close();
    }
  };

  // Start the background process
  processTranscription();

  // Return the stream response immediately
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

// Helper function to clean up temp files asynchronously
async function cleanupTempFiles(filePaths: string[]) {
  for (const filePath of filePaths) {
    try {
      if (fs.existsSync(filePath)) {
        // For Windows, attempt to wait a moment before deleting to allow handles to be released
        await new Promise(resolve => setTimeout(resolve, 100));
        await unlinkAsync(filePath);
        console.log(`Successfully deleted temp file: ${filePath}`);
      }
    } catch (e) {
      console.warn(`Failed to delete temp file: ${filePath}`, e);
      // Continue with other files even if one fails to delete
    }
  }
} 