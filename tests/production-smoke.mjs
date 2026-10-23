// Actual production-build + local-model smoke. Requires both local servers,
// Base installed, and the real speech fixture documented in README.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const url = process.env.CLIPSCRIBE_URL || "http://127.0.0.1:4175";
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== url)
    external.push(r.url());
});
try {
  await page.goto(url);
  await page.getByText("Local engine connected").waitFor();
  await page.screenshot({
    path: ".local/production-landing.png",
    fullPage: true,
  });
  await page.getByLabel("Choose video").setInputFiles(".local/real-speech.mp4");
  await page
    .getByRole("button", { name: "Transcribe video", exact: true })
    .click();
  await page
    .getByLabel("Segment 1", { exact: true })
    .waitFor({ timeout: 120000 });
  assert.match(
    await page.getByLabel("Segment 1", { exact: true }).inputValue(),
    /Americans/,
  );
  for (const format of ["srt", "vtt"]) {
    await page.getByLabel("Export format").selectOption(format);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const download = await pending;
    const output = path.resolve(".local/production-output." + format);
    await download.saveAs(output);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", output],
        { encoding: "utf8" },
      ),
    );
    assert.equal(
      probe.streams[0].codec_name,
      format === "srt" ? "subrip" : "webvtt",
    );
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(5000); // Allow download toast and scroll motion to settle for visual review.
  await page.screenshot({
    path: ".local/production-workspace.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: Production assets, local proxy, actual Base inference, FFprobe-parsed SRT/VTT, 360px layout, no external browser requests or page errors.",
  );
} finally {
  await browser.close();
}
