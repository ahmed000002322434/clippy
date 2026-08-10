import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useEffect, useRef } from "react";
import { runIngestion, type JobMutations } from "@/lib/video/ingest";
import { uploadToStorage } from "@/lib/upload";

/**
 * BROWSER-SIDE INGESTION WORKER
 * -----------------------------
 * This deployment has no FFmpeg binary and Convex actions are sandboxed, so
 * media processing runs where real processing is possible: the browser. This
 * hook watches the project's job queue and claims queued/retrying
 * MEDIA_INGESTION jobs, then runs the real pipeline (probe → analyze →
 * proxy → thumbnails → waveform) against the stored object URL, reporting
 * honest progress back to the job.
 *
 * Claiming is safe across tabs: `claimJob` only transitions queued/retrying
 * jobs to processing, so a job claimed elsewhere is simply skipped here.
 */
export function useIngestionRunner(projectId: Id<"projects"> | null) {
  const jobs = useQuery(api.jobs.listJobs, projectId ? { projectId } : "skip");
  const videos = useQuery(api.videos.listVideos, projectId ? { projectId } : "skip");

  const claimJob = useMutation(api.jobs.claimJob);
  const updateJobProgress = useMutation(api.jobs.updateJobProgress);
  const completeJob = useMutation(api.jobs.completeJob);
  const failJob = useMutation(api.jobs.failJob);
  const generateUploadUrl = useMutation(api.videos.generateUploadUrl);

  const running = useRef(new Set<string>());

  useEffect(() => {
    if (!jobs || !videos) return;

    const pending = jobs.filter(
      (j) =>
        j.type === "MEDIA_INGESTION" &&
        (j.status === "queued" || j.status === "retrying"),
    );

    for (const job of pending) {
      if (running.current.has(job._id)) continue;
      const video = videos.find((v) => v._id === job.assetId);
      if (!video || !video.url) continue;
      const sourceUrl = video.url;
      running.current.add(job._id);

      const baseMutations: JobMutations = {
        claimJob: (a) => claimJob(a),
        updateJobProgress: (a) => updateJobProgress(a),
        completeJob: (a) => completeJob(a),
        failJob: (a) => failJob(a),
      };

      // Throttle progress writes: report on stage change, every ~1.5s, or at
      // completion — never spam one mutation per percent.
      let lastReportAt = 0;
      let lastStage = "";
      const throttledProgress: JobMutations["updateJobProgress"] = async (a) => {
        const now = Date.now();
        if (a.stage !== lastStage || now - lastReportAt > 1500 || a.progress >= 100) {
          lastStage = a.stage ?? lastStage;
          lastReportAt = now;
          try {
            await updateJobProgress(a);
          } catch {
            // best-effort — the job record also advances via completeJob
          }
        }
      };

      const run = async () => {
        try {
          await runIngestion({
            jobId: job._id,
            videoId: video._id,
            sourceUrl,
            mimeType: video.mimeType,
            filename: video.name.includes(".")
              ? video.name
              : `${video.name}.mp4`,
            mutations: {
              ...baseMutations,
              updateJobProgress: throttledProgress,
            },
            storeBlob: async (blob, mimeType) => {
              // Upload the generated proxy back to object storage. The
              // signed read URL is resolved server-side by completeJob.
              const { storageId } = await uploadToStorage(
                new File([blob], "proxy", { type: mimeType }),
                () => generateUploadUrl(),
                { onProgress: () => undefined },
              );
              return { storageId, url: "" };
            },
          });
        } catch {
          // runIngestion already failed/cancelled the job server-side.
        } finally {
          running.current.delete(job._id);
        }
      };
      void run();
    }
  }, [jobs, videos, claimJob, updateJobProgress, completeJob, failJob, generateUploadUrl]);
}
