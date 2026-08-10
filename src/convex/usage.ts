import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

/**
 * Usage / credit snapshot for the dashboard & settings.
 * Computed from real records — never faked.
 */
export const usageStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);

    const [videos, clips, jobs, projects, kits, templates] = await Promise.all([
      ctx.db.query("videos").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("clips").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("renderJobs").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("projects").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("brandKits").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ctx.db.query("templates").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
    ]);

    const exports = jobs.filter((j) => j.status === "completed").length;
    const storageBytes = user?.storageBytes ?? 0;

    return {
      plan: user?.plan ?? "free",
      storageBytes,
      videoCount: videos.length,
      clipCount: clips.length,
      exportCount: exports,
      projectCount: projects.filter((p) => !p.archived).length,
      brandKitCount: kits.length,
      templateCount: templates.length,
      // simple free-tier caps (a real billing system would own these)
      limits: {
        storageBytes: 20 * 1024 * 1024 * 1024, // 20GB
        exports: 100,
      },
    };
  },
});
