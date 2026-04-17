import { NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs";

export const runtime = "nodejs";

const TRANSCRIPTIONS_DIR = path.join(process.cwd(), "public", "transcriptions");

export async function GET() {
  if (!fs.existsSync(TRANSCRIPTIONS_DIR)) {
    return NextResponse.json({ status: "missing", dir: TRANSCRIPTIONS_DIR });
  }

  const candidates = fs
    .readdirSync(TRANSCRIPTIONS_DIR)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .filter((name) => name.toLowerCase() !== "edited.json");

  if (candidates.length === 0) {
    return NextResponse.json({ status: "missing", dir: TRANSCRIPTIONS_DIR });
  }

  if (candidates.length > 1) {
    return NextResponse.json({
      status: "ambiguous",
      dir: TRANSCRIPTIONS_DIR,
      candidates: candidates.map((c) => path.join(TRANSCRIPTIONS_DIR, c)),
    });
  }

  return NextResponse.json({
    status: "ready",
    path: path.join(TRANSCRIPTIONS_DIR, candidates[0]),
    fileName: candidates[0],
  });
}
