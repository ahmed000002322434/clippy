import { describe, expect, test } from "bun:test";
import {
  MAX_FILE_BYTES,
  sanitizeFilename,
  validateUpload,
  validateVideoFileClient,
} from "./validate";

describe("sanitizeFilename", () => {
  test("accepts a plain video filename", () => {
    const res = sanitizeFilename("podcast-episode-12.mp4");
    expect(res.ok).toBe(true);
    expect(res.name).toBe("podcast-episode-12.mp4");
  });

  test("rejects path traversal (forward slash)", () => {
    const res = sanitizeFilename("../../etc/passwd.mp4");
    expect(res.ok).toBe(false);
    expect(res.errorClass).toBe("user-action");
    expect(res.error).toContain("paths");
  });

  test("rejects path traversal (backslash)", () => {
    const res = sanitizeFilename("..\\..\\pwn.mp4");
    expect(res.ok).toBe(false);
  });

  test("rejects control characters", () => {
    expect(sanitizeFilename("evil\u0000.mp4").ok).toBe(false);
    expect(sanitizeFilename("new\nline.mp4").ok).toBe(false);
  });

  test("rejects dotfiles", () => {
    const res = sanitizeFilename(".secret.mp4");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("dot");
  });

  test("rejects unsupported extensions", () => {
    const res = sanitizeFilename("script.exe");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Unsupported file type");
  });

  test("accepts all supported extensions", () => {
    for (const ext of ["mp4", "mov", "webm", "mkv", "m4v", "avi", "ogv", "3gp"]) {
      expect(sanitizeFilename(`clip.${ext}`).ok).toBe(true);
    }
  });

  test("trims whitespace", () => {
    expect(sanitizeFilename("  clip.mp4  ").name).toBe("clip.mp4");
  });

  test("rejects empty and over-long names", () => {
    expect(sanitizeFilename("").ok).toBe(false);
    expect(sanitizeFilename("a".repeat(121) + ".mp4").ok).toBe(false);
  });
});

describe("validateUpload", () => {
  test("accepts a valid video upload", () => {
    const res = validateUpload("clip.mp4", "video/mp4", 1024 * 1024);
    expect(res.ok).toBe(true);
  });

  test("rejects non-video MIME types", () => {
    const res = validateUpload("clip.mp4", "text/html", 1000);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not a recognized video type");
  });

  test("allows octet-stream (browser fallback type)", () => {
    expect(validateUpload("clip.mp4", "application/octet-stream", 1000).ok).toBe(true);
  });

  test("rejects files over the 2GB limit", () => {
    const res = validateUpload("clip.mp4", "video/mp4", MAX_FILE_BYTES + 1);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("2GB");
  });

  test("rejects non-positive sizes", () => {
    expect(validateUpload("clip.mp4", "video/mp4", 0).ok).toBe(false);
    expect(validateUpload("clip.mp4", "video/mp4", -5).ok).toBe(false);
  });

  test("rejects an unsupported filename even with a video MIME", () => {
    const res = validateUpload("clip.exe", "video/mp4", 1000);
    expect(res.ok).toBe(false);
  });
});

describe("validateVideoFileClient", () => {
  test("passes through to the shared rules", () => {
    expect(
      validateVideoFileClient({ name: "ok.webm", type: "video/webm", size: 10 }).ok,
    ).toBe(true);
    expect(
      validateVideoFileClient({ name: "ok.webm", type: "image/png", size: 10 }).ok,
    ).toBe(false);
    expect(
      validateVideoFileClient({ name: "../escape.mp4", type: "video/mp4", size: 10 }).ok,
    ).toBe(false);
  });
});
