import type { Format, Result, Segment, Settings } from "./types";
export const defaults: Settings = {
  model: "base",
  language: "auto",
  device: "cpu",
  cleanup: "immediate",
  format: "txt",
};
export function loadSettings(key = "clipscribe.settings"): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      model: ["tiny", "base", "small", "medium"].includes(s.model)
        ? s.model
        : "base",
      language: typeof s.language === "string" ? s.language : "auto",
      device: s.device === "cuda" ? "cuda" : "cpu",
      cleanup: s.cleanup === "15min" ? "15min" : "immediate",
      format: ["txt", "srt", "vtt", "json"].includes(s.format)
        ? s.format
        : "txt",
    };
  } catch {
    return defaults;
  }
}
export function clock(seconds: number | null) {
  if (seconds === null) return "--:--";
  if (!Number.isFinite(seconds)) return "0:00";
  const n = Math.max(0, Math.floor(seconds));
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function stamp(seconds: number, separator = ",") {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new Error("A segment has an invalid timestamp.");
  const n = Math.round(seconds * 1000);
  return `${String(Math.floor(n / 3600000)).padStart(2, "0")}:${String(Math.floor(n / 60000) % 60).padStart(2, "0")}:${String(Math.floor(n / 1000) % 60).padStart(2, "0")}${separator}${String(n % 1000).padStart(3, "0")}`;
}
export function fullText(segments: Segment[]) {
  return segments.map((s) => s.text.trim()).join("\n");
}
export function activeSegment(segments: Segment[], time: number) {
  return (
    segments.find(
      (s) =>
        s.start !== null && s.end !== null && time >= s.start && time < s.end,
    )?.id ?? null
  );
}
export function exportText(
  format: Format,
  segments: Segment[],
  result?: Result,
) {
  if (format === "txt") return fullText(segments);
  if (format === "json")
    return JSON.stringify(
      { ...result, segments, text: fullText(segments) },
      null,
      2,
    );
  let previous = -1;
  // Cleared text stays in JSON/editor, but should not create invalid empty cues.
  const nonempty = segments.filter((s) => s.text.trim());
  if (!nonempty.length)
    throw new Error(
      "There is no subtitle text to export. Add text to a segment or export JSON.",
    );
  const cues = nonempty
    .map((s, i) => {
      if (s.start === null || s.end === null)
        throw new Error(
          "Some segment timestamps were not returned by the model. Export TXT or JSON; subtitle times will not be invented.",
        );
      if (s.start < previous || s.end <= s.start)
        throw new Error(
          "Subtitle timing is invalid. Export JSON to preserve your work.",
        );
      previous = s.start;
      // Blank lines terminate subtitle cues; escape markup in WebVTT text.
      let text = s.text
        .trim()
        .replace(/\r/g, "")
        .replace(/\n\s*\n/g, "\n")
        .replace(/-->/g, "→");
      if (format === "vtt")
        text = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      return `${i + 1}\n${stamp(s.start, format === "vtt" ? "." : ",")} --> ${stamp(s.end, format === "vtt" ? "." : ",")}\n${text}`;
    })
    .join("\n\n");
  return (format === "vtt" ? "WEBVTT\n\n" : "") + cues + "\n";
}
export function download(
  format: Format,
  segments: Segment[],
  filename: string,
  result?: Result,
) {
  const content = exportText(format, segments, result);
  const blob = new Blob([content], {
    type:
      format === "json"
        ? "application/json;charset=utf-8"
        : format === "vtt"
          ? "text/vtt;charset=utf-8"
          : "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    (filename.replace(/\.[^.]+$/, "") || "transcript") + "." + format;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
