import Groq from "groq-sdk";
import * as fs from "fs";
import type { TranscriptionProvider } from "./types";

let client: Groq | null = null;
function getClient(): Groq {
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

export const groqProvider: TranscriptionProvider = {
  id: "groq",
  label: "Groq (Whisper large-v3 turbo)",
  envVarName: "GROQ_API_KEY",
  isConfigured: () => !!process.env.GROQ_API_KEY,
  async transcribe({ filePath }) {
    const fileStream = fs.createReadStream(filePath);
    try {
      const transcription = await getClient().audio.transcriptions.create({
        file: fileStream,
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json",
        temperature: 0.0,
      });
      return { text: (transcription.text ?? "").trim() };
    } finally {
      fileStream.close();
    }
  },
};
