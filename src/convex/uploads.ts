import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ERROR_CLASS } from "./schema";
import {
  sanitizeFilename,
  validateUpload,
} from "../lib/upload/validate";

const NOW = () => Date.now();

/** Maximum concurrent active upload sessions per user (abuse guard). */
const MAX_ACTIVE_SESSIONS = 5;

// ---------------------------------------------------------------------------
// Upload sessions
// ---------------------------------------------------------------------------

/**
 * Create a persistent upload session. Returns a single-use signed upload URL
 * so the browser can PUT the file directly to object storage — the backend
 * coordinates, it does not proxy multi-GB bytes.
 */
export const createUploadSession = mutation({
  args: {
    projectId: v.id("projects"),
    filename: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) {
      throw new Error("Project not found or not yours.");
    }

    const validation = validateUpload(args.filename, args.mimeType, args.size);
    if (!validation.ok) {
      const err = new Error(validation.error ?? "Invalid upload.");
      (err as { errorClass?: unknown }).errorClass = validation.errorClass;
      throw err;
    }

    // Rate limit: cap concurrent active sessions per user.
    const active = await ctx.db
      .query("uploadSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "created"),
          q.eq(q.field("status"), "uploading"),
          q.eq(q.field("status"), "processing"),
        ),
      )
      .collect();
    if (active.length >= MAX_ACTIVE_SESSIONS) {
      throw new Error("Too many active uploads. Cancel or finish one first.");
    }

    const now = NOW();
    const sessionId = await ctx.db.insert("uploadSessions", {
      userId,
      projectId: args.projectId,
      filename: sanitizeFilename(args.filename).name ?? "video.mp4",
      mimeType: args.mimeType || "video/mp4",
      size: args.size,
      uploadedBytes: 0,
      status: "created",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { sessionId, uploadUrl };
  },
});

/** Get a fresh single-use signed upload URL for an existing session (retries). */
export const getFreshUploadUrl = mutation({
  args: { sessionId: v.id("uploadSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Not found");
    if (session.status === "completed" || session.status === "cancelled") {
      throw new Error("Session is no longer active.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Mark a session as actively uploading (client calls before the PUT). */
export const markUploading = mutation({
  args: { sessionId: v.id("uploadSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.sessionId, {
      status: "uploading",
      attempts: session.attempts + 1,
      updatedAt: NOW(),
    });
  },
});

/** Real byte-progress updates from the client XHR. */
export const updateUploadProgress = mutation({
  args: {
    sessionId: v.id("uploadSessions"),
    uploadedBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Not found");
    if (session.status === "completed" || session.status === "cancelled") return;
    const bytes = Math.min(args.uploadedBytes, session.size);
    await ctx.db.patch(args.sessionId, { uploadedBytes: bytes, updatedAt: NOW() });
  },
});

/**
 * Complete an upload session: verify integrity, persist the video record,
 * queue the MEDIA_INGESTION job, and mark the session completed.
 */
export const completeUploadSession = mutation({
  args: {
    sessionId: v.id("uploadSessions"),
    storageId: v.id("_storage"),
    // Browser-measured metadata (validated + normalized server-side later
    // by the ingestion job; these are best-effort early reads).
    durationMs: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    thumbnail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Not found");
    if (session.status === "completed") {
      // Idempotent: already finished — return the existing video.
      if (session.videoId) {
        return { videoId: session.videoId, alreadyCompleted: true };
      }
      throw new Error("Session already completed but has no video.");
    }

    const name = (session.filename || "video.mp4").replace(/\.[^.]+$/, "");
    const now = NOW();
    const videoId = await ctx.db.insert("videos", {
      projectId: session.projectId,
      userId,
      name,
      mimeType: session.mimeType,
      size: session.size,
      storageId: args.storageId,
      durationMs: args.durationMs,
      width: args.width,
      height: args.height,
      thumbnail: args.thumbnail,
      source: "upload",
      status: "ready",
      transcriptionStatus: "none",
      mediaStatus: "pending",
      lastActivityAt: now,
      createdAt: now,
    });

    // Track storage usage + project counts.
    const user = await ctx.db.get(userId);
    await ctx.db.patch(userId, {
      storageBytes: (user?.storageBytes ?? 0) + session.size,
    });
    const project = await ctx.db.get(session.projectId);
    if (project) {
      await ctx.db.patch(session.projectId, {
        videoCount: project.videoCount + 1,
        updatedAt: now,
      });
    }

    // Queue the ingestion job (idempotent by key).
    await ctx.db.insert("processingJobs", {
      userId,
      projectId: session.projectId,
      assetId: videoId,
      type: "MEDIA_INGESTION",
      status: "queued",
      progress: 0,
      attempts: 0,
      maxAttempts: 3,
      idempotencyKey: `${videoId}:MEDIA_INGESTION`,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.sessionId, {
      status: "completed",
      storageId: args.storageId,
      videoId,
      uploadedBytes: session.size,
      completedAt: now,
      updatedAt: now,
    });

    return { videoId, alreadyCompleted: false };
  },
});

export const failUploadSession = mutation({
  args: {
    sessionId: v.id("uploadSessions"),
    error: v.string(),
    errorClass: v.optional(ERROR_CLASS),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(args.sessionId, {
      status: "failed",
      error: args.error,
      errorClass: args.errorClass ?? "retryable",
      updatedAt: NOW(),
    });
  },
});

export const cancelUploadSession = mutation({
  args: { sessionId: v.id("uploadSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Not found");
    if (session.status === "completed") return;
    // If a partial object exists, remove it — no orphans.
    if (session.storageId) {
      try {
        await ctx.storage.delete(session.storageId);
      } catch {
        // best-effort
      }
    }
    await ctx.db.patch(args.sessionId, {
      status: "cancelled",
      updatedAt: NOW(),
    });
  },
});

/** Recover active sessions after a refresh (statuses created/uploading). */
export const listUploadSessions = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) return [];
    return await ctx.db
      .query("uploadSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});

export const getUploadSession = query({
  args: { sessionId: v.id("uploadSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) return null;
    return session;
  },
});
