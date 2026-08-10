import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatSpeed,
  formatTime,
  formatTimestamp,
  timeAgo,
} from "./format";

describe("formatBytes", () => {
  test("handles zero and negative", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  test("formats bytes, KB, MB, GB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
  });
});

describe("formatSpeed", () => {
  test("handles unknown speed", () => {
    expect(formatSpeed(0)).toBe("—");
    expect(formatSpeed(NaN)).toBe("—");
  });

  test("formats human speeds", () => {
    expect(formatSpeed(24.6 * 1024 * 1024)).toBe("24.6 MB/s");
    expect(formatSpeed(2 * 1024 ** 3)).toBe("2.0 GB/s");
    expect(formatSpeed(500 * 1024)).toBe("500 KB/s");
  });
});

describe("formatEta", () => {
  test("returns null for unknown ETA", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(0)).toBeNull();
    expect(formatEta(-10)).toBeNull();
  });

  test("formats seconds, minutes, hours", () => {
    expect(formatEta(12_000)).toBe("~12s");
    expect(formatEta(90_000)).toBe("~2m");
    expect(formatEta(3_600_000 * 2)).toBe("~2h");
  });
});

describe("formatDuration", () => {
  test("formats seconds, minutes and hours", () => {
    expect(formatDuration(84_000)).toBe("1m 24s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(3_725_000)).toBe("1h 02m");
  });
});

describe("formatTime / formatTimestamp", () => {
  test("formats HH:MM:SS and compact timestamps", () => {
    expect(formatTime(84_000)).toBe("01:24");
    expect(formatTime(3_725_000)).toBe("01:02:05");
    expect(formatTimestamp(84_000)).toBe("01:24");
    expect(formatTimestamp(3_725_000)).toBe("1:02:05");
  });
});

describe("timeAgo", () => {
  test("formats relative times", () => {
    expect(timeAgo(Date.now())).toBe("just now");
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe("5m ago");
    expect(timeAgo(Date.now() - 5 * 3_600_000)).toBe("5h ago");
  });
});
