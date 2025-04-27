// Type definitions for modules without .d.ts files

declare module 'node-vad' {
  export enum Mode {
    NORMAL = 0,
    LOW_BITRATE = 1,
    AGGRESSIVE = 2,
    VERY_AGGRESSIVE = 3
  }

  export enum Event {
    ERROR = -1,
    SILENCE = 0,
    VOICE = 1,
    NOISE = 2,
    VOICED = 1 // Alias for VOICE
  }

  export default class VAD {
    constructor(mode: Mode);
    processAudio(buffer: Buffer, sampleRate: number): Promise<Event>;
  }
}

declare module 'fluent-ffmpeg' {
  // Export the module as a namespace as well
  namespace ffmpeg {
    interface FfmpegCommand {
      noVideo(): FfmpegCommand;
      audioCodec(codec: string): FfmpegCommand;
      audioChannels(channels: number): FfmpegCommand;
      audioFrequency(freq: number): FfmpegCommand;
      format(format: string): FfmpegCommand;
      on(event: 'error', callback: (err: Error) => void): FfmpegCommand;
      on(event: 'end', callback: () => void): FfmpegCommand;
      on(event: string, callback: Function): FfmpegCommand;
      save(path: string): FfmpegCommand;
    }
  }

  // Define the main function
  function ffmpeg(input?: string): ffmpeg.FfmpegCommand;
  
  // Define statics
  namespace ffmpeg {
    export function setFfmpegPath(path: string): void;
  }
  
  export = ffmpeg;
}

declare module 'ffmpeg-static' {
  const path: string;
  export default path;
}

declare module 'wavefile' {
  export class WaveFile {
    fmt: {
      sampleRate: number;
      bitsPerSample: number;
      numChannels: number;
    };
    data: {
      samples: Uint8Array;
    };
    
    fromBuffer(buffer: Uint8Array): void;
  }
} 