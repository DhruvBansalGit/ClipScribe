import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
const fixture = path.resolve(".local/real-speech.mp4");
test("landing, settings, keyboard dismissal and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Turn Every Video Into Words." }),
  ).toBeVisible();
  await expect(page.getByText("Local engine connected")).toBeVisible();
  await page.screenshot({ path: ".local/landing-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Installed locally")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.screenshot({ path: ".local/landing-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("genuine speech upload, inference, editing, sync, clipboard and all exports", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync(fixture),
    "Prepare the real speech fixture first; see README.",
  );
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("http://127.0.0.1:5175")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByText("Local engine connected")).toBeVisible();
  await page.getByLabel("Choose video").setInputFiles(fixture);
  await expect(
    page.getByText("real-speech.mp4", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Transcribe video", exact: true })
    .click();
  await expect(page.getByLabel("Segment 1")).toBeVisible({ timeout: 100000 });
  const first = page.getByLabel("Segment 1", { exact: true });
  expect(await first.inputValue()).toMatch(/Americans/i);
  await first.fill("Edited locally. My fellow Americans.");
  await page.getByLabel("Search transcript").fill("Edited locally");
  await expect(page.locator(".segment")).toHaveCount(1);
  await page.getByLabel("Clear search").click();
  await page.getByRole("button", { name: "Seek to 0:08" }).click();
  expect(
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeCloseTo(8, 0);
  await expect(page.locator("#segment-1")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.getByLabel("Playback speed").selectOption("1.5");
  expect(
    await page
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.playbackRate),
  ).toBe(1.5);
  await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
    v.currentTime = 1;
    await v.play();
  });
  await expect(page.locator("#segment-0")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
  await page.getByLabel("Copy complete transcript").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Edited locally",
  );
  await first.focus();
  await first.press("ControlOrMeta+a");
  await first.press("ArrowLeft");
  for (let i = 0; i < 6; i++) await first.press("Shift+ArrowRight");
  await expect(page.getByLabel("Copy selected text")).toBeEnabled();
  await page.getByLabel("Copy selected text").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Edited",
  );
  for (const format of ["txt", "srt", "vtt", "json"]) {
    await page.getByLabel("Export format").selectOption(format);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("real-speech." + format);
    const downloaded = await download.path();
    const text = fs.readFileSync(downloaded!, "utf8");
    expect(text).toContain("Edited locally");
    if (format === "json") expect(JSON.parse(text).segments[0].start).toBe(0);
    if (format === "srt") expect(text).toMatch(/00:00:00,000 --> 00:00:08,000/);
    if (format === "vtt") expect(text.startsWith("WEBVTT\n\n")).toBeTruthy();
  }
  await expect(page.getByText(/Temporary backend media deleted/)).toBeVisible();
  await page.getByLabel("Segment 1", { exact: true }).blur();
  await page.screenshot({
    path: ".local/workspace-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: ".local/workspace-mobile.png",
    fullPage: true,
  });
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove video" }).click();
  await expect(
    page.getByRole("heading", { name: "Turn Every Video Into Words." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("file validation and backend-unavailable recovery", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Local engine connected")).toBeVisible();
  await page.getByLabel("Choose video").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not video"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Choose a supported video",
  );
  await page.getByLabel("Dismiss error").click();
  await page.route("**/api/config", (r) => r.abort());
  await page.reload();
  await expect(page.getByText("Start your local engine")).toBeVisible();
  await page.unroute("**/api/config");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Local engine connected")).toBeVisible();
});
