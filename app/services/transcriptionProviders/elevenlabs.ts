import * as fs from "fs";
import * as path from "path";
import type { TranscriptionProvider } from "./types";

const SCRIBE_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const SCRIBE_MODEL_ID = "scribe_v1";

export const elevenlabsProvider: TranscriptionProvider = {
  id: "elevenlabs",
  label: "ElevenLabs Scribe v1",
  envVarName: "ELEVENLABS_API_KEY",
  isConfigured: () => !!process.env.ELEVENLABS_API_KEY,
  async transcribe({ filePath, languageCode }) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

    const buf = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append("model_id", SCRIBE_MODEL_ID);
    if (languageCode) form.append("language_code", languageCode);
    // Use a Blob so FormData streams correctly without trying to infer mime from path.
    form.append(
      "file",
      new Blob([new Uint8Array(buf)], { type: "audio/mpeg" }),
      path.basename(filePath),
    );

    const res = await fetch(SCRIBE_ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    });

    if (!res.ok) {
      // Preserve status on the error so the caller's retry logic can key off it.
      const body = await res.text().catch(() => "");
      const err = new Error(
        `ElevenLabs Scribe failed (${res.status}): ${body.slice(0, 500)}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const data = (await res.json()) as { text?: string };
    return { text: (data.text ?? "").trim() };
  },
};
