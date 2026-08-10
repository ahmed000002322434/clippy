import type { ClipStrategy, HookOption, PlatformTitles } from "./types";

const STRATEGY_TAGS: Record<ClipStrategy, string[]> = {
  viral: ["viral", "shorts", "trending", "fyp"],
  educational: ["learn", "tips", "education", "howto"],
  funny: ["funny", "comedy", "lol", "relatable"],
  storytelling: ["story", "storytime", "journey"],
  motivational: ["motivation", "mindset", "growth", "success"],
  podcast: ["podcast", "podcastclips", "conversation"],
  business: ["business", "entrepreneur", "marketing", "startup"],
  news: ["news", "breaking", "update"],
  interview: ["interview", "insights", "expert"],
  custom: ["clips", "shorts", "viral"],
};

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4 && /\w/.test(s));
}

function clipSentence(text: string, maxWords = 14): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  let out = words.slice(0, maxWords).join(" ");
  if (!/[.!?]$/.test(out)) out += "…";
  return out;
}

function firstPunchy(sentencesArr: string[]): string {
  if (sentencesArr.length === 0) return "";
  // prefer a short-ish opening sentence (hook-first content)
  const short = sentencesArr.find((s) => s.split(/\s+/).length <= 18);
  return short ?? sentencesArr[0];
}

function mostCurious(sentencesArr: string[]): string {
  const cues = /\b(but|actually|never|always|secret|wrong|only|nobody|everyone|why|how|stop|start|impossible|mistake)\b/i;
  return sentencesArr.find((s) => cues.test(s)) ?? firstPunchy(sentencesArr);
}

function sentenceWithNumber(sentencesArr: string[]): string {
  return sentencesArr.find((s) => /\d/.test(s)) ?? firstPunchy(sentencesArr);
}

function stripQuotes(s: string): string {
  return s.replace(/^["']+|["']+$/g, "").trim();
}

function keyPhrase(sentence: string, maxWords = 6): string {
  const words = sentence.split(/\s+/);
  if (words.length <= maxWords) return stripQuotes(sentence);
  // find a meaningful window: start at a cue word if present
  const cueIdx = words.findIndex((w) =>
    /^(but|actually|never|always|secret|only|wrong|nobody|how|why|this|that|the|you|your|i)$/i.test(w),
  );
  const start = cueIdx >= 0 ? Math.min(cueIdx, words.length - maxWords) : 0;
  const phrase = words.slice(start, start + maxWords).join(" ");
  return stripQuotes(phrase).replace(/[.!?]+$/, "");
}

/**
 * Deterministic hook generation grounded in the actual transcript.
 * Produces the same 5-hook structure the OpenAI provider returns, so the
 * UI never needs to know which generator produced them.
 */
export function generateHooksHeuristic(
  transcriptText: string,
  strategy: ClipStrategy,
): HookOption[] {
  const sents = sentences(transcriptText);
  const opening = clipSentence(firstPunchy(sents));
  const curious = clipSentence(mostCurious(sents));
  const numbered = clipSentence(sentenceWithNumber(sents));
  const phrase = keyPhrase(curious || opening);

  const hooks: HookOption[] = [
    { label: "Original", text: opening || "A moment worth watching." },
    { label: "Curiosity", text: `Most people don't know ${phrase.toLowerCase()} — here's the truth.` },
    { label: "Bold", text: `This changes everything: ${phrase.toLowerCase()}.` },
    { label: "Educational", text: `Here's why ${phrase.toLowerCase()} actually matters.` },
    { label: "Short", text: clipSentence(phrase, 6) },
  ];

  // Strategy-flavored variants
  switch (strategy) {
    case "viral":
      hooks[2] = { label: "Bold", text: `Wait until you hear ${phrase.toLowerCase()}…` };
      break;
    case "funny":
      hooks[2] = { label: "Bold", text: `Nobody talks about this — ${phrase.toLowerCase()}.` };
      break;
    case "motivational":
      hooks[1] = { label: "Curiosity", text: `The moment everything changed: ${phrase.toLowerCase()}.` };
      break;
    case "business":
      hooks[3] = { label: "Educational", text: `${numbered || opening} — here's the breakdown.` };
      break;
    default:
      break;
  }
  return hooks.filter((h) => h.text.length > 3).slice(0, 5);
}

export function generateTitlesHeuristic(
  transcriptText: string,
  strategy: ClipStrategy,
): PlatformTitles {
  const sents = sentences(transcriptText);
  const opening = clipSentence(firstPunchy(sents), 10);
  const phrase = keyPhrase(mostCurious(sents));
  const tagPool = STRATEGY_TAGS[strategy] ?? STRATEGY_TAGS.custom;
  const tags = [...new Set(["#" + tagPool[0], "#" + tagPool[1], "#shortform", "#contentcreator", "#" + tagPool[2]])];

  return {
    shorts: `${opening} #shorts`,
    tiktok: `${phrase} #fyp`,
    instagram: `${phrase} — save this for later ✨`,
    hashtags: tags,
    keywords: [phrase.split(" ")[0], phrase.split(" ")[1] ?? "clip", strategy],
  };
}

/** Pick the strongest first sentence for a clip preview (used in cards). */
export function hookForCandidate(
  transcriptText: string,
  strategy: ClipStrategy,
): string | undefined {
  const hooks = generateHooksHeuristic(transcriptText, strategy);
  return hooks[0]?.text;
}
