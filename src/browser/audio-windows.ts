// Deterministic bounded-window helpers, independent of browser/model runtimes.
// Silence splitting reduces fixed-language spans and skips silent portions.
// Energy gating is not a speech classifier; music/noisy audio still needs review.
export const SAMPLE_RATE = 16000;
export function speechRanges(
  audio: Float32Array,
): { start: number; end: number }[] {
  const frame = 320;
  const energies: number[] = [];
  let peak = 0;
  for (let start = 0; start < audio.length; start += frame) {
    let sum = 0;
    const count = Math.min(frame, audio.length - start);
    for (let i = 0; i < count; i++) sum += audio[start + i] ** 2;
    const rms = Math.sqrt(sum / count);
    energies.push(rms);
    peak = Math.max(peak, rms);
  }
  if (peak < 0.00015) return [];
  const threshold = Math.max(0.00015, peak * 0.025);
  const spans: { start: number; end: number }[] = [];
  let first = -1,
    last = -1;
  const finish = () => {
    if (first >= 0) {
      spans.push({
        start: Math.max(0, first * frame - 1600),
        end: Math.min(audio.length, (last + 1) * frame + 1600),
      });
      first = -1;
      last = -1;
    }
  };
  for (let i = 0; i < energies.length; i++) {
    if (energies[i] > threshold) {
      if (first < 0) first = i;
      last = i;
    } else if (first >= 0 && i - last >= 15) finish();
  }
  finish();
  const ranges: { start: number; end: number }[] = [];
  for (const span of spans) {
    if (span.end - span.start < 4000) continue;
    for (let start = span.start; start < span.end; ) {
      const remaining = span.end - start;
      const end =
        remaining <= 13 * SAMPLE_RATE ? span.end : start + 12 * SAMPLE_RATE;
      ranges.push({ start, end });
      start = end;
    }
  }
  return ranges;
}

export function bestLanguage(
  scores: ArrayLike<number>,
  languages: Record<string, number>,
): { language: string; probability: number } {
  const entries = Object.entries(languages).filter(
    ([, id]) => id >= 0 && id < scores.length && Number.isFinite(scores[id]),
  );
  if (!entries.length)
    throw new Error(
      "Language-token scores are unavailable. Select a known language and retry.",
    );
  const winner = entries.reduce((best, current) =>
    scores[current[1]] > scores[best[1]] ? current : best,
  );
  const max = scores[winner[1]];
  const sum = entries.reduce(
    (total, [, id]) => total + Math.exp(scores[id] - max),
    0,
  );
  return {
    language: winner[0].replace(/^<\||\|>$/g, ""),
    probability: 1 / sum,
  };
}
