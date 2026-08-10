import { describe, expect, test } from "bun:test";
import { buildWaveformPeaks } from "./processing";

describe("buildWaveformPeaks", () => {
  test("returns empty peaks for no energy data", () => {
    expect(buildWaveformPeaks([], 100)).toEqual({ peaks: [], sampleRate: 0 });
  });

  test("buckets energy into the requested number of peaks", () => {
    const energy = Array.from({ length: 1000 }, (_, i) => (i % 100) / 100);
    const { peaks, sampleRate } = buildWaveformPeaks(energy, 100, 20);
    expect(peaks.length).toBe(20);
    expect(sampleRate).toBe(10); // 1000ms / 100ms window
  });

  test("keeps the max energy per bucket", () => {
    const energy = [0.1, 0.9, 0.2, 0.3, 0.5, 0.05, 0.7, 0.4, 0.2, 0.6];
    const { peaks } = buildWaveformPeaks(energy, 100, 5);
    // 5 buckets of 2 samples each → maxes: 0.9, 0.3, 0.05, 0.4, 0.2 (0.6→bucket 4? check)
    expect(Math.max(...peaks)).toBe(0.9);
    expect(peaks.length).toBe(5);
  });

  test("clamps to fewer buckets than samples when requested", () => {
    const { peaks } = buildWaveformPeaks([0.1, 0.2, 0.3], 100, 10);
    expect(peaks.length).toBe(3);
  });

  test("reports the effective sample rate from the window", () => {
    expect(buildWaveformPeaks([0.1, 0.2], 50).sampleRate).toBe(20);
    expect(buildWaveformPeaks([0.1, 0.2], 250).sampleRate).toBe(4);
  });
});
