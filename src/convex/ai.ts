"use node";

/**
 * AI PROVIDER LAYER
 * -----------------
 * All external AI calls live behind this module. The rest of the app never
 * talks to a provider directly — swap providers by editing the adapters below.
 *
 *  - transcription  → Deepgram (word-level timestamps + speaker diarization)
 *  - language       → OpenAI (hooks, titles, hashtags, captions)
 *
 * When a provider key is absent, these actions return `null` / `{configured:
 * false}` — they never fabricate results. The UI surfaces the exact env var
 * needed to activate each capability.
 *
 * Required env vars (paste into the project's Keys / API keys tab):
 *   DEEPGRAM_API_KEY   activates real transcription
 *   OPENAI_API_KEY     activates AI hooks / titles / hashtags
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Transcript shape normalized across providers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Deepgram adapter
// ---------------------------------------------------------------------------
async function transcribeWithDeepgram(
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<Transcript | null> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  const url =
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&diarize=true&utterances=false";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": mimeType || "application/octet-stream",
    },
    body: bytes,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const alt = json?.results?.channels?.[0]?.alternatives?.[0];
  const words: TranscriptWord[] = (alt?.words ?? []).map((w: any) => ({
    word: w.word ?? "",
    startMs: Math.round((w.start ?? 0) * 1000),
    endMs: Math.round((w.end ?? 0) * 1000),
    speaker: typeof w.speaker === "number" ? w.speaker : 0,
  }));
  if (words.length === 0) return null;

  // group words into speaker-tagged segments with sentence-ish breaks
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  for (const w of words) {
    if (
      !current ||
      current.speaker !== w.speaker ||
      w.startMs - current.endMs > 4000 ||
      (w.word.match(/[.!?]$/) && w.endMs - current.startMs > 4000)
    ) {
      if (current) segments.push(current);
      current = {
        speaker: w.speaker ?? 0,
        startMs: w.startMs,
        endMs: w.endMs,
        text: w.word,
        words: [w],
      };
    } else {
      current.endMs = w.endMs;
      current.text = `${current.text} ${w.word}`;
      current.words.push(w);
    }
  }
  if (current) segments.push(current);

  return {
    segments,
    text: segments.map((s) => s.text).join(" "),
    words,
    provider: "deepgram",
  };
}

// ---------------------------------------------------------------------------
// OpenAI adapter (hooks + titles)
// ---------------------------------------------------------------------------
interface HookPack {
  hooks: { label: string; text: string }[];
  titles: { shorts: string; tiktok: string; instagram: string };
  hashtags: string[];
  keywords: string[];
}

async function generateWithOpenAI(
  transcriptText: string,
  strategy: string,
): Promise<HookPack | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !transcriptText.trim()) return null;
  const snippet = transcriptText.slice(0, 9000);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a short-form content strategist. Given a transcript excerpt and a clip strategy, produce a JSON object exactly like this (no markdown): {\"hooks\":[{\"label\":\"Curiosity\",\"text\":\"...\"},{\"label\":\"Bold\",\"text\":\"...\"},{\"label\":\"Original\",\"text\":\"...\"},{\"label\":\"Educational\",\"text\":\"...\"},{\"label\":\"Short\",\"text\":\"...\"}],\"titles\":{\"shorts\":\"...\",\"tiktok\":\"...\",\"instagram\":\"...\"},\"hashtags\":[\"#tag1\",\"#tag2\",\"#tag3\",\"#tag4\",\"#tag5\"],\"keywords\":[\"kw1\",\"kw2\",\"kw3\"]}. Hooks must be short, punchy, curiosity-driven, under 12 words, and grounded in the actual transcript — never invent facts. Strategy: " +
            strategy,
        },
        { role: "user", content: snippet },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content);
    return {
      hooks: Array.isArray(parsed.hooks) ? parsed.hooks.slice(0, 6) : [],
      titles: parsed.titles ?? {},
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Transcribe a stored video. Returns { configured:false } when no key. */
export const transcribe = action({
  args: { videoId: v.id("videos") },
  handler: async (
    ctx,
    args,
  ): Promise<{ configured: boolean; wordCount?: number }> => {
    const raw = await ctx.runQuery(internal.aiHelpers.getVideoForAi, {
      videoId: args.videoId,
    });
    if (!raw?.storageId) throw new Error("Video not found or not uploaded");

    if (!process.env.DEEPGRAM_API_KEY) {
      await ctx.runMutation(internal.aiHelpers.persistTranscript, {
        videoId: args.videoId,
        status: "unconfigured",
        error: "DEEPGRAM_API_KEY is not set — add it to enable transcription.",
      });
      return { configured: false };
    }

    await ctx.runMutation(internal.aiHelpers.persistTranscript, {
      videoId: args.videoId,
      status: "pending",
    });

    try {
      const url = await ctx.storage.getUrl(raw.storageId);
      if (!url) throw new Error("Storage URL unavailable");
      const fileRes = await fetch(url);
      if (!fileRes.ok) throw new Error(`Fetching media failed: ${fileRes.status}`);
      const bytes = await fileRes.arrayBuffer();
      const transcript = await transcribeWithDeepgram(
        bytes,
        raw.mimeType ?? "video/mp4",
      );
      if (!transcript || transcript.words.length === 0) {
        throw new Error("No speech detected in this video.");
      }
      await ctx.runMutation(internal.aiHelpers.persistTranscript, {
        videoId: args.videoId,
        transcript,
        status: "done",
      });
      return { configured: true, wordCount: transcript.words.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transcription failed";
      await ctx.runMutation(internal.aiHelpers.persistTranscript, {
        videoId: args.videoId,
        status: "failed",
        error: message,
      });
      throw err;
    }
  },
});

/**
 * Generate hooks + platform titles via OpenAI. Returns null when no key or
 * no transcript — the client falls back to its heuristic generator.
 */
export const generateHooks = action({
  args: { videoId: v.id("videos"), strategy: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<HookPack | null> => {
    if (!process.env.OPENAI_API_KEY) return null;
    const stored = await ctx.runQuery(internal.aiHelpers.getVideoForAi, {
      videoId: args.videoId,
    });
    const transcriptText = stored?.transcript?.text ?? "";
    if (!transcriptText.trim()) return null;
    try {
      return await generateWithOpenAI(transcriptText, args.strategy);
    } catch (err) {
      console.error("generateHooks failed:", err);
      return null;
    }
  },
});
