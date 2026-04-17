import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import ffmpegPath from "ffmpeg-static";

export const runtime = "nodejs";
export const maxDuration = 1800;

type Segment = { start: number; end: number };

const TRANSCRIPTIONS_DIR = path.join(process.cwd(), "public", "transcriptions");
const EDITED_PATH = path.join(TRANSCRIPTIONS_DIR, "edited.json");

function loadSegmentsFromEdited(): Segment[] {
  if (!fs.existsSync(EDITED_PATH)) {
    throw new Error(`edited.json not found at ${EDITED_PATH}`);
  }
  const parsed = JSON.parse(fs.readFileSync(EDITED_PATH, "utf-8"));
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.segments)
      ? parsed.segments
      : null;
  if (!raw) throw new Error("edited.json has no segments array");

  const segments: Segment[] = raw
    .map((s: any) => ({ start: Number(s.start), end: Number(s.end) }))
    .filter(
      (s: Segment) =>
        Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start
    )
    .sort((a: Segment, b: Segment) => a.start - b.start);

  if (segments.length === 0) throw new Error("edited.json has no valid segments");
  return segments;
}

function buildFilterScript(segments: Segment[]): string {
  const parts: string[] = [];
  segments.forEach((s, i) => {
    parts.push(
      `[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`
    );
    parts.push(
      `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`
    );
  });
  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
  parts.push(
    `${concatInputs}concat=n=${segments.length}:v=1:a=1[outv][outa]`
  );
  return parts.join(";\n");
}

async function runFfmpeg(
  inputPath: string,
  filterScriptPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath as unknown as string;
    if (!bin) {
      reject(new Error("ffmpeg binary not found (ffmpeg-static returned null)"));
      return;
    }
    const args = [
      "-y",
      "-i",
      inputPath,
      "-filter_complex_script",
      filterScriptPath,
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    ];
    const proc = spawn(bin, args);
    let stderrTail = "";
    proc.stderr.on("data", (d) => {
      const chunk = d.toString();
      stderrTail = (stderrTail + chunk).slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail}`));
    });
  });
}

function findUploadedVideo(fileName: string): string | null {
  const chunksRoot = path.join(os.tmpdir(), "video-processor-chunks");
  if (!fs.existsSync(chunksRoot)) return null;
  const sessions = fs.readdirSync(chunksRoot);
  let newest: { p: string; mtime: number } | null = null;
  for (const s of sessions) {
    const candidate = path.join(chunksRoot, s, fileName);
    if (fs.existsSync(candidate)) {
      const mtime = fs.statSync(candidate).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { p: candidate, mtime };
    }
  }
  return newest?.p ?? null;
}

export async function POST(request: NextRequest) {
  let outputPath: string | null = null;
  let filterScriptPath: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    let filePath: string | undefined = body.filePath;
    const fileName: string | undefined = body.fileName;

    const segments = loadSegmentsFromEdited();

    if (!filePath && fileName) {
      const found = findUploadedVideo(fileName);
      if (found) filePath = found;
    }

    if (!filePath) {
      return NextResponse.json(
        {
          error:
            "No source video filePath provided and could not locate a previously uploaded copy. Re-upload the video, then try again.",
        },
        { status: 400 }
      );
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: `Source video not found at ${filePath}` },
        { status: 404 }
      );
    }

    const renderDir = path.join(os.tmpdir(), "video-processor-renders");
    fs.mkdirSync(renderDir, { recursive: true });

    const stamp = Date.now();
    const base = path.parse(fileName ?? path.basename(filePath)).name;
    filterScriptPath = path.join(renderDir, `filter_${base}_${stamp}.txt`);
    outputPath = path.join(renderDir, `${base}_edited_${stamp}.mp4`);

    fs.writeFileSync(filterScriptPath, buildFilterScript(segments));

    await runFfmpeg(filePath, filterScriptPath, outputPath);

    const stat = fs.statSync(outputPath);
    const nodeStream = fs.createReadStream(outputPath);
    const scriptToRemove = filterScriptPath;
    const outToRemove = outputPath;
    nodeStream.on("close", () => {
      try {
        fs.unlinkSync(scriptToRemove);
      } catch {}
      try {
        fs.unlinkSync(outToRemove);
      } catch {}
    });

    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data", (chunk) => controller.enqueue(chunk));
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    const downloadName = `${base}_edited.mp4`;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (filterScriptPath && fs.existsSync(filterScriptPath)) {
      try {
        fs.unlinkSync(filterScriptPath);
      } catch {}
    }
    if (outputPath && fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch {}
    }
    console.error("Error rendering final video:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
