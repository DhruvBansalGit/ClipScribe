// Real model/long-file/multilingual regression. Fixtures are ignored local files.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
const origin = process.env.CLIPSCRIBE_BROWSER_URL || "http://127.0.0.1:4175";
const model = process.env.MODEL || "small";
const fixture = process.env.FIXTURE || ".local/mixed.mp4"; // Real JFK English + explicitly synthetic Hindi
const context = await chromium.launchPersistentContext(
  process.env.TEST_PROFILE || ".local/on-device-profile",
  { headless: true, viewport: { width: 1440, height: 1000 } },
);
const page = await context.newPage();
page.setDefaultTimeout(20000);
const requests = [];
page.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
page.on("console", (m) => {
  if (m.type() === "error") console.error(m.text());
});
try {
  await page.goto(origin + "/?engine=browser");
  await page.getByText("On-device browser engine", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(await page.locator(".model-choices button").count(), 4);
  await page
    .locator(".model-choices button")
    .filter({ hasText: new RegExp("^" + model, "i") })
    .click();
  if (
    !(await page
      .getByText("Cached in this browser", { exact: true })
      .isVisible())
  ) {
    await page.getByRole("checkbox", { name: /I agree/ }).check();
    await page
      .getByRole("button", { name: "Download to this device", exact: true })
      .click();
    await Promise.race([
      page
        .getByText("Cached in this browser", { exact: true })
        .waitFor({ timeout: 240000 }),
      page
        .getByText("Installation failed", { exact: true })
        .waitFor({ timeout: 240000 })
        .then(async () => {
          throw new Error(await page.locator(".inline-error").innerText());
        }),
    ]);
  }
  console.log("Installed and loaded", model);
  await page.locator(".settings-pair select").first().selectOption("auto");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByLabel("Choose video").setInputFiles(fixture);
  const before = requests.length;
  await page
    .getByRole("button", { name: "Transcribe video", exact: true })
    .click();
  await Promise.race([
    page
      .getByText("Transcription complete", { exact: true })
      .waitFor({ timeout: 240000 }),
    page
      .locator(".alert.error")
      .waitFor({ timeout: 240000 })
      .then(async () => {
        throw new Error(await page.locator(".alert.error").innerText());
      }),
  ]);
  const values = await page
    .locator(".segment textarea")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({ text: n.value, language: n.lang })),
    );
  console.log(JSON.stringify(values, null, 2));
  assert(values.some((v) => v.language === "en" && /country/i.test(v.text)));
  if (fixture.includes("mixed")) {
    assert(values.some((v) => v.language === "hi"));
    assert(values.some((v) => /[\u0900-\u097f]/.test(v.text)));
  }
  if (fixture.endsWith("/mixed.mp4"))
    assert(
      values.some((v) => v.language === "hi" && /मौसम|बारिश|शहर/.test(v.text)),
      "Hindi recognition must contain relevant words, not merely Devanagari characters",
    );
  if (fixture.includes("mixed-human"))
    assert(
      values.some(
        (v) => v.language === "hi" && /कुछ|अणु|केंद्र|मतलब/.test(v.text),
      ),
      "Human-Hindi quality check failed; detection alone is not successful recognition",
    );
  assert(
    !requests
      .slice(before)
      .some(
        (r) =>
          r.method !== "GET" ||
          (!r.url.startsWith(origin) && !r.url.startsWith("blob:")),
      ),
  );
  await page.getByLabel("Export format").selectOption("json");
  let pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await (await pending).saveAs(`.local/revision-${model}.json`);
  const result = JSON.parse(
    fs.readFileSync(`.local/revision-${model}.json`, "utf8"),
  );
  assert.equal(result.partial, false);
  assert(
    result.segments.every(
      (s) => s.start === null || s.end === null || s.start <= s.end,
    ),
  );
  if (fixture.includes("long")) {
    assert(result.duration > 600);
    assert(result.segments.some((s) => s.start > 600));
  }
  await page.getByLabel("Export format").selectOption("txt");
  pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await (await pending).saveAs(`.local/revision-${model}.txt`);
  const txt = fs.readFileSync(`.local/revision-${model}.txt`, "utf8");
  assert.match(txt, /\[\d\d:\d\d:\d\d\.\d{3} -->/);
  await page.screenshot({
    path: `.local/revision-${model}.png`,
    fullPage: true,
  });
  console.log(
    "PASS model, detected languages, source timestamps, TXT, no media upload:",
    model,
    fixture,
  );
} catch (e) {
  console.error((await page.locator("body").innerText()).slice(-5000));
  throw e;
} finally {
  await context.close();
}
