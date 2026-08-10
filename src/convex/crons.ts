import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

/**
 * SCHEDULED JOBS
 * --------------
 * Hourly passes:
 *  1. Reclaim originals that have clips but saw no activity for 2 hours
 *     (see src/convex/cleanup.ts for the exact rules).
 *  2. Expire upload sessions abandoned mid-flight so they never exhaust the
 *     per-user active-session cap (see src/convex/uploads.ts).
 */
const crons = cronJobs();

crons.hourly(
  "expire idle original videos (2h)",
  api.cleanup.expireIdleVideos,
);

crons.hourly(
  "expire stale upload sessions (24h)",
  api.uploads.expireStaleUploadSessions,
);

export default crons;
