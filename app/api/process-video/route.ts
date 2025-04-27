import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
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
    // Setting a very large value because we're using the Edge API route which has its own limits
    responseLimit: false,
    bodyParser: {
      sizeLimit: Infinity // No size limit for local development
    }
  },
};

// Extract audio from video file (equivalent to Python's extract_audio)
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

// Detect speech segments (equivalent to Python's detect_segments)
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
    const waveFile = new WaveFile();
    waveFile.fromBuffer(new Uint8Array(audioData));

    const sampleRate = waveFile.fmt.sampleRate;
    const sampleWidth = waveFile.fmt.bitsPerSample / 8;
    const numChannels = waveFile.fmt.numChannels;

    if (numChannels !== 1) {
      throw new Error("Audio must be mono for VAD processing");
    }

    if (![8000, 16000, 32000, 48000].includes(sampleRate)) {
      throw new Error("Sample rate must be one of: 8000, 16000, 32000, 48000 Hz");
    }

    const vad = new VAD.default(aggressiveness);
    const frameSize = Math.floor((sampleRate * frameDurationMs) / 1000);
    const frameBytes = frameSize * sampleWidth;
    const rawAudio = waveFile.data.samples;

    const frames = [];
    for (let i = 0; i < rawAudio.length - frameBytes + 1; i += frameBytes) {
      const frame = rawAudio.slice(i, i + frameBytes);
      const timestamp = i / (sampleRate * sampleWidth);
      frames.push({ timestamp, frame });
    }

    function calculateRmsVolume(frame: Uint8Array): number {
      try {
        const samples = [];
        for (let i = 0; i < frame.length; i += 2) {
          let sample = (frame[i + 1] << 8) | frame[i];
          if (sample & 0x8000) {
            sample = sample - 0x10000;
          }
          samples.push(sample);
        }

        let sumOfSquares = 0;
        for (const sample of samples) {
          sumOfSquares += sample * sample;
        }
        return Math.sqrt(sumOfSquares / samples.length);
      } catch (error) {
        console.error("Error calculating frame RMS:", error);
        return 0;
      }
    }

    function rmsToDecibels(rms: number): number {
      const MAX_16BIT_VALUE = 32768;
      if (rms <= 1) return -100;
      return 20 * Math.log10(rms / MAX_16BIT_VALUE);
    }

    let frameDbValues = [];
    for (const { frame } of frames) {
      const rms = calculateRmsVolume(frame);
      const db = rmsToDecibels(rms);
      frameDbValues.push(db);
    }

    const dbValues = frameDbValues.filter((db) => db > -100);
    const minDb = Math.min(...dbValues);
    const maxDb = Math.max(...dbValues);

    function dbToPercentage(db: number): number {
      if (db <= minDb) return 0;
      if (db >= 0) return 100;
      const percentage = ((db - minDb) / (maxDb - minDb)) * 100;
      return Math.min(100, Math.max(0, percentage));
    }

    const speechFlags = [];
    let processedFrames = 0;
    const dbThreshold = minDb + ((maxDb - minDb) * volumeThreshold) / 100;

    for (let i = 0; i < frames.length; i++) {
      const { timestamp, frame } = frames[i];
      try {
        const vadResult = await vad.processAudio(Buffer.from(frame), sampleRate);
        const isVoiced = vadResult === 1;

        const rms = calculateRmsVolume(frame);
        const db = rmsToDecibels(rms);
        const volumePercentage = dbToPercentage(db);
        const isLoudEnough = volumePercentage >= volumeThreshold;
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
        console.error(`Error processing frame at ${timestamp.toFixed(2)} sec:`, error);
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

    let lookbackWindow = Math.floor((0.2 * sampleRate) / frameBytes);
    let lookaheadWindow = Math.floor((0.2 * sampleRate) / frameBytes);

    if (volumeThreshold < 70) {
      for (let i = 0; i < speechFlags.length; i++) {
        if (
          !speechFlags[i].isSpeech &&
          speechFlags[i].volume >= volumeThreshold / 2 &&
          speechFlags[i].volume <= volumeThreshold
        ) {
          let nearSpeech = false;

          for (let j = Math.max(0, i - lookbackWindow); j < i; j++) {
            if (speechFlags[j].isSpeech) {
              nearSpeech = true;
              break;
            }
          }

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

          if (nearSpeech) {
            speechFlags[i].isSpeech = true;
            speechFlags[i].isLoudEnough = true;
          }
        }
      }
    }

    const segments = [];
    let segmentStart: number | null = null;
    let inSegment = false;
    const totalDuration = rawAudio.length / (sampleRate * sampleWidth);
    
    for (let i = 0; i < speechFlags.length; i++) {
      const { timestamp, isSpeech, volume } = speechFlags[i];
      
      if (volume >= volumeThreshold && !inSegment) {
        segmentStart = timestamp;
        inSegment = true;
      } 
      else if (volume < volumeThreshold && inSegment && segmentStart !== null) {
        segments.push({
          start: segmentStart,
          end: timestamp,
        });
 
        segmentStart = null;
        inSegment = false;
      }
    }

    if (inSegment && segmentStart !== null && frames.length > 0) {
      const endTime = frames[frames.length - 1].timestamp;
      segments.push({
        start: segmentStart,
        end: endTime,
      });
    }

    const paddedSegments = segments.map((seg) => ({
      start: Math.max(0, seg.start - (speechPaddingMs / 1000)),
      end: Math.min(seg.end + (speechPaddingMs / 1000), totalDuration),
    }));

    const roundedSegments = paddedSegments.map((seg) => ({
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
    }));

    let mergedSegments = roundedSegments;

    if (silencePaddingMs > 0) {
      const sortedSegments = [...roundedSegments].sort((a, b) => a.start - b.start);
      const silenceSegments = [];
      
      if (sortedSegments.length > 0 && sortedSegments[0].start > 0) {
        silenceSegments.push({ start: 0, end: sortedSegments[0].start });
      }
      
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
      
      if (sortedSegments.length > 0 && sortedSegments[sortedSegments.length - 1].end < totalDuration) {
        silenceSegments.push({
          start: sortedSegments[sortedSegments.length - 1].end,
          end: totalDuration
        });
      }
      
      if (sortedSegments.length === 0) {
        silenceSegments.push({ start: 0, end: totalDuration });
      }
      
      const mergedSilenceSegments = [];
      
      if (silenceSegments.length > 0) {
        let currentSilence = silenceSegments[0];
        
        for (let i = 1; i < silenceSegments.length; i++) {
          const nextSilence = silenceSegments[i];
          const gapDuration = (nextSilence.start - currentSilence.end) * 1000;
          
          if (gapDuration <= silencePaddingMs) {
            currentSilence = {
              start: currentSilence.start,
              end: nextSilence.end
            };
          } else {
            mergedSilenceSegments.push(currentSilence);
            currentSilence = nextSilence;
          }
        }
        
        mergedSilenceSegments.push(currentSilence);
      }
      
      const inverseSpeechSegments = [];
      
      if (mergedSilenceSegments.length > 0 && mergedSilenceSegments[0].start > 0) {
        inverseSpeechSegments.push({ start: 0, end: mergedSilenceSegments[0].start });
      }
      
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
      
      if (mergedSilenceSegments.length > 0 && mergedSilenceSegments[mergedSilenceSegments.length - 1].end < totalDuration) {
        inverseSpeechSegments.push({
          start: mergedSilenceSegments[mergedSilenceSegments.length - 1].end,
          end: totalDuration
        });
      }
      
      if (mergedSilenceSegments.length === 0) {
        inverseSpeechSegments.push({ start: 0, end: totalDuration });
      }
      
      if (inverseSpeechSegments.length > 0) {
        mergedSegments = inverseSpeechSegments;
      }
    }

    const finalSegments = mergedSegments.map((seg) => ({
      start: Math.round(seg.start * 100) / 100,
      end: Math.round(seg.end * 100) / 100,
    }));

    return finalSegments;
  } catch (error) {
    console.error("Error in detect_segments:", error);
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const tempDir = path.join(os.tmpdir(), "video-processor");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    const volumeThreshold = Number(formData.get("volumeThreshold") || 40);
    const paddingDurationMs = Number(formData.get("paddingDurationMs") || 300);
    const speechPaddingMs = Number(formData.get("speechPaddingMs") || 50);
    const minSilenceDuration = Number(formData.get("minSilenceDuration") || 0);
    const silencePaddingMs = Number(formData.get("silencePaddingMs") || 450);

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const videoPath = path.join(tempDir, file.name);
    const audioPath = path.join(tempDir, `${path.parse(file.name).name}.wav`);
    const audioPublicPath = path.join(process.cwd(), "public", "temp");
    const audioPublicFile = path.join(
      audioPublicPath,
      `${path.parse(file.name).name}.wav`
    );

    if (!fs.existsSync(audioPublicPath)) {
      fs.mkdirSync(audioPublicPath, { recursive: true });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await writeFile(videoPath, buffer);

    await extractAudioFromVideo(videoPath, audioPath);
    fs.copyFileSync(audioPath, audioPublicFile);

    const audioData = fs.readFileSync(audioPath);

    const segments = await detectSegments(
      audioData,
      30,
      paddingDurationMs,
      3,
      speechPaddingMs,
      volumeThreshold,
      minSilenceDuration,
      silencePaddingMs
    );

    const audioUrl = `/temp/${path.parse(file.name).name}.wav`;

    try {
      fs.unlinkSync(videoPath);
      fs.unlinkSync(audioPath);
    } catch (e) {
      console.warn("Error cleaning up temp files:", e);
    }

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
