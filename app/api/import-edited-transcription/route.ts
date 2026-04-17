import { NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs";

export const runtime = "nodejs";

const TRANSCRIPTIONS_DIR = path.join(process.cwd(), "public", "transcriptions");
const EDITED_PATH = path.join(TRANSCRIPTIONS_DIR, "edited.json");

export async function GET() {
  if (!fs.existsSync(EDITED_PATH)) {
    return NextResponse.json({ status: "missing", path: EDITED_PATH });
  }

  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(EDITED_PATH, "utf-8"));
  } catch (err) {
    return NextResponse.json(
      {
        status: "invalid",
        path: EDITED_PATH,
        error: (err as Error).message,
      },
      { status: 500 }
    );
  }

  const segments = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.segments)
      ? parsed.segments
      : null;

  if (!segments) {
    return NextResponse.json(
      {
        status: "invalid",
        path: EDITED_PATH,
        error: "edited.json does not contain a segments array",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: "ready",
    path: EDITED_PATH,
    segments,
    originalCount: typeof parsed?.originalCount === "number" ? parsed.originalCount : null,
    filteredCount:
      typeof parsed?.filteredCount === "number" ? parsed.filteredCount : segments.length,
    createdAt: parsed?.createdAt ?? null,
  });
}
