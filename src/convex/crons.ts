import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

/**
 * SCHEDULED JOBS
 * --------------
 * Hourly pass over videos: reclaim originals that have clips but saw no
 * activity for 2 hours (see src/convex/cleanup.ts for the exact rules).
 */
const crons = cronJobs();

crons.hourly(
  "expire idle original videos (2h)",
  api.cleanup.expireIdleVideos,
);

export default crons;
