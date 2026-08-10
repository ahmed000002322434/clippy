import type { CaptionLine, CaptionStyle, CaptionWord, Transcript } from "./types";

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------
export const CAPTION_STYLES: CaptionStyle[] = [
  {
    id: "pulse",
    name: "Pulse",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizePx: 64,
    fontWeight: 800,
    color: "#FFFFFF",
    strokeColor: "rgba(0,0,0,0.85)",
    strokeWidth: 7,
    highlightColor: "#FFD166",
    backgroundColor: "rgba(0,0,0,0.35)",
    bgOpacity: 0.5,
    position: "bottom",
    animation: "pop",
    uppercase: true,
  },
  {
    id: "bold",
    name: "Bold Caps",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizePx: 58,
    fontWeight: 900,
    color: "#FFFFFF",
    strokeColor: "rgba(0,0,0,0.9)",
    strokeWidth: 6,
    highlightColor: "#FFFFFF",
    backgroundColor: null,
    bgOpacity: 0,
    position: "bottom",
    animation: "none",
    uppercase: true,
  },
  {
    id: "minimal",
    name: "Minimal",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizePx: 48,
    fontWeight: 600,
    color: "#FFFFFF",
    strokeColor: "rgba(0,0,0,0.6)",
    strokeWidth: 3,
    highlightColor: "#FFF3C4",
    backgroundColor: null,
    bgOpacity: 0,
    position: "bottom",
    animation: "fade",
    uppercase: false,
  },
  {
    id: "karaoke",
    name: "Karaoke",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizePx: 62,
    fontWeight: 800,
    color: "#FFFFFF",
    strokeColor: "rgba(0,0,0,0.7)",
    strokeWidth: 4,
    highlightColor: "#7CF5C0",
    backgroundColor: "rgba(0,0,0,0.3)",
    bgOpacity: 0.4,
    position: "bottom",
    animation: "none",
    uppercase: false,
  },
  {
    id: "typewriter",
    name: "Typewriter",
    fontFamily: "'Courier New', monospace",
    fontSizePx: 52,
    fontWeight: 700,
    color: "#FFFFFF",
    strokeColor: "rgba(0,0,0,0.8)",
    strokeWidth: 5,
    highlightColor: "#FF9F9F",
    backgroundColor: null,
    bgOpacity: 0,
    position: "bottom",
    animation: "slide",
    uppercase: false,
  },
  {
    id: "pop",
    name: "Pop",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizePx: 70,
    fontWeight: 900,
    color: "#FFFFFF",
    strokeColor: "#B02A1C",
    strokeWidth: 8,
    highlightColor: "#FFD166",
    backgroundColor: "rgba(0,0,0,0.4)",
    bgOpacity: 0.55,
    position: "bottom",
    animation: "pop",
    uppercase: true,
  },
];

export function getCaptionStyle(id: string | undefined): CaptionStyle {
  return CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];
}

// ---------------------------------------------------------------------------
// Semantic emphasis — which words deserve highlighting
// ---------------------------------------------------------------------------
const CUE_WORDS = new Set([
  "never", "always", "secret", "only", "completely", "totally", "wrong",
  "changed", "mistake", "biggest", "best", "worst", "impossible", "possible",
  "nobody", "everyone", "everything", "nothing", "number", "million", "billion",
  "first", "last", "stop", "start", "imagine", "actually", "literally",
  "one", "zero", "hundred", "thousand", "attention", "listen", "remember",
  "new", "free", "instant", "exactly", "truly",
]);

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "so", "of", "to", "in", "on", "for",
  "with", "at", "by", "from", "as", "is", "are", "was", "were", "be", "been",
  "it", "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
  "my", "your", "his", "her", "our", "their", "me", "him", "us", "them",
]);

function salience(word: string, docFreq: Map<string, number>): number {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w || w.length <= 2) return 0;
  if (STOP_WORDS.has(w)) return 0.05;
  let s = 0.2;
  if (CUE_WORDS.has(w)) s += 0.55;
  const freq = docFreq.get(w) ?? 1;
  // rarer words are more likely to carry meaning
  s += Math.max(0, 0.45 - Math.min(0.4, (freq - 1) * 0.06));
  if (/^\d+$/.test(w)) s += 0.4;
  return s;
}

function buildDocFreq(words: { word: string }[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const w of words) {
    const key = w.word.toLowerCase().replace(/[^a-z']/g, "");
    if (key) freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  return freq;
}

// ---------------------------------------------------------------------------
// Line building — greedy fill with clause-aware breaks
// ---------------------------------------------------------------------------
export function buildCaptionLines(
  transcript: Transcript | null,
  maxChars = 28,
): CaptionLine[] {
  if (!transcript?.words?.length) return [];
  const docFreq = buildDocFreq(transcript.words);
  const lines: CaptionLine[] = [];
  let current: CaptionWord[] = [];
  let currentChars = 0;

  const flush = (last = false) => {
    if (current.length === 0) return;
    const startMs = current[0].startMs;
    const endMs = current[current.length - 1].endMs;
    // emphasis: top 1-2 words by salience per line
    const scored = current.map((w, i) => ({
      w,
      i,
      s: salience(w.word, docFreq) + (i === 0 ? 0.08 : 0),
    }));
    const sorted = [...scored].sort((a, b) => b.s - a.s);
    const top = new Set(sorted.slice(0, 2).map((x) => x.i));
    const words = current.map((w, i) => ({
      ...w,
      emphasis: top.has(i) && !STOP_WORDS.has(w.word.toLowerCase()),
    }));
    lines.push({
      text: words.map((w) => w.word).join(" "),
      startMs,
      endMs,
      words,
    });
    current = [];
    currentChars = 0;
    void last;
  };

  for (const w of transcript.words) {
    const len = w.word.length + 1;
    if (currentChars + len > maxChars && current.length > 0) {
      flush();
    }
    current.push({ ...w, emphasis: false });
    currentChars += len;
    // break after punctuation
    if (/[.!?]$/.test(w.word)) flush();
  }
  flush(true);
  return lines;
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------
export function drawCaptionLine(
  ctx: CanvasRenderingContext2D,
  line: CaptionLine | undefined,
  timeMs: number,
  style: CaptionStyle,
) {
  if (!line) return;
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;
  const activeWordIndex = line.words.findIndex(
    (w) => timeMs >= w.startMs && timeMs <= w.endMs + 40,
  );

  const baseFontSize = Math.min(style.fontSizePx, canvasW * 0.075);
  const font = `${style.fontWeight} ${baseFontSize}px ${style.fontFamily}`;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const fullText = style.uppercase ? line.text.toUpperCase() : line.text;
  const metrics = ctx.measureText(fullText);
  const textW = metrics.width;
  const lineH = baseFontSize * 1.25;
  const padX = baseFontSize * 0.55;
  const padY = baseFontSize * 0.3;

  const yBase =
    style.position === "top"
      ? canvasH * 0.14
      : style.position === "middle"
        ? canvasH * 0.45
        : canvasH * 0.84;
  const xCenter = canvasW / 2;

  // background bubble
  if (style.backgroundColor) {
    ctx.fillStyle = style.backgroundColor;
    const r = lineH * 0.65;
    ctx.beginPath();
    ctx.roundRect(xCenter - textW / 2 - padX, yBase - lineH / 2 - padY, textW + padX * 2, lineH + padY * 2, r);
    ctx.fill();
  }

  // Per-word layout
  let cursorX = xCenter - textW / 2;
  let emphasisIndex = -1;
  const words = style.uppercase
    ? line.words.map((w) => ({ ...w, word: w.word.toUpperCase() }))
    : line.words;

  // measure each word for positioning
  const wordMetrics = words.map((w) => ({
    w,
    ww: ctx.measureText(w.word).width,
  }));
  // account for spaces
  const totalW = wordMetrics.reduce((acc, m, i) => acc + m.ww + (i > 0 ? ctx.measureText(" ").width : 0), 0);
  cursorX = xCenter - totalW / 2;

  for (let i = 0; i < wordMetrics.length; i++) {
    const { w, ww } = wordMetrics[i];
    if (i === activeWordIndex) emphasisIndex = i;
    const isActive = i === activeWordIndex;
    const isEmphasis = w.emphasis;

    let scale = 1;
    if (isActive && style.animation === "pop") scale = 1.12;
    if (isEmphasis && isActive) scale = 1.18;

    const y = yBase + (isActive && style.animation === "pop" ? -baseFontSize * 0.05 : 0);

    ctx.save();
    ctx.translate(cursorX + ww / 2, y);
    ctx.scale(scale, scale);
    ctx.translate(-(cursorX + ww / 2), -y);

    // stroke (outline)
    if (style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth;
      ctx.strokeText(w.word, cursorX + ww / 2, y);
    }
    // fill
    ctx.fillStyle = isActive && isEmphasis ? style.highlightColor : style.color;
    ctx.fillText(w.word, cursorX + ww / 2, y);

    ctx.restore();
    cursorX += ww + ctx.measureText(" ").width;
  }
  void emphasisIndex;
}
