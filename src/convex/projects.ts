import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const NOW = () => Date.now();

function requireUserId(ctx: { runQuery: any }, userId: unknown) {
  if (userId === null) throw new Error("Not authenticated");
}

export const createProject = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const now = NOW();
    const projectId = await ctx.db.insert("projects", {
      name: args.name || "Untitled project",
      description: args.description,
      userId,
      archived: false,
      videoCount: 0,
      clipCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return projectId;
  },
});

export const listProjects = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user_archived", (q) =>
        args.includeArchived
          ? q.eq("userId", userId)
          : q.eq("userId", userId).eq("archived", false),
      )
      .order("desc")
      .take(100);
    return projects;
  },
});

export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) return null;
    return project;
  },
});

export const renameProject = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    requireUserId(ctx, userId);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) throw new Error("Forbidden");
    await ctx.db.patch(args.projectId, { name: args.name, updatedAt: NOW() });
  },
});

export const toggleArchive = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) throw new Error("Forbidden");
    await ctx.db.patch(args.projectId, {
      archived: !project.archived,
      updatedAt: NOW(),
    });
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) throw new Error("Forbidden");

    // Delete all media in storage + rows (videos, clips, render jobs)
    const videos = await ctx.db
      .query("videos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const video of videos) {
      if (video.storageId) {
        try {
          await ctx.storage.delete(video.storageId);
        } catch {
          // ignore storage errors during cascade delete
        }
      }
      const clips = await ctx.db
        .query("clips")
        .withIndex("by_video", (q) => q.eq("videoId", video._id))
        .collect();
      for (const clip of clips) {
        if (clip.renderUrl) {
          // best-effort cleanup of exported files
        }
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
      await ctx.db.delete(video._id);
    }
    await ctx.db.delete(args.projectId);
  },
});
