/**
 * Shared types for the AI video pipeline (client engine).
 * These mirror the payload shapes persisted on Convex `videos` and `clips`.
 */

export type AspectRatio = "9:16" | "1:1" | "4:5" | "16:9";

export type ClipStrategy =
  | "viral"
  | "educational"
  | "funny"
  | "storytelling"
  | "motivational"
  | "podcast"
  | "business"
  | "news"
  | "interview"
  | "custom";

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  speaker?: number;
}

export interface TranscriptSegment {
  speaker: number;
  startMs: number;
  endMs: number;
  text: string;
  words: TranscriptWord[];
}

export interface Transcript {
  segments: TranscriptSegment[];
  text: string;
  words: TranscriptWord[];
  provider: string;
}

/** Signal analysis computed in the browser and persisted on the video. */
export interface AnalysisSignals {
  durationMs: number;
  windowMs: number;
  /** RMS energy per window, normalized 0..1 */
  energy: number[];
  /** Speech-likely flag per window */
  voiced: boolean[];
  /** Silence gaps ≥ 300ms */
  pauses: { startMs: number; endMs: number }[];
  /** Scene boundary timestamps (ms) */
  scenes: number[];
  /** Active-region centroid per sampled frame, for content-aware reframing */
  motionCenters: { tMs: number; x: number; y: number }[];
  audioAnalyzed: boolean;
  sampleEveryMs: number;
}

export interface VideoMeta {
  durationMs: number;
  width: number;
  height: number;
  thumbnail: string;
}

/** Per-factor clip scores, 0..1 */
export interface ScoreFactors {
  hook: number;
  density: number;
  standalone: number;
  intensity: number;
  clarity: number;
  visual: number;
  pacing: number;
}

export interface ClipCandidate {
  startMs: number;
  endMs: number;
  durationMs: number;
  score: number; // 0..100
  subScores: ScoreFactors;
  reasons: string[];
  strategy: ClipStrategy;
  hook?: string;
}

export interface StrategyConfig {
  id: ClipStrategy;
  label: string;
  emoji: string;
  description: string;
  weights: Partial<Record<keyof ScoreFactors, number>>;
  targetDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
}

export interface HookOption {
  label: string;
  text: string;
}

export interface PlatformTitles {
  shorts: string;
  tiktok: string;
  instagram: string;
  hashtags: string[];
  keywords: string[];
}

export interface CaptionStyle {
  id: string;
  name: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  highlightColor: string;
  backgroundColor: string | null;
  bgOpacity: number;
  position: "bottom" | "top" | "middle";
  animation: "pop" | "fade" | "slide" | "none";
  uppercase: boolean;
}

export interface CaptionWord {
  word: string;
  startMs: number;
  endMs: number;
  emphasis: boolean;
}

export interface CaptionLine {
  text: string;
  startMs: number;
  endMs: number;
  words: CaptionWord[];
}
