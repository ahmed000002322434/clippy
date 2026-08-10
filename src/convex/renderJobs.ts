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
