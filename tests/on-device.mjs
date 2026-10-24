// Real browser-only inference; no mocked recognition and no Python API.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const origin = process.env.CLIPSCRIBE_BROWSER_URL || "http://127.0.0.1:4175";
const model = process.env.CLIPSCRIBE_BROWSER_MODEL || "tiny";
const browser = process.env.CLIPSCRIBE_EPHEMERAL
  ? await chromium.launch()
  : null;
const options = {
  headless: true,
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
};
const context = browser
  ? await browser.newContext(options)
  : await chromium.launchPersistentContext(".local/on-device-profile", options);
const page = await context.newPage();
const requests = [];
const errors = [];
const passed = [];
const pass = (message) => {
  passed.push(message);
  console.log("PASS:", message);
};
page.on("request", (r) =>
  requests.push({ url: r.url(), method: r.method(), body: !!r.postData() }),
);
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error("PAGE:", e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") console.error("CONSOLE:", m.text());
});
async function ready() {
  await Promise.race([
    page.getByLabel("Segment 1", { exact: true }).waitFor({ timeout: 150000 }),
    page
      .locator(".alert.error")
      .waitFor({ timeout: 150000 })
      .then(async () => {
        throw new Error(await page.locator(".alert.error").innerText());
      }),
  ]);
}
async function transcribe() {
  await page.getByLabel("Choose video").setInputFiles(".local/real-speech.mp4");
  await page
    .getByRole("button", { name: "Transcribe video", exact: true })
    .click();
  await ready();
  const text = await page
    .locator(".segment textarea")
    .evaluateAll((nodes) => nodes.map((n) => n.value).join(" "));
  assert.match(text, /country/i);
  return text;
}
try {
  await page.goto(origin + "/?engine=browser");
  await page
    .getByText("On-device browser engine", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .locator(".model-choices button")
    .filter({ hasText: new RegExp("^" + model, "i") })
    .click();
  if (
    !(await page
      .getByText("Cached in this browser", { exact: true })
      .isVisible())
  ) {
    const download = page.getByRole("button", {
      name: "Download to this device",
      exact: true,
    });
    assert(await download.isDisabled());
    assert(
      !requests.some((r) => r.url.startsWith("https://huggingface.co/")),
      "No model download before consent",
    );
    await page.getByRole("checkbox", { name: /I agree to download/ }).check();
    await download.click();
    console.log("Downloading actual", model, "model and runtime…");
    await Promise.race([
      page
        .getByText("Cached in this browser", { exact: true })
        .waitFor({ timeout: 150000 }),
      page
        .getByText("Installation failed", { exact: true })
        .waitFor({ timeout: 150000 })
        .then(async () => {
          throw new Error(await page.locator(".inline-error").innerText());
        }),
    ]);
    pass("Explicit consent, real model download and complete-cache status");
  } else pass("Model persisted from a previous browser launch");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const before = requests.length;
  const text = await transcribe();
  pass("Real " + model + " WASM recognition: " + text);
  assert(
    !requests.some(
      (r) =>
        new URL(r.url).origin === origin &&
        new URL(r.url).pathname.startsWith("/api/"),
    ),
    "No Python API calls",
  );
  assert(
    !requests.some((r) => r.method !== "GET" || r.body),
    "No media/request-body uploads",
  );
  assert(
    !requests.slice(before).some((r) => new URL(r.url).origin !== origin),
    "No external downloads during transcription",
  );
  pass(
    "No API calls, no media uploads and no external downloads during inference",
  );
  const first = page.getByLabel("Segment 1", { exact: true });
  await first.fill("Edited on this device. " + (await first.inputValue()));
  await page.getByLabel("Search transcript").fill("Edited on this device");
  assert.equal(await page.locator(".segment").count(), 1);
  await page.getByLabel("Clear search").click();
  await page.getByLabel("Copy complete transcript").click();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /Edited on this device/,
  );
  await page.getByRole("button", { name: "Seek to 0:00" }).click();
  await page.locator("video").evaluate(async (v) => {
    v.currentTime = 2;
    await v.play();
  });
  await page.waitForFunction(() =>
    document.querySelector(".segment[data-active=true]"),
  );
  await page.locator("video").evaluate((v) => v.pause());
  pass(
    "Browser transcript editing, search, clipboard, playback and timestamp synchronization",
  );
  for (const format of ["txt", "srt", "vtt", "json"]) {
    await page.getByLabel("Export format").selectOption(format);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const downloaded = await pending;
    const target = `.local/browser-${model}.${format}`;
    await downloaded.saveAs(target);
    const content = fs.readFileSync(target, "utf8");
    assert.match(content, /Edited on this device/);
    if (format === "json") {
      const result = JSON.parse(content);
      assert(
        result.segments.every(
          (s) =>
            Number.isFinite(s.start) &&
            Number.isFinite(s.end) &&
            s.end > s.start,
        ),
      );
    }
    if (format === "srt" || format === "vtt") {
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_streams", "-of", "json", target],
          { encoding: "utf8" },
        ),
      );
      assert.equal(
        probe.streams[0].codec_name,
        format === "srt" ? "subrip" : "webvtt",
      );
    }
  }
  pass("All four edited exports; SRT and VTT parsed by native FFprobe");
  await first.blur();
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(5000);
  await page.screenshot({
    path: ".local/on-device-workspace.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: ".local/on-device-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  pass("Responsive 390px workspace without horizontal overflow");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove video" }).click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByText("On-device browser engine", { exact: true }).waitFor();
  await transcribe();
  pass(
    "Offline page reload and fresh-worker recognition with browser networking disabled",
  );
  await context.setOffline(false);
  await page.getByRole("button", { name: "Remove video" }).click();
  await page
    .getByRole("heading", { name: "Turn Every Video Into Words." })
    .waitFor();
  await page.getByLabel("Choose video").setInputFiles(".local/real-speech.mp4");
  await page
    .getByRole("button", { name: "Transcribe video", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel transcription", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Paused before the words." })
    .waitFor();
  pass("Browser job cancellation returns to a usable workspace");
  await page.getByRole("button", { name: "Remove video" }).click();
  await page
    .getByRole("heading", { name: "Turn Every Video Into Words." })
    .waitFor();
  await page
    .getByLabel("Choose video")
    .setInputFiles({
      name: "broken.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from("not real video"),
    });
  await page
    .getByRole("button", { name: "Transcribe video", exact: true })
    .click();
  await page.locator(".alert.error").waitFor();
  assert.match(
    await page.locator(".alert.error").innerText(),
    /unreadable|No video stream/,
  );
  pass("Corrupt media produces an actionable error, not a transcript");
  await page.getByRole("button", { name: "Remove video" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({
    path: ".local/on-device-settings.png",
    fullPage: true,
  });
  if (process.env.CLIPSCRIBE_REMOVE_MODEL) {
    await page
      .getByRole("button", {
        name: `Remove ${model} from this browser`,
        exact: true,
      })
      .click();
    await page.getByText("Not installed yet", { exact: true }).waitFor();
    const hasCache = await page.evaluate(
      async (m) => (await caches.keys()).includes("clipscribe-onnx-v1-" + m),
      model,
    );
    // Status inspection may recreate an empty cache, but no model assets can remain.
    if (hasCache)
      assert.equal(
        await page.evaluate(
          async (m) =>
            (await (await caches.open("clipscribe-onnx-v1-" + m)).keys())
              .length,
          model,
        ),
        0,
      );
    pass("Remove-model control deletes local weights");
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { model, origin, passed: passed.length, checks: passed },
      null,
      2,
    ),
  );
} catch (error) {
  if (!page.isClosed()) {
    console.error((await page.locator("body").innerText()).slice(-7000));
    await page.screenshot({
      path: ".local/on-device-error.png",
      fullPage: true,
    });
  }
  throw error;
} finally {
  await context.close();
  await browser?.close();
}
