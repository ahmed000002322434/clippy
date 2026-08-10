import type {
  AnalysisSignals,
  ClipCandidate,
  ClipStrategy,
  ScoreFactors,
  StrategyConfig,
  Transcript,
} from "./types";

// ---------------------------------------------------------------------------
// Strategies — weight profile per content goal
// ---------------------------------------------------------------------------
export const STRATEGIES: StrategyConfig[] = [
  {
    id: "viral",
    label: "Viral",
    emoji: "🔥",
    description: "Highest-impact, hook-forward moments",
    weights: { hook: 1.5, intensity: 1.3, density: 1, standalone: 1.1, clarity: 0.8, visual: 1, pacing: 1 },
    targetDurationMs: 30_000,
    maxDurationMs: 60_000,
    minDurationMs: 10_000,
  },
  {
    id: "educational",
    label: "Educational",
    emoji: "🧠",
    description: "Clear, complete, self-contained explanations",
    weights: { clarity: 1.6, density: 1.3, standalone: 1.4, hook: 0.9, intensity: 0.6, visual: 0.5, pacing: 1 },
    targetDurationMs: 45_000,
    maxDurationMs: 90_000,
    minDurationMs: 15_000,
  },
  {
    id: "funny",
    label: "Funny",
    emoji: "😂",
    description: "Punchlines and surprising beats",
    weights: { hook: 1.2, intensity: 1.4, pacing: 1.4, density: 0.9, standalone: 1.2, visual: 0.8, clarity: 0.5 },
    targetDurationMs: 20_000,
    maxDurationMs: 45_000,
    minDurationMs: 8_000,
  },
  {
    id: "storytelling",
    label: "Storytelling",
    emoji: "📖",
    description: "Moments with narrative arc",
    weights: { clarity: 1.2, standalone: 1.5, hook: 1, intensity: 1, density: 1.1, visual: 0.7, pacing: 0.9 },
    targetDurationMs: 45_000,
    maxDurationMs: 90_000,
    minDurationMs: 15_000,
  },
  {
    id: "motivational",
    label: "Motivational",
    emoji: "💪",
    description: "Intense, emotional, quotable",
    weights: { intensity: 1.7, hook: 1.2, density: 1.1, standalone: 1.1, clarity: 0.7, visual: 0.6, pacing: 0.8 },
    targetDurationMs: 30_000,
    maxDurationMs: 60_000,
    minDurationMs: 12_000,
  },
  {
    id: "podcast",
    label: "Podcast",
    emoji: "🎙️",
    description: "Conversational beats from long-form audio",
    weights: { clarity: 1.2, density: 1.4, standalone: 1.3, hook: 0.9, intensity: 0.9, visual: 0.4, pacing: 1 },
    targetDurationMs: 30_000,
    maxDurationMs: 60_000,
    minDurationMs: 12_000,
  },
  {
    id: "business",
    label: "Business",
    emoji: "📈",
    description: "Insights, tactics and data points",
    weights: { clarity: 1.4, density: 1.2, standalone: 1.2, hook: 1, intensity: 0.7, visual: 0.5, pacing: 1 },
    targetDurationMs: 35_000,
    maxDurationMs: 70_000,
    minDurationMs: 12_000,
  },
  {
    id: "news",
    label: "News",
    emoji: "📰",
    description: "Timely, factual statements",
    weights: { clarity: 1.5, standalone: 1.3, density: 1.2, hook: 1, intensity: 0.6, visual: 0.6, pacing: 1.1 },
    targetDurationMs: 25_000,
    maxDurationMs: 45_000,
    minDurationMs: 10_000,
  },
  {
    id: "interview",
    label: "Interview",
    emoji: "🎤",
    description: "Strong answers and quotable replies",
    weights: { clarity: 1.2, density: 1.2, standalone: 1.4, hook: 1, intensity: 0.9, visual: 0.5, pacing: 0.9 },
    targetDurationMs: 30_000,
    maxDurationMs: 60_000,
    minDurationMs: 10_000,
  },
  {
    id: "custom",
    label: "Custom",
    emoji: "✨",
    description: "Balanced across all signals",
    weights: { hook: 1.1, density: 1.1, standalone: 1.1, intensity: 1, clarity: 1, visual: 0.8, pacing: 1 },
    targetDurationMs: 30_000,
    maxDurationMs: 60_000,
    minDurationMs: 10_000,
  },
];

export function getStrategy(id: ClipStrategy): StrategyConfig {
  return STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];
}

// ---------------------------------------------------------------------------
// Utterance extraction — contiguous voiced regions
// ---------------------------------------------------------------------------
interface Utterance {
  startMs: number;
  endMs: number;
}

function extractUtterances(signals: AnalysisSignals): Utterance[] {
  const { windowMs, voiced, durationMs } = signals;
  const runs: Utterance[] = [];
  let runStart = -1;
  let lastVoiced = -1;
  const maxGapMs = 1200;

  for (let i = 0; i <= voiced.length; i++) {
    const voicedHere = i < voiced.length ? voiced[i] : false;
    if (voicedHere) {
      if (runStart === -1) runStart = i * windowMs;
      lastVoiced = i;
    } else if (runStart !== -1) {
      const gapStart = i * windowMs;
      const nextVoiced = voiced.slice(i, i + Math.ceil(maxGapMs / windowMs) + 1).some(Boolean);
      if (nextVoiced && gapStart - runStart < 2_000_000) {
        // keep the run open — small pause inside an utterance
      } else {
        runs.push({ startMs: runStart, endMs: lastVoiced * windowMs + windowMs });
        runStart = -1;
      }
    }
  }
  if (runStart !== -1) {
    runs.push({ startMs: runStart, endMs: lastVoiced * windowMs + windowMs });
  }

  // Merge runs that are very close together
  const merged: Utterance[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run.startMs - prev.endMs <= maxGapMs) {
      prev.endMs = Math.max(prev.endMs, run.endMs);
    } else {
      merged.push({ ...run });
    }
  }
  // clip to duration
  return merged.filter((u) => u.endMs - u.startMs >= 5000).map((u) => ({
    startMs: u.startMs,
    endMs: Math.min(u.endMs, durationMs),
  }));
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------
interface CutPoint {
  tMs: number;
  quality: number; // 0..1 — prefer scene boundaries & pauses
}

function nearestCutPoints(signals: AnalysisSignals, aroundMs: number, rangeMs: number): CutPoint[] {
  const points: CutPoint[] = [];
  for (const s of signals.scenes) {
    if (Math.abs(s - aroundMs) <= rangeMs) {
      points.push({ tMs: s, quality: 0.95 });
    }
  }
  for (const p of signals.pauses) {
    if (Math.abs((p.startMs + p.endMs) / 2 - aroundMs) <= rangeMs) {
      points.push({ tMs: p.startMs, quality: 0.85 });
    }
  }
  if (points.length === 0) points.push({ tMs: aroundMs, quality: 0.6 });
  return points;
}

function pickCut(signals: AnalysisSignals, aroundMs: number, rangeMs: number): number {
  const points = nearestCutPoints(signals, aroundMs, rangeMs);
  points.sort((a, b) => {
    // prefer close AND high quality
    const scoreA = a.quality * 0.7 + (1 - Math.abs(a.tMs - aroundMs) / rangeMs) * 0.3;
    const scoreB = b.quality * 0.7 + (1 - Math.abs(b.tMs - aroundMs) / rangeMs) * 0.3;
    return scoreB - scoreA;
  });
  return points[0].tMs;
}

function generateCandidates(
  signals: AnalysisSignals,
  strategy: StrategyConfig,
): { startMs: number; endMs: number }[] {
  const utterances = extractUtterances(signals);
  const candidates: { startMs: number; endMs: number }[] = [];
  const min = strategy.minDurationMs;
  const target = strategy.targetDurationMs;
  const max = strategy.maxDurationMs;

  for (const u of utterances) {
    const len = u.endMs - u.startMs;
    if (len < min) continue;

    // A) full utterance when it fits the strategy envelope
    if (len <= max && len >= min) {
      candidates.push({ startMs: u.startMs, endMs: u.endMs });
    } else if (len > max) {
      // B) leading window
      const wantEnd = pickCut(signals, u.startMs + target, target * 0.6);
      const endA = Math.min(u.endMs, Math.max(u.startMs + min, wantEnd));
      if (endA - u.startMs >= min) {
        candidates.push({ startMs: u.startMs, endMs: endA });
      }
      // C) delayed hook — skip the first few seconds, open near a cut
      const skipMs = Math.min(8000, len * 0.15);
      const startB = pickCut(signals, u.startMs + skipMs, 3000);
      const endB = pickCut(signals, startB + target, target * 0.6);
      if (endB - startB >= min && endB <= u.endMs) {
        candidates.push({ startMs: startB, endMs: endB });
      }
      // D) trailing window (strong endings)
      const startC = pickCut(signals, u.endMs - target, target * 0.6);
      if (u.endMs - startC >= min) {
        candidates.push({ startMs: startC, endMs: u.endMs });
      }
    } else if (len < max && len >= min) {
      candidates.push({ startMs: u.startMs, endMs: u.endMs });
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Scoring rubric
// ---------------------------------------------------------------------------
interface WindowStats {
  mean: number;
  max: number;
  variance: number;
  voicedRatio: number;
  startRamp: number; // first 1.5s mean vs rest
  pauseRatio: number;
  trend: number; // -1..1 upward drift
}

function statsFor(
  signals: AnalysisSignals,
  startMs: number,
  endMs: number,
): WindowStats {
  const { windowMs, energy, voiced, pauses } = signals;
  const from = Math.max(0, Math.floor(startMs / windowMs));
  const to = Math.min(energy.length, Math.ceil(endMs / windowMs));
  const slice = energy.slice(from, to);
  const vSlice = voiced.slice(from, to);

  let mean = 0;
  let max = 0;
  let sumSq = 0;
  let voicedCount = 0;
  for (let i = 0; i < slice.length; i++) {
    const e = slice[i];
    mean += e;
    if (e > max) max = e;
    sumSq += e * e;
    if (vSlice[i]) voicedCount++;
  }
  const n = Math.max(1, slice.length);
  mean /= n;
  const variance = Math.max(0, sumSq / n - mean * mean);

  // start ramp: energy in first 1.5s vs the rest of the window
  const rampWindows = Math.max(1, Math.floor(1500 / windowMs));
  const startSlice = slice.slice(0, Math.min(rampWindows, n));
  const restSlice = slice.slice(Math.min(rampWindows, n), n);
  const startMean = startSlice.length
    ? startSlice.reduce((a, b) => a + b, 0) / startSlice.length
    : 0;
  const restMean = restSlice.length
    ? restSlice.reduce((a, b) => a + b, 0) / restSlice.length
    : mean;
  const startRamp = startMean - restMean;

  // pause ratio inside the window
  let pauseMs = 0;
  for (const p of pauses) {
    const overlap = Math.min(p.endMs, endMs) - Math.max(p.startMs, startMs);
    if (overlap > 0) pauseMs += overlap;
  }
  const totalMs = Math.max(1, endMs - startMs);

  // trend: compare mean of first half vs second half
  const half = Math.floor(n / 2);
  const firstHalf = slice.slice(0, half);
  const secondHalf = slice.slice(half, n);
  const fMean = firstHalf.length ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
  const sMean = secondHalf.length ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;
  const trend = Math.max(-1, Math.min(1, (sMean - fMean) * 4));

  return {
    mean,
    max,
    variance,
    voicedRatio: voicedCount / n,
    startRamp,
    pauseRatio: pauseMs / totalMs,
    trend,
  };
}

// Transcript cue words that signal strong hooks / curiosity
const HOOK_CUES = [
  "never", "always", "secret", "only", "actually", "completely", "wrong",
  "changed", "mistake", "biggest", "best", "worst", "how", "why", "what",
  "nobody", "everyone", "most", "first", "number", "million", "billion",
  "stop", "start", "before", "after", "impossible", "possible",
];

function textInWindow(transcript: Transcript | null, startMs: number, endMs: number): string {
  if (!transcript?.words) return "";
  return transcript.words
    .filter((w) => w.startMs >= startMs && w.startMs < endMs)
    .map((w) => w.word)
    .join(" ")
    .trim();
}

function hookBoostFromText(text: string): number {
  if (!text) return 0;
  const lower = ` ${text.toLowerCase()} `;
  let boost = 0;
  for (const cue of HOOK_CUES) {
    if (lower.includes(` ${cue} `) || lower.startsWith(`${cue} `)) boost += 0.12;
  }
  if (/[?!]$/.test(text)) boost += 0.15;
  return Math.min(0.5, boost);
}

const REASON_FACTORS: { key: keyof ScoreFactors; text: string; on: (v: number) => boolean }[] = [
  { key: "hook", text: "Strong opening hook", on: (v) => v >= 0.55 },
  { key: "density", text: "High speech density", on: (v) => v >= 0.62 },
  { key: "standalone", text: "Clean in/out points — stands alone", on: (v) => v >= 0.6 },
  { key: "intensity", text: "High emotional intensity", on: (v) => v >= 0.55 },
  { key: "clarity", text: "Clear, consistent pacing", on: (v) => v >= 0.6 },
  { key: "visual", text: "Visually varied (scene changes)", on: (v) => v >= 0.5 },
  { key: "pacing", text: "Tight pacing, minimal dead air", on: (v) => v >= 0.6 },
];

function reasonsFromFactors(f: ScoreFactors): string[] {
  const reasons: string[] = [];
  const order: (keyof ScoreFactors)[] = ["hook", "intensity", "density", "standalone", "clarity", "pacing", "visual"];
  for (const key of order) {
    const entry = REASON_FACTORS.find((r) => r.key === key);
    if (entry && entry.on(f[key])) reasons.push(entry.text);
    if (reasons.length >= 4) break;
  }
  if (reasons.length === 0) reasons.push("Balanced, reliable segment");
  return reasons;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ---------------------------------------------------------------------------
// Public discovery entrypoint
// ---------------------------------------------------------------------------
export function discoverClips(
  signals: AnalysisSignals,
  transcript: Transcript | null,
  strategyId: ClipStrategy,
  maxClips = 10,
): ClipCandidate[] {
  const strategy = getStrategy(strategyId);
  const raw = generateCandidates(signals, strategy);

  const scored: ClipCandidate[] = raw.map((c) => {
    const s = statsFor(signals, c.startMs, c.endMs);
    const text = textInWindow(transcript, c.startMs, c.endMs);

    // --- factors (0..1) --------------------------------------------------
    const hook = clamp01(0.5 + s.startRamp * 1.6 + hookBoostFromText(text));
    const density = clamp01(s.voicedRatio * 1.2);
    const standalone = clamp01(
      s.pauseRatio <= 0.12 ? 0.85 : 1 - s.pauseRatio * 1.5,
    );
    const intensity = clamp01(0.35 + s.max * 0.5 + Math.sqrt(s.variance) * 0.4);
    const clarity = clamp01(1 - s.pauseRatio * 1.8 + 0.2);
    // visual variety: how many scene changes fall inside the window
    const visual = clamp01(
      signals.scenes.filter((sc) => sc > c.startMs && sc < c.endMs).length * 0.12 + 0.3,
    );
    const pacing = clamp01(1 - s.pauseRatio * 2 + Math.abs(s.trend) * 0.15);

    const factors: ScoreFactors = { hook, density, standalone, intensity, clarity, visual, pacing };

    // --- weighted score ------------------------------------------------
    const weights = strategy.weights;
    let total = 0;
    let weightSum = 0;
    for (const key of Object.keys(factors) as (keyof ScoreFactors)[]) {
      const w = weights[key] ?? 1;
      total += factors[key] * w;
      weightSum += w;
    }
    // small length preference: closer to target duration scores slightly higher
    const len = c.endMs - c.startMs;
    const lenFit = 1 - Math.min(1, Math.abs(len - strategy.targetDurationMs) / strategy.targetDurationMs) * 0.25;
    const score = Math.round((total / weightSum) * 100 * (0.9 + lenFit * 0.1));

    return {
      startMs: c.startMs,
      endMs: c.endMs,
      durationMs: len,
      score: Math.max(0, Math.min(99, score)),
      subScores: factors,
      reasons: reasonsFromFactors(factors),
      strategy: strategyId,
    };
  });

  // --- dedupe: keep highest-scoring, drop >40% overlapping candidates ----
  scored.sort((a, b) => b.score - a.score);
  const kept: ClipCandidate[] = [];
  for (const c of scored) {
    const overlaps = kept.some((k) => {
      const overlap = Math.min(k.endMs, c.endMs) - Math.max(k.startMs, c.startMs);
      const shorter = Math.min(k.durationMs, c.durationMs);
      return shorter > 0 && overlap / shorter > 0.4;
    });
    if (!overlaps) kept.push(c);
    if (kept.length >= maxClips) break;
  }
  return kept.sort((a, b) => b.score - a.score);
}
