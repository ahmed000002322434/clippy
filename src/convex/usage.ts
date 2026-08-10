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

    const [videos, clips, jobs, renderJobs, projects, kits, templates, sessions] =
      await Promise.all([
        ctx.db.query("videos").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
        ctx.db.query("clips").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
        ctx.db.query("processingJobs").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
        ctx.db.query("renderJobs").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
        ctx.db.query("projects").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
        ctx.db.query("brandKits").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
        ctx.db.query("templates").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
        ctx.db.query("uploadSessions").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
      ]);

    const exports = renderJobs.filter((j) => j.status === "completed").length;
    const storageBytes = user?.storageBytes ?? 0;
    const uploadedBytes = sessions
      .filter((s) => s.status === "completed")
      .reduce((acc, s) => acc + s.size, 0);

    return {
      plan: user?.plan ?? "free",
      storageBytes,
      uploadedBytes,
      videoCount: videos.length,
      readyVideos: videos.filter((v) => v.mediaStatus === "ready").length,
      processingVideos: videos.filter((v) => v.mediaStatus === "processing").length,
      clipCount: clips.length,
      exportCount: exports,
      jobCount: jobs.length,
      failedJobs: jobs.filter((j) => j.status === "failed").length,
      activeJobs: jobs.filter((j) =>
        j.status === "queued" || j.status === "processing" || j.status === "retrying",
      ).length,
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
