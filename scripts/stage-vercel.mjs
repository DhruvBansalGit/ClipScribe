// Deploy only audited static output. Never send Python backend, media,
// model weights, local profiles, tests or credentials to Vercel.
import { mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
const destination = ".local/vercel-static";
await mkdir(destination, { recursive: true });
// Preserve only the non-secret project linkage while replacing staged assets.
for (const entry of await (
  await import("node:fs/promises")
).readdir(destination)) {
  if (entry !== ".vercel")
    await rm(destination + "/" + entry, { recursive: true, force: true });
}
await cp("dist", destination, { recursive: true });
await writeFile(destination + "/.vercelignore", ".env*\n.git\n*.log\n");
const source = JSON.parse(await readFile("vercel.json", "utf8"));
await writeFile(
  destination + "/vercel.json",
  JSON.stringify(
    {
      $schema: source.$schema,
      framework: null,
      buildCommand: "",
      installCommand: "",
      outputDirectory: ".",
      headers: source.headers,
    },
    null,
    2,
  ),
);
console.log("Static-only deployment staged at " + destination);
