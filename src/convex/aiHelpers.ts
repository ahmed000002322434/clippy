import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Read a video row (with playable URL) from inside an action. */
export const getVideoForAi = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const video = await ctx.db.get(args.videoId);
    if (!video) return null;
    const url = video.storageId
      ? await ctx.storage.getUrl(video.storageId)
      : null;
    return { ...video, url };
  },
});

/** Persist a transcript + status from inside an action. */
export const persistTranscript = internalMutation({
  args: {
    videoId: v.id("videos"),
    transcript: v.optional(v.any()),
    status: v.union(
      v.literal("none"),
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("unconfigured"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.videoId, {
      transcript: args.transcript,
      transcriptionStatus: args.status,
      transcriptionError: args.error,
    });
  },
});
