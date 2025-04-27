export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
  error?: string;
  skipped?: boolean;
}

// Add the TranscribedSegment interface which is equivalent to SpeechSegment
export type TranscribedSegment = SpeechSegment;

export interface DialogControls {
  volumeThreshold: number;
  paddingDurationMs: number; // Always 0, retained for backward compatibility
  speechPaddingMs: number;
  silencePaddingMs: number;
}

export interface SilenceRemovalParams {
  volumeThreshold: number;
  paddingDurationMs: number; // Always 0, retained for backward compatibility
  speechPaddingMs: number;
  silencePaddingMs: number;
}

export interface SilenceRemovalResult {
  segments: SpeechSegment[];
  audioUrl: string;
}

export interface InstallationInstructions {
  windows: string;
  mac: string;
  linux: string;
} 