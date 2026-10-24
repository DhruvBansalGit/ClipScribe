import { describe, it, expect } from "vitest";
import {
  speechRanges,
  bestLanguage,
  SAMPLE_RATE,
} from "../src/browser/audio-windows";
describe("bounded multilingual audio windows", () => {
  it("skips silence rather than inventing text", () => {
    expect(speechRanges(new Float32Array(30 * SAMPLE_RATE))).toEqual([]);
  });
  it("separates utterances across silence on the original sample timeline", () => {
    const audio = new Float32Array(8 * SAMPLE_RATE);
    audio.fill(0.1, SAMPLE_RATE, 3 * SAMPLE_RATE);
    audio.fill(0.2, 5 * SAMPLE_RATE, 7 * SAMPLE_RATE);
    const ranges = speechRanges(audio);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start / SAMPLE_RATE).toBeCloseTo(0.9);
    expect(ranges[1].start / SAMPLE_RATE).toBeCloseTo(4.9);
  });
  it("bounds continuous speech for repeated language detection without losing samples", () => {
    const audio = new Float32Array(30 * SAMPLE_RATE).fill(0.1),
      ranges = speechRanges(audio);
    expect(ranges.length).toBe(3);
    expect(ranges[0].start).toBe(0);
    expect(ranges.at(-1)?.end).toBe(audio.length);
    for (let i = 1; i < ranges.length; i++)
      expect(ranges[i].start).toBe(ranges[i - 1].end);
    expect(Math.max(...ranges.map((r) => r.end - r.start))).toBeLessThanOrEqual(
      13 * SAMPLE_RATE,
    );
  });
  it("selects only language-token logits, not an English default", () => {
    const scores = new Float32Array([100, 1, 6, 2]);
    const result = bestLanguage(scores, {
      "<|en|>": 1,
      "<|hi|>": 2,
      "<|fr|>": 3,
    });
    expect(result.language).toBe("hi");
    expect(result.probability).toBeGreaterThan(0.9);
  });
  it("fails explicitly if language-token scores are unavailable", () => {
    expect(() => bestLanguage(new Float32Array(2), { "<|en|>": 9 })).toThrow();
  });
});
