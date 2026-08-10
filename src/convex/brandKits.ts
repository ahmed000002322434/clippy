import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { aspectRatioValidator } from "./schema";

const NOW = () => Date.now();

export const listBrandKits = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("brandKits")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const createBrandKit = mutation({
  args: {
    name: v.string(),
    primaryColor: v.string(),
    captionStyle: v.string(),
    aspect: aspectRatioValidator,
    captionsEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    return await ctx.db.insert("brandKits", {
      userId,
      name: args.name || "Untitled kit",
      primaryColor: args.primaryColor || "#f97316",
      captionStyle: args.captionStyle || "pulse",
      aspect: args.aspect,
      captionsEnabled: args.captionsEnabled,
      createdAt: NOW(),
    });
  },
});

export const updateBrandKit = mutation({
  args: {
    brandKitId: v.id("brandKits"),
    name: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    captionStyle: v.optional(v.string()),
    aspect: v.optional(aspectRatioValidator),
    captionsEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const kit = await ctx.db.get(args.brandKitId);
    if (!kit || kit.userId !== userId) throw new Error("Forbidden");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.primaryColor !== undefined) patch.primaryColor = args.primaryColor;
    if (args.captionStyle !== undefined) patch.captionStyle = args.captionStyle;
    if (args.aspect !== undefined) patch.aspect = args.aspect;
    if (args.captionsEnabled !== undefined) patch.captionsEnabled = args.captionsEnabled;
    await ctx.db.patch(args.brandKitId, patch);
  },
});

export const deleteBrandKit = mutation({
  args: { brandKitId: v.id("brandKits") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const kit = await ctx.db.get(args.brandKitId);
    if (!kit || kit.userId !== userId) throw new Error("Forbidden");
    await ctx.db.delete(args.brandKitId);
  },
});
