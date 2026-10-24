// Reproducible self-hosted runtime assets; no unpkg/CDN runtime dependency.
import { mkdir, copyFile } from "node:fs/promises";
const root = "public/runtime/browser-v1";
await mkdir(root, { recursive: true });
for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"])
  await copyFile(
    `node_modules/@ffmpeg/core/dist/esm/${name}`,
    `${root}/${name}`,
  );
for (const name of [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
])
  await copyFile(
    `node_modules/onnxruntime-web/dist/${name}`,
    `${root}/${name}`,
  );
console.log("Prepared local FFmpeg and ONNX WebAssembly runtime assets.");
