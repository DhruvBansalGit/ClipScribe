import { describe, it, expect } from "vitest";
import {
  activeSegment,
  clock,
  exportText,
  fullText,
  stamp,
} from "../src/transcript";
const segments = [
  { id: 0, start: 0.125, end: 3.9, text: "First sentence." },
  { id: 1, start: 5.001, end: 8.21, text: "An edited sentence." },
];
describe("actual timestamp-based transcript operations", () => {
  it("never invents missing model timestamps", () => {
    const unknown = [
      { id: 0, start: 0, end: null, text: "Real recognized words" },
    ];
    expect(activeSegment(unknown, 1)).toBeNull();
    expect(clock(null)).toBe("--:--");
    expect(exportText("txt", unknown)).toBe(
      "[00:00:00.000 --> unknown] Real recognized words\n",
    );
    expect(JSON.parse(exportText("json", unknown)).segments[0].end).toBeNull();
    expect(() => exportText("srt", unknown)).toThrow(/not be invented/);
    expect(() => exportText("vtt", unknown)).toThrow(/not be invented/);
  });
  it("omits empty subtitle cues without changing timestamps", () => {
    expect(
      exportText("srt", [{ ...segments[0], text: "" }, segments[1]]),
    ).toMatch(/^1\n00:00:05,001/);
    expect(() => exportText("srt", [])).toThrow();
  });
  it("formats player time with hours", () => {
    expect(clock(3661)).toBe("1:01:01");
    expect(clock(NaN)).toBe("0:00");
  });
  it("formats millisecond precision and carry", () => {
    expect(stamp(59.9999)).toBe("00:01:00,000");
    expect(stamp(3661.002, ".")).toBe("01:01:01.002");
  });
  it("rejects invalid timestamps", () => {
    expect(() => stamp(NaN)).toThrow();
    expect(() => stamp(-1)).toThrow();
  });
  it("finds active segments with exclusive end and real gaps", () => {
    expect(activeSegment(segments, 1)).toBe(0);
    expect(activeSegment(segments, 3.9)).toBeNull();
    expect(activeSegment(segments, 4)).toBeNull();
    expect(activeSegment(segments, 5.1)).toBe(1);
  });
  it("exports current edited text", () => {
    expect(fullText(segments)).toContain("An edited sentence.");
    expect(exportText("txt", segments)).toBe(
      "[00:00:00.125 --> 00:00:03.900] First sentence.\n\n[00:00:05.001 --> 00:00:08.210] An edited sentence.\n",
    );
  });
  it("exports valid SRT sequence and separator", () => {
    expect(exportText("srt", segments)).toBe(
      "1\n00:00:00,125 --> 00:00:03,900\nFirst sentence.\n\n2\n00:00:05,001 --> 00:00:08,210\nAn edited sentence.\n",
    );
  });
  it("exports VTT header and point separator", () => {
    expect(exportText("vtt", segments)).toContain(
      "WEBVTT\n\n1\n00:00:00.125 --> 00:00:03.900",
    );
  });
  it("exports structured editable JSON", () => {
    expect(JSON.parse(exportText("json", segments)).segments).toEqual(segments);
  });
  it("preserves Unicode and hour-scale source times in TXT", () => {
    expect(
      exportText("txt", [
        { id: 0, start: 3661.002, end: 3663.25, text: "नमस्ते — Hello" },
      ]),
    ).toBe("[01:01:01.002 --> 01:01:03.250] नमस्ते — Hello\n");
  });
  it("escapes VTT markup and blank subtitle lines", () => {
    expect(
      exportText("vtt", [
        { ...segments[0], text: "<b>Hello</b>\n\nworld --> &" },
      ]),
    ).toContain("&lt;b&gt;Hello&lt;/b&gt;\nworld → &amp;");
  });
  it("rejects invalid segment order or duration", () => {
    expect(() => exportText("srt", [segments[1], segments[0]])).toThrow();
    expect(() => exportText("vtt", [{ ...segments[0], end: 0 }])).toThrow();
  });
});
