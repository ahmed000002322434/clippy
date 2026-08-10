import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { TRANSCRIPTION_STATUS, VIDEO_STATUS } from "./schema";

const NOW = () => Date.now();

/** Generate a single-use upload URL for Convex file storage. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

export const createVideo = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    durationMs: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    thumbnail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) throw new Error("Forbidden");

    const videoId = await ctx.db.insert("videos", {
      projectId: args.projectId,
      userId,
      name: args.name,
      mimeType: args.mimeType,
      size: args.size,
      storageId: args.storageId,
      durationMs: args.durationMs,
      width: args.width,
      height: args.height,
      thumbnail: args.thumbnail,
      status: "ready",
      transcriptionStatus: "none",
      createdAt: NOW(),
    });

    // Track storage usage + project counts
    const user = await ctx.db.get(userId);
    await ctx.db.patch(userId, {
      storageBytes: (user?.storageBytes ?? 0) + args.size,
    });
    await ctx.db.patch(args.projectId, {
      videoCount: project.videoCount + 1,
      updatedAt: NOW(),
    });
    return videoId;
  },
});

export const updateVideo = mutation({
  args: {
    videoId: v.id("videos"),
    status: v.optional(VIDEO_STATUS),
    durationMs: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    thumbnail: v.optional(v.string()),
    signals: v.optional(v.any()),
    error: v.optional(v.string()),
    analyzedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const video = await ctx.db.get(args.videoId);
    if (!video || video.userId !== userId) throw new Error("Forbidden");
    const patch: Record<string, unknown> = {};
    if (args.status !== undefined) patch.status = args.status;
    if (args.durationMs !== undefined) patch.durationMs = args.durationMs;
    if (args.width !== undefined) patch.width = args.width;
    if (args.height !== undefined) patch.height = args.height;
    if (args.thumbnail !== undefined) patch.thumbnail = args.thumbnail;
    if (args.signals !== undefined) patch.signals = args.signals;
    if (args.error !== undefined) patch.error = args.error;
    if (args.analyzedAt !== undefined) patch.analyzedAt = args.analyzedAt;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.videoId, patch);
      const project = await ctx.db.get(video.projectId);
      if (project) {
        await ctx.db.patch(project._id, { updatedAt: NOW() });
      }
    }
  },
});

export const setTranscript = mutation({
  args: {
    videoId: v.id("videos"),
    transcript: v.optional(v.any()),
    status: TRANSCRIPTION_STATUS,
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const video = await ctx.db.get(args.videoId);
    if (!video || video.userId !== userId) throw new Error("Forbidden");
    await ctx.db.patch(args.videoId, {
      transcript: args.transcript,
      transcriptionStatus: args.status,
      transcriptionError: args.error,
    });
  },
});

export const deleteVideo = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const video = await ctx.db.get(args.videoId);
    if (!video || video.userId !== userId) throw new Error("Forbidden");

    const clips = await ctx.db
      .query("clips")
      .withIndex("by_video", (q) => q.eq("videoId", args.videoId))
      .collect();
    for (const clip of clips) {
      const jobs = await ctx.db
        .query("renderJobs")
        .withIndex("by_clip", (q) => q.eq("clipId", clip._id))
        .collect();
      for (const job of jobs) {
        if (job.storageId) {
          try {
            await ctx.storage.delete(job.storageId);
          } catch {
            // ignore
          }
        }
        await ctx.db.delete(job._id);
      }
      await ctx.db.delete(clip._id);
    }

    if (video.storageId) {
      try {
        await ctx.storage.delete(video.storageId);
      } catch {
        // ignore
      }
    }
    await ctx.db.delete(args.videoId);

    const user = await ctx.db.get(userId);
    await ctx.db.patch(userId, {
      storageBytes: Math.max(0, (user?.storageBytes ?? 0) - video.size),
    });
    const project = await ctx.db.get(video.projectId);
    if (project) {
      await ctx.db.patch(project._id, {
        videoCount: Math.max(0, project.videoCount - 1),
        clipCount: Math.max(0, project.clipCount - clips.length),
        updatedAt: NOW(),
      });
    }
  },
});

export const listVideos = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) return [];

    const videos = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
    return Promise.all(
      videos.map(async (video) => {
        const url = video.storageId
          ? await ctx.storage.getUrl(video.storageId)
          : null;
        return { ...video, url };
      }),
    );
  },
});

export const getVideo = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const video = await ctx.db.get(args.videoId);
    if (!video || video.userId !== userId) return null;
    const url = video.storageId ? await ctx.storage.getUrl(video.storageId) : null;
    return { ...video, url };
  },
});
