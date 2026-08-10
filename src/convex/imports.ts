"use node";

/**
 * URL IMPORT LAYER
 * ----------------
 * Imports a video from a link into the user's project. The architecture is
 * provider-agnostic:
 *
 *   provider "url"     → direct file URL (works today, no auth needed)
 *   provider "youtube" → needs a proper adapter (YouTube Data API / partner
 *                        download flow) — deliberately NOT scraping
 *   provider "drive"   → needs OAuth + Drive API (export links)
 *   provider "dropbox" → needs OAuth + Dropbox API (dl=1 links)
 *
 * Until an adapter exists, non-"url" providers reject with a clear message.
 * A future adapter simply maps provider+id → an authenticated media URL and
 * hands it to the same storage path below.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, same as direct uploads
const VIDEO_MIME = /^(video\/|application\/octet-stream|application\/x-mpegURL)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi|ogv|mpg|mpeg|3gp)$/i;

export const importFromUrl = action({
  args: {
    projectId: v.id("projects"),
    url: v.string(),
    name: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ videoId: Id<"videos">; url: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const project = await ctx.runQuery(internal.importsHelpers.getProjectForImport, {
      projectId: args.projectId,
      userId,
    });
    if (!project) throw new Error("Forbidden");

    let parsed: URL;
    try {
      parsed = new URL(args.url);
    } catch {
      throw new Error("That doesn't look like a valid URL.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Only http(s) URLs are supported.");
    }

    const provider = args.provider ?? "url";
    if (provider !== "url") {
      throw new Error(
        `${provider} import isn't wired up yet — paste a direct link to the video file instead.`,
      );
    }

    const res = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "clippy-importer/1.0" },
    });
    if (!res.ok) {
      throw new Error(`Could not fetch that URL (${res.status} ${res.statusText}).`);
    }

    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMPORT_BYTES) {
      throw new Error("File at that URL is over the 2GB import limit.");
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0];
    const looksLikeVideo =
      VIDEO_MIME.test(contentType) || VIDEO_EXT.test(parsed.pathname);
    if (!looksLikeVideo) {
      throw new Error(
        "That link doesn't point to a video file (MP4, MOV, WebM, MKV…).",
      );
    }

    const fallbackName =
      parsed.pathname.split("/").pop()?.replace(/\.[^.]+$/, "")?.trim() ||
      "Imported video";
    const name = (args.name?.trim() || fallbackName).slice(0, 120);

    const blob = await res.blob();
    const storageId = await ctx.storage.store(blob);

    const videoId: Id<"videos"> = await ctx.runMutation(
      internal.importsHelpers.createImportedVideo,
      {
        projectId: args.projectId,
        userId,
        name,
        mimeType: contentType || "video/mp4",
        size: blob.size || contentLength || 0,
        storageId,
        source: "url",
      },
    );

    const videoUrl = await ctx.storage.getUrl(storageId);
    return { videoId, url: videoUrl ?? null };
  },
});
