import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { ERROR_CLASS, JOB_STATUS, jobTypeValidator } from "./schema";

const NOW = () => Date.now();

const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Job helpers
// ---------------------------------------------------------------------------

function isTerminal(status: string) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Claim a queued job for processing. Returns the job or null if it's already
 * being processed / finished. Safe against duplicate workers via the claim
 * transition (only a queued/retrying job can become processing).
 */
export const claimJob = mutation({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (job.status !== "queued" && job.status !== "retrying") {
      // Already claimed or finished — idempotent return of current state.
      return job;
    }
    const now = NOW();
    await ctx.db.patch(args.jobId, {
      status: "processing",
      startedAt: job.startedAt ?? now,
      attempts: job.attempts + 1,
      updatedAt: now,
    });
    return await ctx.db.get(args.jobId);
  },
});

/** Report real worker progress + human stage label. */
export const updateJobProgress = mutation({
  args: {
    jobId: v.id("processingJobs"),
    progress: v.number(),
    stage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (isTerminal(job.status)) return;
    await ctx.db.patch(args.jobId, {
      progress: Math.max(0, Math.min(100, args.progress)),
      stage: args.stage,
      updatedAt: NOW(),
    });
  },
});

/**
 * Complete a job with its real worker output. Idempotent: completing an
 * already-completed job is a no-op, so a worker crash + retry never writes
 * duplicate outputs.
 */
export const completeJob = mutation({
  args: {
    jobId: v.id("processingJobs"),
    result: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (job.status === "completed") return { alreadyCompleted: true, job };
    const now = NOW();
    const patch: Record<string, unknown> = {
      status: "completed",
      progress: 100,
      finishedAt: now,
      updatedAt: now,
    };
    if (args.result !== undefined) patch.result = args.result;
    await ctx.db.patch(args.jobId, patch);

    // Apply ingestion results to the media asset (metadata + derivatives).
    if (job.type === "MEDIA_INGESTION" && job.assetId && args.result) {
      const r = args.result as {
        mediaInfo?: unknown;
        waveform?: unknown;
        timelineThumbnails?: unknown;
        proxyStorageId?: string;
        proxyUrl?: string;
        signals?: unknown;
        thumbnail?: string;
      };
      const videoPatch: Record<string, unknown> = {
        mediaStatus: "ready",
      };
      if (r.mediaInfo !== undefined) {
        videoPatch.mediaInfo = r.mediaInfo;
        const info = r.mediaInfo as {
          duration?: number;
          width?: number;
          height?: number;
        };
        if (typeof info.duration === "number") {
          videoPatch.durationMs = Math.round(info.duration * 1000);
        }
        if (typeof info.width === "number") videoPatch.width = info.width;
        if (typeof info.height === "number") videoPatch.height = info.height;
      }
      if (r.waveform !== undefined) videoPatch.waveform = r.waveform;
      if (r.timelineThumbnails !== undefined) videoPatch.timelineThumbnails = r.timelineThumbnails;
      if (r.proxyStorageId !== undefined) {
        videoPatch.proxyStorageId = r.proxyStorageId;
        // The client uploads the proxy blob but can't mint read URLs —
        // resolve the signed URL server-side.
        if (!r.proxyUrl && r.proxyStorageId) {
          const proxyUrl = await ctx.storage.getUrl(r.proxyStorageId as Id<"_storage">);
          if (proxyUrl) videoPatch.proxyUrl = proxyUrl;
        }
      }
      if (r.proxyUrl !== undefined) videoPatch.proxyUrl = r.proxyUrl;
      if (r.thumbnail !== undefined) videoPatch.thumbnail = r.thumbnail;
      if (r.signals !== undefined) {
        // Phase 1 signal analysis powers clip discovery — persist it and
        // mark the video analyzed as part of ingestion.
        videoPatch.signals = r.signals;
        videoPatch.status = "analyzed";
        videoPatch.analyzedAt = now;
      }
      await ctx.db.patch(job.assetId, videoPatch);
    }

    return { alreadyCompleted: false, job: await ctx.db.get(args.jobId) };
  },
});

/**
 * Fail a job. Classifies errors: permanent errors never retry; retryable
 * errors requeue (up to maxAttempts) with the job moved to `retrying` so a
 * worker can pick it up again.
 */
export const failJob = mutation({
  args: {
    jobId: v.id("processingJobs"),
    error: v.string(),
    errorClass: v.optional(ERROR_CLASS),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (isTerminal(job.status)) return;

    const errorClass = args.errorClass ?? "retryable";
    const attempts = job.attempts + 1;
    const canRetry =
      errorClass === "retryable" && attempts < Math.max(1, job.maxAttempts || MAX_RETRIES);

    const now = NOW();
    if (canRetry) {
      await ctx.db.patch(args.jobId, {
        status: "retrying",
        attempts,
        error: args.error,
        errorClass,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(args.jobId, {
        status: "failed",
        attempts,
        error: args.error,
        errorClass,
        finishedAt: now,
        updatedAt: now,
      });
      // Surface failure on the media asset.
      if (job.assetId) {
        const video = await ctx.db.get(job.assetId);
        if (video && video.mediaStatus !== "ready") {
          await ctx.db.patch(job.assetId, {
            mediaStatus: "failed",
            mediaError: args.error.slice(0, 500),
          });
        }
      }
    }
  },
});

export const cancelJob = mutation({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (isTerminal(job.status)) return;
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      finishedAt: NOW(),
      updatedAt: NOW(),
    });
  },
});

/** Manually retry a failed job (creates a fresh attempt window). */
export const retryJob = mutation({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) throw new Error("Not found");
    if (job.status === "completed") return { ok: false, reason: "already completed" };
    await ctx.db.patch(args.jobId, {
      status: "retrying",
      error: undefined,
      errorClass: undefined,
      startedAt: undefined,
      finishedAt: undefined,
      updatedAt: NOW(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const listJobs = query({
  args: {
    projectId: v.optional(v.id("projects")),
    assetId: v.optional(v.id("videos")),
    status: v.optional(JOB_STATUS),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    let jobs = await ctx.db
      .query("processingJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(args.limit ?? 50);
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.userId !== userId) return [];
      jobs = jobs.filter((j) => j.projectId === args.projectId);
    }
    if (args.assetId) jobs = jobs.filter((j) => j.assetId === args.assetId);
    if (args.status) jobs = jobs.filter((j) => j.status === args.status);
    return jobs;
  },
});

export const getJob = query({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) return null;
    return job;
  },
});

/** Queue counts for the UI (active / failed / total). */
export const jobStats = query({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    let jobs = await ctx.db
      .query("processingJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (args.projectId) jobs = jobs.filter((j) => j.projectId === args.projectId);
    return {
      active: jobs.filter((j) => j.status === "queued" || j.status === "processing" || j.status === "retrying").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      total: jobs.length,
    };
  },
});
