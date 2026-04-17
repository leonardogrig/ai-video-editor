export interface SpeechSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
  error?: string;
  skipped?: boolean;
}

export type TranscribedSegment = SpeechSegment;

export interface DialogControls {
  noiseThresholdDb: number;
  removeSilencesLongerThanMs: number;
  keepTalksLongerThanMs: number;
  marginBeforeMs: number;
  marginAfterMs: number;
}

export interface SilenceRemovalParams {
  noiseThresholdDb: number;
  removeSilencesLongerThanMs: number;
  keepTalksLongerThanMs: number;
  marginBeforeMs: number;
  marginAfterMs: number;
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
