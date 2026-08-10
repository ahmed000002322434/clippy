import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

export const VIDEO_STATUS = v.union(
  v.literal("uploading"),
  v.literal("ready"),
  v.literal("analyzing"),
  v.literal("analyzed"),
  v.literal("failed"),
);
export type VideoStatus = Infer<typeof VIDEO_STATUS>;

export const TRANSCRIPTION_STATUS = v.union(
  v.literal("none"),
  v.literal("pending"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("unconfigured"),
);
export type TranscriptionStatus = Infer<typeof TRANSCRIPTION_STATUS>;

export const CLIP_STATUS = v.union(
  v.literal("draft"),
  v.literal("rendering"),
  v.literal("ready"),
  v.literal("failed"),
);
export type ClipStatus = Infer<typeof CLIP_STATUS>;

export const RENDER_JOB_STATUS = v.union(
  v.literal("queued"),
  v.literal("rendering"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);
export type RenderJobStatus = Infer<typeof RENDER_JOB_STATUS>;

export const ASPECT_RATIOS = ["9:16", "1:1", "4:5", "16:9"] as const;
export const aspectRatioValidator = v.union(
  v.literal("9:16"),
  v.literal("1:1"),
  v.literal("4:5"),
  v.literal("16:9"),
);
export type AspectRatio = Infer<typeof aspectRatioValidator>;

export const CLIP_STRATEGIES = [
  "viral",
  "educational",
  "funny",
  "storytelling",
  "motivational",
  "podcast",
  "business",
  "news",
  "interview",
  "custom",
] as const;
export const clipStrategyValidator = v.union(
  ...CLIP_STRATEGIES.map((s) => v.literal(s)),
);
export type ClipStrategy = Infer<typeof clipStrategyValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),

      role: v.optional(roleValidator),

      // usage / quota tracking
      storageBytes: v.optional(v.number()),
      plan: v.optional(v.string()),
    }).index("email", ["email"]),

    projects: defineTable({
      name: v.string(),
      userId: v.id("users"),
      description: v.optional(v.string()),
      archived: v.boolean(),
      videoCount: v.number(),
      clipCount: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "updatedAt"])
      .index("by_user_archived", ["userId", "archived", "updatedAt"]),

    videos: defineTable({
      projectId: v.id("projects"),
      userId: v.id("users"),
      name: v.string(),
      mimeType: v.string(),
      size: v.number(),
      storageId: v.optional(v.id("_storage")),
      durationMs: v.optional(v.number()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      thumbnail: v.optional(v.string()), // compact data-url
      status: VIDEO_STATUS,
      error: v.optional(v.string()),
      // Browser-computed signal analysis (energy, scenes, pauses, motion)
      signals: v.optional(v.any()),
      // Word-level transcript produced by a transcription provider
      transcript: v.optional(v.any()),
      transcriptionStatus: TRANSCRIPTION_STATUS,
      transcriptionError: v.optional(v.string()),
      analyzedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId", "createdAt"])
      .index("by_user", ["userId", "createdAt"]),

    clips: defineTable({
      projectId: v.id("projects"),
      userId: v.id("users"),
      videoId: v.id("videos"),
      startMs: v.number(),
      endMs: v.number(),
      score: v.number(),
      subScores: v.optional(v.any()),
      reasons: v.array(v.string()),
      strategy: clipStrategyValidator,
      aspect: aspectRatioValidator,
      captionsEnabled: v.boolean(),
      captionStyle: v.optional(v.string()),
      hook: v.optional(v.string()),
      hooks: v.optional(v.any()), // [{label, text}]
      titles: v.optional(v.any()), // {shorts, tiktok, instagram, hashtags, keywords}
      status: CLIP_STATUS,
      renderUrl: v.optional(v.string()),
      renderError: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId", "score"])
      .index("by_video", ["videoId", "score"])
      .index("by_user", ["userId", "createdAt"]),

    renderJobs: defineTable({
      clipId: v.id("clips"),
      projectId: v.id("projects"),
      userId: v.id("users"),
      status: RENDER_JOB_STATUS,
      progress: v.number(),
      format: v.string(),
      resolution: v.string(),
      error: v.optional(v.string()),
      storageId: v.optional(v.id("_storage")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"])
      .index("by_clip", ["clipId", "createdAt"]),

    // Reusable output presets: caption look + default aspect per brand
    brandKits: defineTable({
      userId: v.id("users"),
      name: v.string(),
      primaryColor: v.string(),
      captionStyle: v.string(),
      aspect: aspectRatioValidator,
      captionsEnabled: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"]),

    // Reusable clip recipes: strategy + target duration + output shape
    templates: defineTable({
      userId: v.id("users"),
      name: v.string(),
      emoji: v.string(),
      description: v.optional(v.string()),
      strategy: clipStrategyValidator,
      durationMs: v.number(),
      aspect: aspectRatioValidator,
      captionsEnabled: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId", "createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
