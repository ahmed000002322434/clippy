import { mutation } from "./_generated/server";

/**
 * IDLE-ORIGINAL RECLAMATION
 * -------------------------
 * Product rule: a video's original file is kept until clips are made from it
 * (even if those clips are never exported). Once at least one clip exists,
 * the original is deleted after 2 hours without any activity on the video or
 * its clips — saving object storage while keeping all derived work (clips,
 * signals, transcript, proxy, exports) intact.
 *
 * Runs hourly from src/convex/crons.ts. This mutation is invoked by the
 * cron system, not by users, so it performs no auth checks.
 */
export const expireIdleVideos = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - 2 * 60 * 60 * 1000; // 2 hours of inactivity
    let expired = 0;

    const videos = await ctx.db.query("videos").collect();
    for (const video of videos) {
      // Already reclaimed, or failed uploads we never want to touch.
      if (video.status === "expired" || video.status === "failed") continue;
      if (!video.storageId) continue;

      const lastActivity = video.lastActivityAt ?? video.createdAt;
      if (lastActivity >= cutoff) continue;

      // Only reclaim originals that produced clips.
      const clips = await ctx.db
        .query("clips")
        .withIndex("by_video", (q) => q.eq("videoId", video._id))
        .collect();
      if (clips.length === 0) continue;

      // Never pull the source while a clip is queued/actively rendering.
      const renderJobsPerClip = await Promise.all(
        clips.map((c) =>
          ctx.db
            .query("renderJobs")
            .withIndex("by_clip", (q) => q.eq("clipId", c._id))
            .collect(),
        ),
      );
      const busy = renderJobsPerClip.some((jobs) =>
        jobs.some((j) => j.status === "queued" || j.status === "rendering"),
      );
      if (busy) continue;

      // Reclaim: delete the original object, keep the record + everything
      // derived (clips, signals, transcript, proxy, exports).
      try {
        await ctx.storage.delete(video.storageId);
      } catch {
        // Object may already be gone — still mark the record expired.
      }
      await ctx.db.patch(video._id, {
        storageId: undefined,
        status: "expired",
        originalDeletedAt: now,
        lastActivityAt: now,
      });

      // Reflect the reclaimed bytes in the user's storage usage.
      const user = await ctx.db.get(video.userId);
      if (user) {
        await ctx.db.patch(video.userId, {
          storageBytes: Math.max(0, (user.storageBytes ?? 0) - video.size),
        });
      }
      expired++;
    }

    return { expired };
  },
});
