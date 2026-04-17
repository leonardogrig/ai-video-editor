import { WaveFile } from "wavefile";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);

export interface SilenceRemovalParams {
  noiseThresholdDb: number;
  removeSilencesLongerThanMs: number;
  keepTalksLongerThanMs: number;
  marginBeforeMs: number;
  marginAfterMs: number;
}

export interface SpeechSegmentRaw {
  start: number;
  end: number;
}

export async function extractAudioFromVideo(
  videoPath: string,
  audioPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("pcm_s16le")
      .audioChannels(1)
      .audioFrequency(16000)
      .format("wav")
      .on("error", (err: Error) => reject(err))
      .on("end", () => resolve())
      .save(audioPath);
  });
}

export interface FrameAnalysis {
  sampleRate: number;
  sampleWidth: number;
  frameDurationMs: number;
  frameDbValues: number[];
  totalDuration: number;
}

export function analyzeFrames(
  audioData: Buffer,
  frameDurationMs = 30
): FrameAnalysis {
  const waveFile = new WaveFile();
  waveFile.fromBuffer(new Uint8Array(audioData));

  const sampleRate = waveFile.fmt.sampleRate as number;
  const sampleWidth = (waveFile.fmt.bitsPerSample as number) / 8;
  const numChannels = waveFile.fmt.numChannels as number;

  if (numChannels !== 1) {
    throw new Error("Audio must be mono for silence detection");
  }

  const frameSize = Math.floor((sampleRate * frameDurationMs) / 1000);
  const frameBytes = frameSize * sampleWidth;
  const rawAudio = waveFile.data.samples as Uint8Array;
  const totalDuration = rawAudio.length / (sampleRate * sampleWidth);

  const MAX_16BIT_VALUE = 32768;

  const frameDbValues: number[] = [];

  for (let i = 0; i < rawAudio.length - frameBytes + 1; i += frameBytes) {
    let sumOfSquares = 0;
    let count = 0;
    for (let j = i; j < i + frameBytes; j += 2) {
      let sample = (rawAudio[j + 1] << 8) | rawAudio[j];
      if (sample & 0x8000) sample = sample - 0x10000;
      sumOfSquares += sample * sample;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumOfSquares / count) : 0;
    const db = rms <= 1 ? -100 : 20 * Math.log10(rms / MAX_16BIT_VALUE);
    frameDbValues.push(db);
  }

  return {
    sampleRate,
    sampleWidth,
    frameDurationMs,
    frameDbValues,
    totalDuration,
  };
}

export function detectSpeechSegments(
  analysis: FrameAnalysis,
  params: SilenceRemovalParams
): SpeechSegmentRaw[] {
  const {
    noiseThresholdDb,
    removeSilencesLongerThanMs,
    keepTalksLongerThanMs,
    marginBeforeMs,
    marginAfterMs,
  } = params;

  const { frameDbValues, frameDurationMs, totalDuration } = analysis;
  const frameSec = frameDurationMs / 1000;

  const rawSpeech: SpeechSegmentRaw[] = [];
  let segStart: number | null = null;

  for (let i = 0; i < frameDbValues.length; i++) {
    const timestamp = i * frameSec;
    const isSpeech = frameDbValues[i] >= noiseThresholdDb;

    if (isSpeech && segStart === null) {
      segStart = timestamp;
    } else if (!isSpeech && segStart !== null) {
      rawSpeech.push({ start: segStart, end: timestamp });
      segStart = null;
    }
  }
  if (segStart !== null) {
    rawSpeech.push({
      start: segStart,
      end: frameDbValues.length * frameSec,
    });
  }

  const mergeGapSec = removeSilencesLongerThanMs / 1000;
  const merged: SpeechSegmentRaw[] = [];
  for (const seg of rawSpeech) {
    if (merged.length === 0) {
      merged.push({ ...seg });
      continue;
    }
    const last = merged[merged.length - 1];
    const gap = seg.start - last.end;
    if (gap < mergeGapSec) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  const minTalkSec = keepTalksLongerThanMs / 1000;
  const kept = merged.filter((seg) => seg.end - seg.start >= minTalkSec);

  const padBeforeSec = marginAfterMs / 1000;
  const padAfterSec = marginBeforeMs / 1000;
  const padded = kept.map((seg) => ({
    start: Math.max(0, seg.start - padBeforeSec),
    end: Math.min(totalDuration, seg.end + padAfterSec),
  }));

  const final: SpeechSegmentRaw[] = [];
  for (const seg of padded) {
    if (final.length === 0) {
      final.push({ ...seg });
      continue;
    }
    const last = final[final.length - 1];
    if (seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end);
    } else {
      final.push({ ...seg });
    }
  }

  return final.map((seg) => ({
    start: Math.round(seg.start * 100) / 100,
    end: Math.round(seg.end * 100) / 100,
  }));
}

export interface DbStats {
  minDb: number;
  maxDb: number;
  meanDb: number;
  medianDb: number;
  p10Db: number;
  p25Db: number;
  p50Db: number;
  p75Db: number;
  p90Db: number;
  p95Db: number;
  durationSec: number;
  histogram: Array<{ dbMin: number; dbMax: number; frames: number; fraction: number }>;
}

export function computeDbStats(analysis: FrameAnalysis): DbStats {
  const values = analysis.frameDbValues.filter((db) => db > -100);
  const sorted = [...values].sort((a, b) => a - b);

  const pick = (p: number) => {
    if (sorted.length === 0) return -100;
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  };

  const minDb = sorted.length > 0 ? sorted[0] : -100;
  const maxDb = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
  const meanDb =
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : -100;

  const histFloor = Math.floor(minDb);
  const histCeil = Math.ceil(Math.min(0, maxDb));
  const histogram: DbStats["histogram"] = [];
  if (values.length > 0 && histCeil > histFloor) {
    const counts = new Array(histCeil - histFloor).fill(0);
    for (const v of values) {
      let idx = Math.floor(v) - histFloor;
      if (idx < 0) idx = 0;
      if (idx >= counts.length) idx = counts.length - 1;
      counts[idx]++;
    }
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] === 0) continue;
      histogram.push({
        dbMin: histFloor + i,
        dbMax: histFloor + i + 1,
        frames: counts[i],
        fraction: Math.round((counts[i] / values.length) * 10000) / 10000,
      });
    }
  }

  return {
    minDb: Math.round(minDb * 10) / 10,
    maxDb: Math.round(maxDb * 10) / 10,
    meanDb: Math.round(meanDb * 10) / 10,
    medianDb: Math.round(pick(50) * 10) / 10,
    p10Db: Math.round(pick(10) * 10) / 10,
    p25Db: Math.round(pick(25) * 10) / 10,
    p50Db: Math.round(pick(50) * 10) / 10,
    p75Db: Math.round(pick(75) * 10) / 10,
    p90Db: Math.round(pick(90) * 10) / 10,
    p95Db: Math.round(pick(95) * 10) / 10,
    durationSec: Math.round(analysis.totalDuration * 100) / 100,
    histogram,
  };
}

export interface ThresholdCandidate {
  db: number;
  rule: string;
  speechPct: number;
  segments: number;
  avgSec: number;
}

function modeBucket(
  histogram: DbStats["histogram"],
  fromDb: number,
  toDb: number
): DbStats["histogram"][number] | null {
  const inRange = histogram.filter(
    (b) => b.dbMin >= fromDb && b.dbMax <= toDb
  );
  if (!inRange.length) return null;
  return inRange.reduce((a, b) => (b.frames > a.frames ? b : a));
}

function valleyBucket(
  histogram: DbStats["histogram"],
  fromDb: number,
  toDb: number
): DbStats["histogram"][number] | null {
  const inRange = histogram.filter(
    (b) => b.dbMin >= fromDb && b.dbMax <= toDb
  );
  if (!inRange.length) return null;
  return inRange.reduce((a, b) => (b.frames < a.frames ? b : a));
}

export interface DistributionSummary {
  summary: string;
  mentalModel: "bimodal-clean" | "bimodal-soft" | "unimodal";
  noiseModeDb: number | null;
  speechModeDb: number | null;
  valleyDb: number | null;
}

export function summarizeDistribution(stats: DbStats): DistributionSummary {
  const noiseMode = modeBucket(stats.histogram, stats.minDb, stats.medianDb);
  const speechMode = modeBucket(stats.histogram, stats.medianDb, stats.maxDb);
  const valley =
    noiseMode && speechMode
      ? valleyBucket(stats.histogram, noiseMode.dbMax, speechMode.dbMin)
      : null;

  const noiseModeDb = noiseMode
    ? Math.round((noiseMode.dbMin + noiseMode.dbMax) / 2)
    : null;
  const speechModeDb = speechMode
    ? Math.round((speechMode.dbMin + speechMode.dbMax) / 2)
    : null;
  const valleyDb = valley
    ? Math.round((valley.dbMin + valley.dbMax) / 2)
    : null;

  let mentalModel: DistributionSummary["mentalModel"] = "unimodal";
  if (noiseMode && speechMode && valley) {
    const minModeFraction = Math.min(noiseMode.fraction, speechMode.fraction);
    const depth = valley.fraction / Math.max(minModeFraction, 1e-9);
    if (depth < 0.3) mentalModel = "bimodal-clean";
    else if (depth < 0.7) mentalModel = "bimodal-soft";
  }

  const durationMin = Math.floor(stats.durationSec / 60);
  const durationSec = Math.round(stats.durationSec % 60);
  const durationStr = `${durationMin}m${String(durationSec).padStart(2, "0")}s`;

  const parts: string[] = [
    `${durationStr} track, dynamic range ${stats.minDb} to ${stats.maxDb} dB.`,
  ];
  if (noiseModeDb !== null) {
    parts.push(`Noise floor centered around ${noiseModeDb} dB.`);
  }
  if (speechModeDb !== null) {
    parts.push(`Speech peak around ${speechModeDb} dB.`);
  }
  if (mentalModel === "bimodal-clean" && valleyDb !== null) {
    parts.push(`Clear valley at ${valleyDb} dB between noise and speech.`);
  } else if (mentalModel === "bimodal-soft") {
    parts.push(
      `No sharp valley — gradual rise from noise to speech, median at ${stats.medianDb} dB.`
    );
  } else {
    parts.push(
      `No clear separation between noise and speech; distribution is roughly unimodal around ${stats.medianDb} dB.`
    );
  }

  return {
    summary: parts.join(" "),
    mentalModel,
    noiseModeDb,
    speechModeDb,
    valleyDb,
  };
}

export function generateThresholdCandidates(
  analysis: FrameAnalysis,
  stats: DbStats,
  distribution: DistributionSummary,
  simulationParams: Omit<SilenceRemovalParams, "noiseThresholdDb"> = {
    removeSilencesLongerThanMs: 130,
    keepTalksLongerThanMs: 120,
    marginBeforeMs: 50,
    marginAfterMs: 50,
  }
): ThresholdCandidate[] {
  const proposals: Array<{ db: number; rule: string }> = [
    { db: Math.round(stats.p10Db + 8), rule: "p10+8 (safe above noise)" },
    { db: Math.round(stats.p25Db), rule: "p25 (quartile)" },
    { db: Math.round(stats.medianDb), rule: "median (quantile, ~50% speech)" },
    { db: Math.round(stats.medianDb - 3), rule: "median-3 (slightly aggressive)" },
  ];
  if (distribution.valleyDb !== null) {
    proposals.splice(2, 0, {
      db: distribution.valleyDb,
      rule: "valley (histogram low-point)",
    });
  }

  const dedup = new Map<number, { db: number; rule: string }>();
  for (const p of proposals) {
    const t = Math.max(-80, Math.min(0, p.db));
    if (!dedup.has(t)) dedup.set(t, { db: t, rule: p.rule });
    else dedup.get(t)!.rule += `; ${p.rule}`;
  }

  const results: ThresholdCandidate[] = [];
  for (const c of dedup.values()) {
    const segs = detectSpeechSegments(analysis, {
      noiseThresholdDb: c.db,
      ...simulationParams,
    });
    const total = segs.reduce((a, s) => a + (s.end - s.start), 0);
    const avg = segs.length ? total / segs.length : 0;
    results.push({
      db: c.db,
      rule: c.rule,
      speechPct: Math.round(
        (total / Math.max(analysis.totalDuration, 1e-9)) * 100
      ),
      segments: segs.length,
      avgSec: Math.round(avg * 10) / 10,
    });
  }

  return results.sort((a, b) => a.db - b.db);
}
