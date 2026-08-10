import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { aspectRatioValidator, clipStrategyValidator } from "./schema";

const NOW = () => Date.now();

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("templates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const createTemplate = mutation({
  args: {
    name: v.string(),
    emoji: v.string(),
    description: v.optional(v.string()),
    strategy: clipStrategyValidator,
    durationMs: v.number(),
    aspect: aspectRatioValidator,
    captionsEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.db.insert("templates", {
      userId,
      name: args.name || "Untitled template",
      emoji: args.emoji || "🎬",
      description: args.description,
      strategy: args.strategy,
      durationMs: args.durationMs,
      aspect: args.aspect,
      captionsEnabled: args.captionsEnabled,
      createdAt: NOW(),
    });
  },
});

export const updateTemplate = mutation({
  args: {
    templateId: v.id("templates"),
    name: v.optional(v.string()),
    emoji: v.optional(v.string()),
    description: v.optional(v.string()),
    strategy: v.optional(clipStrategyValidator),
    durationMs: v.optional(v.number()),
    aspect: v.optional(aspectRatioValidator),
    captionsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const template = await ctx.db.get(args.templateId);
    if (!template || template.userId !== userId) throw new Error("Forbidden");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.emoji !== undefined) patch.emoji = args.emoji;
    if (args.description !== undefined) patch.description = args.description;
    if (args.strategy !== undefined) patch.strategy = args.strategy;
    if (args.durationMs !== undefined) patch.durationMs = args.durationMs;
    if (args.aspect !== undefined) patch.aspect = args.aspect;
    if (args.captionsEnabled !== undefined) patch.captionsEnabled = args.captionsEnabled;
    await ctx.db.patch(args.templateId, patch);
  },
});

export const deleteTemplate = mutation({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const template = await ctx.db.get(args.templateId);
    if (!template || template.userId !== userId) throw new Error("Forbidden");
    await ctx.db.delete(args.templateId);
  },
});
