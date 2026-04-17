import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs";

export const runtime = "nodejs";

const CACHE_DIR = path.join(process.cwd(), "public", "transcriptions");

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function sanitize(fileName: string): string {
  const base = path.basename(fileName);
  return base.replace(/[/\\:*?"<>|]/g, "_");
}

function cachePathFor(fileName: string): string {
  const safe = sanitize(fileName);
  const baseName = path.parse(safe).name;
  return path.join(CACHE_DIR, `${baseName}.json`);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const fileName = url.searchParams.get("fileName");
  const fileSizeParam = url.searchParams.get("fileSize");

  if (!fileName) {
    return NextResponse.json(
      { error: "fileName is required" },
      { status: 400 }
    );
  }

  const cachePath = cachePathFor(fileName);
  if (!fs.existsSync(cachePath)) {
    return NextResponse.json({ status: "missing", path: cachePath });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
  } catch (err) {
    return NextResponse.json(
      {
        status: "invalid",
        path: cachePath,
        error: (err as Error).message,
      },
      { status: 500 }
    );
  }

  const expectedSize = fileSizeParam ? Number(fileSizeParam) : null;
  if (
    expectedSize !== null &&
    typeof parsed.fileSize === "number" &&
    parsed.fileSize !== expectedSize
  ) {
    return NextResponse.json({
      status: "size-mismatch",
      path: cachePath,
      cachedSize: parsed.fileSize,
      actualSize: expectedSize,
    });
  }

  return NextResponse.json({
    status: "hit",
    path: cachePath,
    fileName: parsed.fileName,
    fileSize: parsed.fileSize,
    language: parsed.language,
    segments: parsed.segments,
    createdAt: parsed.createdAt,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileName, fileSize, language, segments } = body || {};

    if (!fileName || !Array.isArray(segments)) {
      return NextResponse.json(
        { error: "fileName and segments are required" },
        { status: 400 }
      );
    }

    ensureDir();
    const cachePath = cachePathFor(fileName);

    const payload = {
      fileName: path.basename(fileName),
      fileSize: typeof fileSize === "number" ? fileSize : null,
      language: language ?? null,
      createdAt: new Date().toISOString(),
      segments,
    };

    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2));

    return NextResponse.json({ ok: true, path: cachePath });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const fileName = url.searchParams.get("fileName");
  if (!fileName) {
    return NextResponse.json(
      { error: "fileName is required" },
      { status: 400 }
    );
  }
  const cachePath = cachePathFor(fileName);
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
