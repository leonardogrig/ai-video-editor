import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import {
  analyzeFrames,
  computeDbStats,
  extractAudioFromVideo,
  generateThresholdCandidates,
  summarizeDistribution,
} from "@/lib/audioAnalysis";

export const runtime = "nodejs";
export const maxDuration = 300;

const EXCHANGE_DIR = path.join(process.cwd(), "ai-exchange");
const EXCHANGE_FILE = path.join(EXCHANGE_DIR, "noise-threshold.json");
const NOISE_THRESHOLD_OFFSET_DB = 10;

function ensureExchangeDir() {
  if (!fs.existsSync(EXCHANGE_DIR)) {
    fs.mkdirSync(EXCHANGE_DIR, { recursive: true });
  }
}

async function resolveAudioPath(
  request: NextRequest
): Promise<{ audioPath: string; cleanup: () => void }> {
  const contentType = request.headers.get("content-type") || "";

  const tempDir = path.join(os.tmpdir(), "video-processor");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  if (contentType.includes("application/json")) {
    const body = await request.json();
    const { filePath, fileName } = body || {};
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error("Uploaded file no longer exists on server");
    }
    const baseName = path.parse(fileName || filePath).name;
    const audioPath = path.join(
      tempDir,
      `${baseName}-threshold-${Date.now()}.wav`
    );
    await extractAudioFromVideo(filePath, audioPath);
    return {
      audioPath,
      cleanup: () => {
        try {
          fs.unlinkSync(audioPath);
        } catch {
          // ignore
        }
      },
    };
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("No file provided");

  const baseName = path.parse(file.name).name;
  const videoPath = path.join(
    tempDir,
    `threshold-src-${Date.now()}-${file.name}`
  );
  const audioPath = path.join(
    tempDir,
    `${baseName}-threshold-${Date.now()}.wav`
  );

  const arrayBuffer = await file.arrayBuffer();
  await writeFile(videoPath, Buffer.from(arrayBuffer));
  await extractAudioFromVideo(videoPath, audioPath);

  return {
    audioPath,
    cleanup: () => {
      try {
        fs.unlinkSync(videoPath);
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(audioPath);
      } catch {
        // ignore
      }
    },
  };
}

export async function POST(request: NextRequest) {
  let cleanup: (() => void) | null = null;
  try {
    const resolved = await resolveAudioPath(request);
    cleanup = resolved.cleanup;

    const audioData = fs.readFileSync(resolved.audioPath);
    const analysis = analyzeFrames(audioData);
    const rawStats = computeDbStats(analysis);
    const distribution = summarizeDistribution(rawStats);
    const candidates = generateThresholdCandidates(
      analysis,
      rawStats,
      distribution
    );

    const stats = {
      durationSec: rawStats.durationSec,
      minDb: rawStats.minDb,
      maxDb: rawStats.maxDb,
      p10Db: rawStats.p10Db,
      p25Db: rawStats.p25Db,
      medianDb: rawStats.medianDb,
      p75Db: rawStats.p75Db,
      p90Db: rawStats.p90Db,
    };

    ensureExchangeDir();

    const payload = {
      task: "noise-threshold",
      createdAt: new Date().toISOString(),
      instructions:
        "Pick the `db` value from `candidates` that best matches the content and " +
        "write it into `noise_threshold_db`. Use `summary` and `mentalModel` to " +
        "judge which rule applies: for `bimodal-clean` prefer the `valley` candidate; " +
        "for `bimodal-soft` or `unimodal` the quantile rules (`median`, `median-3`) " +
        "are usually better. Trade-off: too-low threshold keeps extra silence " +
        "(recoverable via Remove Silences Longer Than); too-high cuts real speech " +
        "(unrecoverable). Prefer the quieter of two otherwise-equal candidates. " +
        "Only set a custom integer outside `candidates` if you have a clear reason " +
        "— explain it. Bounds: -80 to 0. Keep all other fields byte-identical; " +
        "do not delete the file.",
      bounds: { min: -80, max: 0 },
      summary: distribution.summary,
      mentalModel: distribution.mentalModel,
      stats,
      candidates,
      noise_threshold_db: null as number | null,
    };

    fs.writeFileSync(EXCHANGE_FILE, JSON.stringify(payload, null, 2) + "\n");

    const prompt = `Use the ai-exchange skill to fill in ${EXCHANGE_FILE}`;

    return NextResponse.json({
      ok: true,
      path: EXCHANGE_FILE,
      prompt,
      summary: distribution.summary,
      mentalModel: distribution.mentalModel,
      candidateCount: candidates.length,
    });
  } catch (error) {
    console.error("Error creating noise-threshold request:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  } finally {
    if (cleanup) cleanup();
  }
}

export async function GET() {
  if (!fs.existsSync(EXCHANGE_FILE)) {
    return NextResponse.json({
      status: "missing",
      path: EXCHANGE_FILE,
    });
  }

  let parsed: any;
  try {
    const raw = fs.readFileSync(EXCHANGE_FILE, "utf-8");
    parsed = JSON.parse(raw);
  } catch (error) {
    return NextResponse.json(
      {
        status: "invalid",
        path: EXCHANGE_FILE,
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }

  const value = parsed?.noise_threshold_db;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NextResponse.json({
      status: "pending",
      path: EXCHANGE_FILE,
    });
  }

  const rawValue = Math.round(value);
  const adjusted = Math.max(
    -80,
    Math.min(0, rawValue + NOISE_THRESHOLD_OFFSET_DB)
  );

  try {
    fs.unlinkSync(EXCHANGE_FILE);
  } catch (error) {
    console.warn("Failed to delete exchange file:", error);
  }

  return NextResponse.json({
    status: "ready",
    path: EXCHANGE_FILE,
    noise_threshold_db: adjusted,
    raw_value: rawValue,
    offset_applied: NOISE_THRESHOLD_OFFSET_DB,
  });
}

export async function DELETE() {
  try {
    if (fs.existsSync(EXCHANGE_FILE)) fs.unlinkSync(EXCHANGE_FILE);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
