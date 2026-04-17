export type TranscriptionProviderId = "groq" | "elevenlabs";

export interface TranscribeOneParams {
  /** Absolute path to a short audio clip (one speech segment). */
  filePath: string;
  /** ISO-639-1 language code (e.g. "en", "pt"). */
  languageCode: string;
}

export interface TranscribeOneResult {
  text: string;
}

export interface TranscriptionProvider {
  id: TranscriptionProviderId;
  label: string;
  /** Whether required env vars are present. */
  isConfigured(): boolean;
  /** Name of the env var users need to set. */
  envVarName: string;
  /** Transcribe a single short audio clip. Retries/timeouts are the caller's concern. */
  transcribe(params: TranscribeOneParams): Promise<TranscribeOneResult>;
}
