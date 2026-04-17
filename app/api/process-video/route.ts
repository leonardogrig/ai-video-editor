import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
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
    const tempDir = path.join(os.tmpdir(), "video-processor");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    const noiseThresholdDb = Number(formData.get("noiseThresholdDb") ?? -44);
    const removeSilencesLongerThanMs = Number(
      formData.get("removeSilencesLongerThanMs") ?? 130
    );
    const keepTalksLongerThanMs = Number(
      formData.get("keepTalksLongerThanMs") ?? 120
    );
    const marginBeforeMs = Number(formData.get("marginBeforeMs") ?? 50);
    const marginAfterMs = Number(formData.get("marginAfterMs") ?? 50);

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
    const analysis = analyzeFrames(audioData);
    const segments = detectSpeechSegments(analysis, {
      noiseThresholdDb,
      removeSilencesLongerThanMs,
      keepTalksLongerThanMs,
      marginBeforeMs,
      marginAfterMs,
    });

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
