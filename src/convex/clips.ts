import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { aspectRatioValidator, clipStrategyValidator } from "./schema";

const NOW = () => Date.now();

export const createClips = mutation({
  args: {
    videoId: v.id("videos"),
    clips: v.array(
      v.object({
        startMs: v.number(),
        endMs: v.number(),
        score: v.number(),
        subScores: v.optional(v.any()),
        reasons: v.array(v.string()),
        strategy: clipStrategyValidator,
        hook: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const video = await ctx.db.get(args.videoId);
    if (!video || video.userId !== userId) throw new Error("Forbidden");

    const now = NOW();
    let created = 0;
    for (const clip of args.clips) {
      await ctx.db.insert("clips", {
        projectId: video.projectId,
        userId,
        videoId: args.videoId,
        startMs: clip.startMs,
        endMs: clip.endMs,
        score: clip.score,
        subScores: clip.subScores,
        reasons: clip.reasons,
        strategy: clip.strategy,
        hook: clip.hook,
        aspect: "9:16",
        captionsEnabled: true,
        status: "draft",
        createdAt: now,
      });
      created++;
    }
    const project = await ctx.db.get(video.projectId);
    if (project) {
      await ctx.db.patch(project._id, {
        clipCount: project.clipCount + created,
        updatedAt: now,
      });
    }
    return created;
  },
});

export const updateClip = mutation({
  args: {
    clipId: v.id("clips"),
    startMs: v.optional(v.number()),
    endMs: v.optional(v.number()),
    score: v.optional(v.number()),
    reasons: v.optional(v.array(v.string())),
    aspect: v.optional(aspectRatioValidator),
    captionsEnabled: v.optional(v.boolean()),
    captionStyle: v.optional(v.string()),
    hook: v.optional(v.string()),
    hooks: v.optional(v.any()),
    titles: v.optional(v.any()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("rendering"),
        v.literal("ready"),
        v.literal("failed"),
      ),
    ),
    renderUrl: v.optional(v.string()),
    renderError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.userId !== userId) throw new Error("Forbidden");
    const patch: Record<string, unknown> = {};
    for (const key of [
      "startMs",
      "endMs",
      "score",
      "reasons",
      "aspect",
      "captionsEnabled",
      "captionStyle",
      "hook",
      "hooks",
      "titles",
      "status",
      "renderUrl",
      "renderError",
    ] as const) {
      if (args[key] !== undefined) patch[key] = args[key];
    }
    await ctx.db.patch(args.clipId, patch);
  },
});

export const deleteClip = mutation({
  args: { clipId: v.id("clips") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.userId !== userId) throw new Error("Forbidden");
    const jobs = await ctx.db
      .query("renderJobs")
      .withIndex("by_clip", (q) => q.eq("clipId", args.clipId))
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
    await ctx.db.delete(args.clipId);
    const project = await ctx.db.get(clip.projectId);
    if (project) {
      await ctx.db.patch(project._id, {
        clipCount: Math.max(0, project.clipCount - 1),
        updatedAt: NOW(),
      });
    }
  },
});

export const listClips = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) return [];

    const clips = await ctx.db
      .query("clips")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();

    // join video metadata for cards
    const videoIds = [...new Set(clips.map((c) => c.videoId))];
    const videos = new Map(
      await Promise.all(
        videoIds.map(async (id) => {
          const video = await ctx.db.get(id);
          return [id, video] as const;
        }),
      ),
    );

    return clips.map((clip) => {
      const video = videos.get(clip.videoId);
      return {
        ...clip,
        videoName: video?.name ?? "Unknown video",
        videoDurationMs: video?.durationMs ?? 0,
        videoThumbnail: video?.thumbnail ?? null,
        hasTranscript: video?.transcriptionStatus === "done",
        transcript: video?.transcript ?? null,
      };
    });
  },
});

export const listRecentClips = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const clips = await ctx.db
      .query("clips")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 8);
    const videoIds = [...new Set(clips.map((c) => c.videoId))];
    const videos = new Map(
      await Promise.all(
        videoIds.map(async (id) => {
          const video = await ctx.db.get(id);
          return [id, video] as const;
        }),
      ),
    );
    const projects = new Map(
      await Promise.all(
        [...new Set(clips.map((c) => c.projectId))].map(async (id) => {
          const p = await ctx.db.get(id);
          return [id, p] as const;
        }),
      ),
    );
    return clips.map((clip) => {
      const video = videos.get(clip.videoId);
      const project = projects.get(clip.projectId);
      return {
        ...clip,
        videoName: video?.name ?? "",
        videoThumbnail: video?.thumbnail ?? null,
        projectName: project?.name ?? "",
      };
    });
  },
});

export const getClip = query({
  args: { clipId: v.id("clips") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.userId !== userId) return null;
    const video = await ctx.db.get(clip.videoId);
    const videoUrl = video?.storageId
      ? await ctx.storage.getUrl(video.storageId)
      : null;
    return {
      ...clip,
      videoName: video?.name ?? "",
      videoUrl,
      videoDurationMs: video?.durationMs ?? 0,
      videoThumbnail: video?.thumbnail ?? null,
      videoSignals: video?.signals ?? null,
      transcript: video?.transcript ?? null,
    };
  },
});
