/// <reference lib="webworker" />
import {
  env,
  AutomaticSpeechRecognitionPipeline,
  WhisperForConditionalGeneration,
  AutoTokenizer,
  AutoProcessor,
} from "@huggingface/transformers";
import {
  BROWSER_MODELS,
  MODEL_CACHE_PREFIX,
  RUNTIME_ROOT,
  isBrowserModel,
  type BrowserModel,
} from "./registry";
import { markInstalled, modelInstalled } from "./cache";
import type { Result, Segment } from "../types";

let installing = false;
let recognizer: AutomaticSpeechRecognitionPipeline | null = null;
let loadedModel: BrowserModel | null = null;
let handling = false;
const nativeFetch = globalThis.fetch.bind(globalThis);
// A cache miss during transcription must never silently download another model.
env.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input.href,
    location.origin,
  );
  if (
    init?.body ||
    (init?.method && !["GET", "HEAD"].includes(init.method.toUpperCase()))
  )
    throw new Error("Only public model downloads are permitted.");
  if (
    url.origin === location.origin &&
    url.pathname.startsWith("/__uncached_model__/")
  )
    return new Response("", { status: 404 });
  const runtime =
    url.origin === location.origin &&
    url.pathname.startsWith(RUNTIME_ROOT + "/");
  const modelHost = url.hostname === "huggingface.co";
  if (!installing || (!runtime && !modelHost))
    throw new Error(
      "Required cached files are missing. Reinstall the model while online. No media was sent.",
    );
  return nativeFetch(input, init);
};
env.allowLocalModels = false;
env.useBrowserCache = false;
env.useFSCache = false;
env.useCustomCache = true;
env.useWasmCache = true;
env.localModelPath = "/__uncached_model__/";
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.backends.onnx.wasm!.wasmPaths = {
  mjs: new URL(
    `${RUNTIME_ROOT}/ort-wasm-simd-threaded.asyncify.mjs`,
    location.origin,
  ).href,
  wasm: new URL(
    `${RUNTIME_ROOT}/ort-wasm-simd-threaded.asyncify.wasm`,
    location.origin,
  ).href,
};

function send(id: string, data: object) {
  postMessage({ id, ...data });
}
async function load(model: BrowserModel, id: string, download: boolean) {
  if (!download && !(await modelInstalled(model)))
    throw new Error(
      "This model is not fully cached. Install it before transcribing.",
    );
  if (recognizer && loadedModel === model) return recognizer;
  await recognizer?.dispose();
  recognizer = null;
  loadedModel = null;
  const cache = await caches.open(MODEL_CACHE_PREFIX + model);
  const spec = BROWSER_MODELS[model];
  const remoteRoot = `https://huggingface.co/${spec.repo}/resolve/`;
  // Transformers.js 4's auxiliary tokenizer metadata lookup omits revision.
  // Resolve ONLY this known model's main lookup to its pinned cached revision.
  env.customCache = {
    match: (key: string) =>
      cache.match(
        key.startsWith(remoteRoot + "main/")
          ? key.replace(remoteRoot + "main/", remoteRoot + spec.revision + "/")
          : key,
      ),
    put: async (key: string, response: Response) => {
      const data = await response.arrayBuffer();
      await cache.put(key, new Response(data, { headers: response.headers }));
    },
  };
  env.allowLocalModels = !download;
  env.allowRemoteModels = download;
  installing = download;
  if (download) {
    for (const filename of [
      "tokenizer_config.json",
      "preprocessor_config.json",
    ]) {
      const url = remoteRoot + spec.revision + "/" + filename;
      if (!(await cache.match(url))) {
        send(id, { kind: "progress", file: filename });
        const response = await env.fetch(url);
        if (!response.ok)
          throw new Error(
            "Model configuration download failed. Retry installation.",
          );
        await env.customCache.put(url, response);
      }
    }
  }
  // Explicit component loading avoids pipeline()'s unpinned online HEAD-based
  // file discovery, which can omit the processor on an offline cache-only run.
  const options = {
    revision: spec.revision,
    device: "wasm" as const,
    dtype: "q8" as const,
    local_files_only: !download,
    progress_callback: (event: {
      status: string;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (event.status === "progress")
        send(id, {
          kind: "progress",
          file: event.file,
          loaded: event.loaded,
          total: event.total,
        });
      else if (event.status === "initiate")
        send(id, { kind: "progress", file: event.file });
    },
  };
  const [network, tokenizer, processor] = await Promise.all([
    WhisperForConditionalGeneration.from_pretrained(spec.repo, options),
    AutoTokenizer.from_pretrained(spec.repo, options),
    AutoProcessor.from_pretrained(spec.repo, options),
  ]);
  const result = new AutomaticSpeechRecognitionPipeline({
    task: "automatic-speech-recognition",
    model: network,
    tokenizer,
    processor,
  });
  recognizer = result;
  loadedModel = model;
  if (download) await markInstalled(model);
  installing = false;
  return recognizer;
}

self.onmessage = async (event: MessageEvent) => {
  const { id, kind, model } = event.data;
  if (handling) {
    send(id, {
      kind: "error",
      error: "A browser operation is already running.",
    });
    return;
  }
  handling = true;
  try {
    if (!isBrowserModel(model))
      throw new Error(
        "Browser mode supports Tiny and Base. Use the Python localhost app for larger models.",
      );
    if (kind === "install") {
      await load(model, id, true);
      send(id, { kind: "installed" });
    } else if (kind === "transcribe") {
      send(id, { kind: "stage", stage: "Loading transcription model" });
      const asr = await load(model, id, false);
      const audio = event.data.audio as Float32Array;
      if (
        !(audio instanceof Float32Array) ||
        audio.length === 0 ||
        audio.length > 16000 * 600
      )
        throw new Error("Invalid or oversized audio buffer.");
      send(id, { kind: "stage", stage: "Transcribing audio" });
      const output = await asr(audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        task: "transcribe",
        ...(event.data.language === "auto"
          ? {}
          : { language: event.data.language }),
      });
      if (Array.isArray(output))
        throw new Error("Unexpected batched transcript.");
      const segments: Segment[] = (output.chunks || [])
        .filter((c) => c.text.trim())
        .map((chunk, index) => ({
          id: index,
          text: chunk.text.trim(),
          start:
            typeof chunk.timestamp[0] === "number"
              ? Math.max(0, chunk.timestamp[0])
              : null,
          end:
            typeof chunk.timestamp[1] === "number"
              ? Math.min(event.data.duration, chunk.timestamp[1])
              : null,
        }));
      if (!segments.length)
        throw new Error(
          "No intelligible speech was detected. Check the audio or choose another language/model.",
        );
      send(id, { kind: "stage", stage: "Preparing transcript" });
      // Whisper's auto language is used internally; this pipeline does not expose
      // a reliable detection probability. Do not invent either that or missing times.
      const result: Result = {
        segments,
        text: segments.map((s) => s.text).join("\n"),
        duration: event.data.duration,
        model,
        language: event.data.language === "auto" ? null : event.data.language,
        language_probability: null,
      };
      send(id, { kind: "result", result });
    } else throw new Error("Unknown browser operation.");
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const known =
      /cache|Install|No intelligible|Invalid or oversized|supports Tiny|browser did not retain/.test(
        text,
      );
    send(id, {
      kind: "error",
      error: known
        ? text
        : installing
          ? "Model installation failed. Check the connection, free browser storage and available memory. Try Tiny; no media was sent."
          : "On-device recognition failed. Try Tiny, close memory-heavy tabs, or use the Python localhost version.",
    });
    console.error("ClipScribe browser worker:", text);
  } finally {
    installing = false;
    handling = false;
  }
};
