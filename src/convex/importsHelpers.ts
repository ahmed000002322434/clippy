import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/** Read a project to verify ownership from inside the import action. */
export const getProjectForImport = internalQuery({
  args: { projectId: v.id("projects"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== args.userId) return null;
    return { archived: project.archived };
  },
});

/**
 * Internal mutation that persists an imported video row and bumps the
 * project video count + user storage usage. Called from the `importFromUrl`
 * action, which cannot write to the database directly.
 */
export const createImportedVideo = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const videoId = await ctx.db.insert("videos", {
      projectId: args.projectId,
      userId: args.userId,
      name: args.name,
      mimeType: args.mimeType,
      size: args.size,
      storageId: args.storageId,
      source: args.source,
      status: "ready",
      transcriptionStatus: "none",
      createdAt: now,
    });

    const project = await ctx.db.get(args.projectId);
    if (project) {
      await ctx.db.patch(args.projectId, {
        videoCount: project.videoCount + 1,
        updatedAt: now,
      });
    }
    const user = await ctx.db.get(args.userId);
    await ctx.db.patch(args.userId, {
      storageBytes: (user?.storageBytes ?? 0) + args.size,
    });

    return videoId;
  },
});
