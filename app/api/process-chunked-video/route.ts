import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import {
  analyzeFrames,
  detectSpeechSegments,
  extractAudioFromVideo,
} from "@/lib/audioAnalysis";

// Import types
import "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { filePath, fileName, fileSize } = body;

    const noiseThresholdDb = Number(body.noiseThresholdDb ?? -44);
    const removeSilencesLongerThanMs = Number(
      body.removeSilencesLongerThanMs ?? 130
    );
    const keepTalksLongerThanMs = Number(body.keepTalksLongerThanMs ?? 120);
    const marginBeforeMs = Number(body.marginBeforeMs ?? 50);
    const marginAfterMs = Number(body.marginAfterMs ?? 50);

    console.log("Processing with parameters:", {
      noiseThresholdDb,
      removeSilencesLongerThanMs,
      keepTalksLongerThanMs,
      marginBeforeMs,
      marginAfterMs,
    });

    if (!filePath || !fileName) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    console.log("Processing video file:", {
      fileName,
      fileSize: `${(fileSize / (1024 * 1024)).toFixed(2)} MB`,
      filePath,
    });

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

    if (!fs.existsSync(audioPublicPath)) {
      fs.mkdirSync(audioPublicPath, { recursive: true });
    }

    await extractAudioFromVideo(filePath, audioPath);
    fs.copyFileSync(audioPath, audioPublicFile);

    const audioData = fs.readFileSync(audioPath);
    const analysis = analyzeFrames(audioData);
    const segments = detectSpeechSegments(analysis, {
      noiseThresholdDb,
      removeSilencesLongerThanMs,
      keepTalksLongerThanMs,
      marginBeforeMs,
      marginAfterMs,
    });

    const audioUrl = `/temp/${path.parse(fileName).name}.wav`;

    try {
      fs.unlinkSync(audioPath);
    } catch (e) {
      console.warn("Error cleaning up temp audio file:", e);
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
