import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { RENDER_JOB_STATUS } from "./schema";

const NOW = () => Date.now();

export const createRenderJob = mutation({
  args: {
    clipId: v.id("clips"),
    format: v.string(),
    resolution: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const clip = await ctx.db.get(args.clipId);
    if (!clip || clip.userId !== userId) throw new Error("Forbidden");

    const now = NOW();
    const jobId = await ctx.db.insert("renderJobs", {
      clipId: args.clipId,
      projectId: clip.projectId,
      userId,
      status: "queued",
      progress: 0,
      format: args.format,
      resolution: args.resolution,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.clipId, { status: "rendering" });
    // Rendering counts as activity — keeps the source original around.
    await ctx.db.patch(clip.videoId, { lastActivityAt: now });
    return jobId;
  },
});

export const updateRenderJob = mutation({
  args: {
    jobId: v.id("renderJobs"),
    status: v.optional(RENDER_JOB_STATUS),
    progress: v.optional(v.number()),
    error: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Forbidden");

    const patch: Record<string, unknown> = { updatedAt: NOW() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.progress !== undefined) patch.progress = args.progress;
    if (args.error !== undefined) patch.error = args.error;
    if (args.storageId !== undefined) patch.storageId = args.storageId;
    await ctx.db.patch(args.jobId, patch);

    // reflect on the clip
    const clip = await ctx.db.get(job.clipId);
    if (clip) {
      // Render progress/completion counts as activity on the source video.
      await ctx.db.patch(clip.videoId, { lastActivityAt: NOW() });
      if (args.status === "completed") {
        const url = args.storageId
          ? await ctx.storage.getUrl(args.storageId)
          : null;
        await ctx.db.patch(clip._id, {
          status: "ready",
          renderUrl: url ?? undefined,
        });
      } else if (args.status === "failed") {
        await ctx.db.patch(clip._id, {
          status: "failed",
          renderError: args.error,
        });
      }
    }
  },
});

export const listRenderJobs = query({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) return [];
    return await ctx.db
      .query("renderJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

/**
 * Recent completed exports across all projects, joined with clip / video /
 * project metadata so the dashboard can show a real export history.
 */
export const listRecentExports = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const jobs = await ctx.db
      .query("renderJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 8);

    const clipIds = [...new Set(jobs.map((j) => j.clipId))];
    const clips = new Map(
      await Promise.all(
        clipIds.map(async (id) => {
          const clip = await ctx.db.get(id);
          return [id, clip] as const;
        }),
      ),
    );
    const projectIds = [...new Set(jobs.map((j) => j.projectId))];
    const projects = new Map(
      await Promise.all(
        projectIds.map(async (id) => {
          const p = await ctx.db.get(id);
          return [id, p] as const;
        }),
      ),
    );
    const videoIds = [...new Set(clips.values())].filter(Boolean).map((c) => c!.videoId);
    const videos = new Map(
      await Promise.all(
        videoIds.map(async (id) => {
          const video = await ctx.db.get(id);
          return [id, video] as const;
        }),
      ),
    );

    return Promise.all(
      jobs.map(async (job) => {
        const clip = clips.get(job.clipId);
        const video = clip ? videos.get(clip.videoId) : null;
        const project = projects.get(job.projectId);
        const renderUrl = job.storageId
          ? await ctx.storage.getUrl(job.storageId)
          : null;
        return {
          ...job,
          renderUrl,
          clipStartMs: clip?.startMs ?? 0,
          clipEndMs: clip?.endMs ?? 0,
          clipAspect: clip?.aspect ?? "9:16",
          videoName: video?.name ?? "Unknown video",
          videoThumbnail: video?.thumbnail ?? null,
          projectName: project?.name ?? "",
        };
      }),
    );
  },
});
