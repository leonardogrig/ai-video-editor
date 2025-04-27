import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as VAD from "node-vad";
import { WaveFile } from "wavefile";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

// Import types
import "@/lib/types";

// Set the ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Configuration for the API route
export const config = {
  api: {
    responseLimit: false,
  },
};

// Extract audio from video file
async function extractAudioFromVideo(
  videoPath: string,
  audioPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("pcm_s16le") // 16-bit PCM audio
      .audioChannels(1) // Mono
      .audioFrequency(16000) // Sample rate: 16kHz (required by node-vad)
      .format("wav")
      .on("error", (err: Error) => reject(err))
      .on("end", () => resolve())
      .save(audioPath);
  });
}

// Reusing the same detectSegments function from your existing process-video route...
async function detectSegments(
  audioData: Buffer,
  frameDurationMs = 30,
  paddingDurationMs = 300,
  aggressiveness = 3,
  speechPaddingMs = 50,
  volumeThreshold = 40,
  minSilenceDuration = 0,
  silencePaddingMs = 450
): Promise<object[]> {
  try {
    console.log("Starting speech detection with parameters:", {
      frameDurationMs,
      paddingDurationMs,
      aggressiveness,
      speechPaddingMs,
      volumeThreshold,
      minSilenceDuration,
      silencePaddingMs,
    });

    // Parse WAV file
    const waveFile = new WaveFile();
    waveFile.fromBuffer(new Uint8Array(audioData));

    // Ensure audio is in the correct format
    const sampleRate = waveFile.fmt.sampleRate;
    const sampleWidth = waveFile.fmt.bitsPerSample / 8; // bytes per sample
    const numChannels = waveFile.fmt.numChannels;

    console.log("Audio format:", {
      sampleRate,
      bitsPerSample: sampleWidth * 8,
      numChannels,
    });

    if (numChannels !== 1) {
      throw new Error("Audio must be mono for VAD processing");
    }

    if (![8000, 16000, 32000, 48000].includes(sampleRate)) {
      throw new Error(
        "Sample rate must be one of: 8000, 16000, 32000, 48000 Hz"
      );
    }

    // Create VAD instance with specified aggressiveness
    const vad = new VAD.default(aggressiveness);

    // Calculate frame size in samples and bytes
    const frameSize = Math.floor((sampleRate * frameDurationMs) / 1000);
    const frameBytes = frameSize * sampleWidth;

    const rawAudio = waveFile.data.samples;

    console.log("Processing audio frames:", {
      totalBytes: rawAudio.length,
      frameBytes,
      estimatedFrames: Math.floor(rawAudio.length / frameBytes),
    });

    // Split raw audio into frames
    const frames = [];
    for (let i = 0; i < rawAudio.length - frameBytes + 1; i += frameBytes) {
      const frame = rawAudio.slice(i, i + frameBytes);
      const timestamp = i / (sampleRate * sampleWidth);
      frames.push({ timestamp, frame });
    }

    // Function to calculate RMS volume of a frame
    function calculateRmsVolume(frame: Uint8Array): number {
      try {
        // Convert bytes to 16-bit samples (signed)
        const samples = [];
        for (let i = 0; i < frame.length; i += 2) {
          // Convert two bytes to a 16-bit signed integer (little-endian)
          let sample = (frame[i + 1] << 8) | frame[i]; // Corrected byte order
          // If the high bit is set, convert to negative number
          if (sample & 0x8000) {
            sample = sample - 0x10000;
          }
          samples.push(sample);
        }

        // Calculate RMS (Root Mean Square)
        let sumOfSquares = 0;
        for (const sample of samples) {
          sumOfSquares += sample * sample;
        }
        const rms = Math.sqrt(sumOfSquares / samples.length);

        return rms;
      } catch (error) {
        console.error("Error calculating frame RMS:", error);
        return 0;
      }
    }

    // Function to convert RMS value to decibels with proper reference
    function rmsToDecibels(rms: number): number {
      // 0 dB reference for 16-bit audio is 32768 (2^15)
      const MAX_16BIT_VALUE = 32768;

      if (rms <= 1) return -100; // Return a very low dB value for silence

      // Calculate dB relative to full scale (dBFS)
      const dbFS = 20 * Math.log10(rms / MAX_16BIT_VALUE);

      return dbFS;
    }

    // FIRST PASS: Analyze all frames to determine dB range
    console.log("First pass: Analyzing audio dynamic range...");
    let frameDbValues = [];

    for (const { frame } of frames) {
      const rms = calculateRmsVolume(frame);
      const db = rmsToDecibels(rms);
      frameDbValues.push(db);
    }

    // Find the dB range
    const dbValues = frameDbValues.filter((db) => db > -100);
    const minDb = Math.min(...dbValues);
    const maxDb = Math.max(...dbValues);

    console.log("Audio dB analysis complete:", {
      minDb: minDb.toFixed(2) + " dBFS",
      maxDb: maxDb.toFixed(2) + " dBFS",
      dynamicRange: (maxDb - minDb).toFixed(2) + " dB",
    });

    // Function to convert dB to percentage (for user-friendly display)
    function dbToPercentage(db: number): number {
      if (db <= minDb) return 0;
      if (db >= 0) return 100; // Safety check for theoretical max

      // Linear mapping from dB range to 0-100%
      // Use the fact that we're dealing with a logarithmic scale already with dB
      const percentage = ((db - minDb) / (maxDb - minDb)) * 100;
      return Math.min(100, Math.max(0, percentage));
    }

    // SECOND PASS: Label each frame using VAD and dB values
    console.log("Second pass: Detecting speech...");
    const speechFlags = [];
    let processedFrames = 0;

    // Convert threshold to dB for internal use
    const dbThreshold = minDb + ((maxDb - minDb) * volumeThreshold) / 100;
    console.log(
      `Using threshold of ${dbThreshold.toFixed(
        2
      )} dBFS based on ${volumeThreshold}% of dynamic range`
    );

    for (let i = 0; i < frames.length; i++) {
      const { timestamp, frame } = frames[i];
      try {
        const vadResult = await vad.processAudio(
          Buffer.from(frame),
          sampleRate
        );
        const isVoiced = vadResult === 1; // VAD.Event.VOICED is 1

        // Get dB value and determine if it's "loud enough"
        const rms = calculateRmsVolume(frame);
        const db = rmsToDecibels(rms);
        const volumePercentage = dbToPercentage(db);
        
        // Using volume percentage for threshold comparison to match UI
        const isLoudEnough = volumePercentage >= volumeThreshold;
        
        // IMPORTANT: Using ONLY volume threshold for speech detection
        // This ensures exact matching with the threshold preview
        const isSpeech = isLoudEnough;

        speechFlags.push({ 
          timestamp, 
          isSpeech, 
          db, 
          volume: volumePercentage,
          isVoiced,
          isLoudEnough 
        });

        processedFrames++;
      } catch (error) {
        console.error(
          `Error processing frame at ${timestamp.toFixed(2)} sec:`,
          error
        );
        speechFlags.push({
          timestamp,
          isSpeech: false,
          db: -100,
          volume: 0,
          isVoiced: false,
          isLoudEnough: false,
        });
      }
    }

    console.log(`Found ${speechFlags.length} frames analyzed`);

    // Log volume data for segments until 3 seconds
    console.log("Volume analysis for first 3 seconds:");
    const volumeData = speechFlags
      .filter((flag) => flag.timestamp <= 3.0)
      .map((flag) => ({
        time: flag.timestamp.toFixed(2),
        db: flag.db.toFixed(2) + " dBFS",
        volume: flag.volume.toFixed(2) + "%",
        isSpeech: flag.isSpeech,
      }));

    console.table(volumeData);

    // For medium thresholds, perform a second pass to refine results
    let lookbackWindow = Math.floor((0.2 * sampleRate) / frameBytes);
    let lookaheadWindow = Math.floor((0.2 * sampleRate) / frameBytes); // ~200ms lookahead

    if (volumeThreshold < 70) {
      for (let i = 0; i < speechFlags.length; i++) {
        if (
          !speechFlags[i].isSpeech &&
          speechFlags[i].volume >= volumeThreshold / 2 &&
          speechFlags[i].volume <= volumeThreshold
        ) {
          // Check nearby frames
          let nearSpeech = false;

          // Look backward
          for (let j = Math.max(0, i - lookbackWindow); j < i; j++) {
            if (speechFlags[j].isSpeech) {
              nearSpeech = true;
              break;
            }
          }

          // Look forward
          if (!nearSpeech) {
            for (
              let j = i + 1;
              j < Math.min(speechFlags.length, i + lookaheadWindow);
              j++
            ) {
              if (speechFlags[j].isSpeech) {
                nearSpeech = true;
                break;
              }
            }
          }

          // Update if near speech
          if (nearSpeech) {
            speechFlags[i].isSpeech = true;
            speechFlags[i].isLoudEnough = true; // Mark as loud enough now
          }
        }
      }
    }

    // COMPLETELY REWRITE segment creation logic to exactly match preview
    // Skip silence detection and create segments directly from frame data
    console.log(
      `Creating segments directly from frame data using threshold: ${volumeThreshold}%`
    );
    
    // Log our data to debug the issue
    console.log("Detailed first 10 frames:");
    for (let i = 0; i < Math.min(10, speechFlags.length); i++) {
      console.log(`Frame ${i}: time=${speechFlags[i].timestamp.toFixed(2)}, volume=${speechFlags[i].volume.toFixed(2)}%, isSpeech=${speechFlags[i].isSpeech}`);
    }

    const segments = [];
    let segmentStart: number | null = null;
    let inSegment = false;
    const totalDuration = rawAudio.length / (sampleRate * sampleWidth);
    
    // Process each frame to find segments based solely on the threshold
    for (let i = 0; i < speechFlags.length; i++) {
      const { timestamp, isSpeech, volume } = speechFlags[i];
      
      // Start of a segment - ONLY if volume is actually above threshold
      if (volume >= volumeThreshold && !inSegment) {
        segmentStart = timestamp;
        inSegment = true;
      } 
      // End of a segment - ONLY if volume drops below threshold
      else if (volume < volumeThreshold && inSegment && segmentStart !== null) {
        segments.push({
          start: segmentStart,
          end: timestamp,
        });
 
        segmentStart = null;
        inSegment = false;
      }
    }

    // Handle final segment if the audio ends during speech
    if (inSegment && segmentStart !== null && frames.length > 0) {
      const endTime = frames[frames.length - 1].timestamp;
      segments.push({
        start: segmentStart,
        end: endTime,
      });
      console.log(
        `Final segment: ${segmentStart.toFixed(2)}s - ${endTime.toFixed(
          2
        )}s (${(endTime - segmentStart).toFixed(2)}s)`
      );
    }

    console.log(`Found ${segments.length} raw segments based on threshold`);

    // Apply speech padding to each segment
    const paddedSegments = segments.map((seg) => ({
      start: Math.max(0, seg.start - (speechPaddingMs / 1000)),
      end: Math.min(seg.end + (speechPaddingMs / 1000), totalDuration),
    }));

    console.log(`Added padding of ${speechPaddingMs}ms to each segment`);

    // Round segment times to 2 decimal places for consistency
    const roundedSegments = paddedSegments.map((seg) => ({
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
    }));

    let mergedSegments = roundedSegments;

    // If silence padding is enabled, process using silence-based approach
    if (silencePaddingMs > 0) {
      console.log(`Processing silence padding with ${silencePaddingMs}ms`);
      
      // Sort segments by start time to ensure proper silence calculation
      const sortedSegments = [...roundedSegments].sort((a, b) => a.start - b.start);
      
      // Step 1: Generate silence segments (inverse of speech segments)
      const silenceSegments = [];
      
      // Add silence from start to first segment if needed
      if (sortedSegments.length > 0 && sortedSegments[0].start > 0) {
        silenceSegments.push({ start: 0, end: sortedSegments[0].start });
      }
      
      // Add silences between segments
      for (let i = 0; i < sortedSegments.length - 1; i++) {
        const currentSpeechEnd = sortedSegments[i].end;
        const nextSpeechStart = sortedSegments[i + 1].start;
        
        if (nextSpeechStart > currentSpeechEnd) {
          silenceSegments.push({ 
            start: currentSpeechEnd, 
            end: nextSpeechStart 
          });
        }
      }
      
      // Add silence from last segment to end if needed
      if (sortedSegments.length > 0 && sortedSegments[sortedSegments.length - 1].end < totalDuration) {
        silenceSegments.push({
          start: sortedSegments[sortedSegments.length - 1].end,
          end: totalDuration
        });
      }
      
      // If no speech segments, everything is silence
      if (sortedSegments.length === 0) {
        silenceSegments.push({ start: 0, end: totalDuration });
      }
      
      console.log(`Generated ${silenceSegments.length} silence segments`);
      
      // Step 2: Merge silence segments that are close to each other
      const mergedSilenceSegments = [];
      
      if (silenceSegments.length > 0) {
        let currentSilence = silenceSegments[0];
        
        for (let i = 1; i < silenceSegments.length; i++) {
          const nextSilence = silenceSegments[i];
          const gapDuration = (nextSilence.start - currentSilence.end) * 1000; // Convert to ms
          
          // If speech between silences is shorter than silence padding, merge the silences
          if (gapDuration <= silencePaddingMs) {
            currentSilence = {
              start: currentSilence.start,
              end: nextSilence.end
            };
          } else {
            // Gap is larger than silence padding, add segment and move to next
            mergedSilenceSegments.push(currentSilence);
            currentSilence = nextSilence;
          }
        }
        
        // Add the last silence segment
        mergedSilenceSegments.push(currentSilence);
      }
      
      console.log(`Merged into ${mergedSilenceSegments.length} silence segments after applying silence padding`);
      
      // Step 3: Convert merged silence segments back to speech segments (their inverse)
      const inverseSpeechSegments = [];
      
      // Add speech from start to first silence if needed
      if (mergedSilenceSegments.length > 0 && mergedSilenceSegments[0].start > 0) {
        inverseSpeechSegments.push({ start: 0, end: mergedSilenceSegments[0].start });
      }
      
      // Add speech between silences
      for (let i = 0; i < mergedSilenceSegments.length - 1; i++) {
        const currentSilenceEnd = mergedSilenceSegments[i].end;
        const nextSilenceStart = mergedSilenceSegments[i + 1].start;
        
        if (nextSilenceStart > currentSilenceEnd) {
          inverseSpeechSegments.push({ 
            start: currentSilenceEnd, 
            end: nextSilenceStart 
          });
        }
      }
      
      // Add speech from last silence to end if needed
      if (mergedSilenceSegments.length > 0 && mergedSilenceSegments[mergedSilenceSegments.length - 1].end < totalDuration) {
        inverseSpeechSegments.push({
          start: mergedSilenceSegments[mergedSilenceSegments.length - 1].end,
          end: totalDuration
        });
      }
      
      // If no silence segments, everything is speech
      if (mergedSilenceSegments.length === 0) {
        inverseSpeechSegments.push({ start: 0, end: totalDuration });
      }
      
      console.log(`Generated ${inverseSpeechSegments.length} final speech segments after silence padding`);
      
      // Use these as our final segments if we have any
      if (inverseSpeechSegments.length > 0) {
        mergedSegments = inverseSpeechSegments;
      }
    }

    // Final processing: Round segment times to 2 decimal places for consistency
    const finalSegments = mergedSegments.map((seg) => ({
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
    }));

    console.log(`Returning ${finalSegments.length} final segments`);
    console.log("Final segments:", JSON.stringify(finalSegments, null, 2));

    return finalSegments;
  } catch (error) {
    console.error("Error in detect_segments:", error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const body = await request.json();
    
    const { filePath, fileName, fileSize, sessionId } = body;
    
    // Get parameters from the request
    const volumeThreshold = Number(body.volumeThreshold || 40);
    const paddingDurationMs = Number(body.paddingDurationMs || 300);
    const speechPaddingMs = Number(body.speechPaddingMs || 50);
    const minSilenceDuration = Number(body.minSilenceDuration || 0);
    const silencePaddingMs = Number(body.silencePaddingMs || 450);

    console.log("Processing with parameters:", {
      volumeThreshold,
      paddingDurationMs,
      speechPaddingMs,
      minSilenceDuration,
      silencePaddingMs,
    });

    if (!filePath || !fileName) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    
    // Check if the file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Log information about the file
    console.log("Processing video file:", {
      fileName,
      fileSize: `${(fileSize / (1024 * 1024)).toFixed(2)} MB`,
      filePath
    });

    // Create audio file paths
    const tempDir = path.join(os.tmpdir(), "video-processor");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const audioPath = path.join(tempDir, `${path.parse(fileName).name}.wav`);
    const audioPublicPath = path.join(process.cwd(), "public", "temp");
    const audioPublicFile = path.join(
      audioPublicPath,
      `${path.parse(fileName).name}.wav`
    );

    // Ensure public temp directory exists
    if (!fs.existsSync(audioPublicPath)) {
      fs.mkdirSync(audioPublicPath, { recursive: true });
    }

    // Extract audio from video
    await extractAudioFromVideo(filePath, audioPath);

    // Save a copy of the audio to public path for client access
    fs.copyFileSync(audioPath, audioPublicFile);

    // Get the audio data
    const audioData = fs.readFileSync(audioPath);

    // Detect speech segments with custom parameters
    const segments = await detectSegments(
      audioData,
      30, // frameDurationMs (fixed)
      paddingDurationMs,
      3, // aggressiveness (fixed - 0-3, 3 is most aggressive)
      speechPaddingMs,
      volumeThreshold,
      minSilenceDuration,
      silencePaddingMs
    );

    // Generate the accessible audio URL
    const audioUrl = `/temp/${path.parse(fileName).name}.wav`;

    // Clean up temp files (audio only, not the uploaded chunks)
    try {
      fs.unlinkSync(audioPath);
    } catch (e) {
      console.warn("Error cleaning up temp audio file:", e);
    }

    // Return the segments and audio URL
    return NextResponse.json({
      segments,
      audioUrl,
    });
  } catch (error) {
    console.error("Error processing video:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
} 