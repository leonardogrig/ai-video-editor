import { groqProvider } from "./groq";
import { elevenlabsProvider } from "./elevenlabs";
import type { TranscriptionProvider, TranscriptionProviderId } from "./types";

export const PROVIDERS: Record<TranscriptionProviderId, TranscriptionProvider> = {
  groq: groqProvider,
  elevenlabs: elevenlabsProvider,
};

export const DEFAULT_PROVIDER: TranscriptionProviderId = "groq";

export function resolveProvider(id: unknown): TranscriptionProvider {
  if (typeof id === "string" && id in PROVIDERS) {
    return PROVIDERS[id as TranscriptionProviderId];
  }
  return PROVIDERS[DEFAULT_PROVIDER];
}

export type { TranscriptionProvider, TranscriptionProviderId } from "./types";
