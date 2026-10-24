/// <reference lib="webworker" />
import {
  env,
  AutomaticSpeechRecognitionPipeline,
  WhisperForConditionalGeneration,
  AutoTokenizer,
  AutoProcessor,
  LogitsProcessor,
  LogitsProcessorList,
  Tensor,
} from "@huggingface/transformers";
import {
  BROWSER_MODELS,
  MODEL_CACHE_PREFIX,
  RUNTIME_ROOT,
  isBrowserModel,
  type BrowserModel,
  AUDIO_WINDOW_SECONDS,
} from "./registry";
import { markInstalled, modelInstalled } from "./cache";
import type { Result, Segment } from "../types";
import { speechRanges, bestLanguage, SAMPLE_RATE } from "./audio-windows";

class LanguageScores extends LogitsProcessor {
  detected: { language: string; probability: number } | null = null;
  constructor(private languages: Record<string, number>) {
    super();
  }
  _call(_ids: bigint[][], logits: Tensor) {
    const scores = logits.data as Float32Array;
    this.detected = bestLanguage(scores, this.languages);
    const allowed = new Set(Object.values(this.languages));
    for (let i = 0; i < scores.length; i++)
      if (!allowed.has(i)) scores[i] = -Infinity;
    return logits;
  }
}
async function detectLanguage(
  asr: AutomaticSpeechRecognitionPipeline,
  audio: Float32Array,
) {
  const generation = asr.model.generation_config as unknown as {
    lang_to_id: Record<string, number>;
    decoder_start_token_id: number;
  };
  if (
    !generation?.lang_to_id ||
    !Number.isFinite(generation.decoder_start_token_id)
  )
    throw new Error(
      "Language-token mapping is unavailable. Select a known language.",
    );
  const features = await asr.processor(audio);
  const filter = new LanguageScores(generation.lang_to_id);
  const processors = new LogitsProcessorList();
  processors.push(filter);
  try {
    // First decoder token after SOT predicts language. Suppress non-language
    // tokens, not the language tokens; never invoke the library's English fallback.
    const token = await asr.model.generate({
      inputs: features.input_features,
      decoder_input_ids: [generation.decoder_start_token_id],
      max_new_tokens: 1,
      return_timestamps: false,
      return_dict_in_generate: false,
      suppress_tokens: [],
      begin_suppress_tokens: [],
      do_sample: false,
      num_beams: 1,
      logits_processor: processors,
    });
    if (token instanceof Tensor) token.dispose();
    if (!filter.detected)
      throw new Error(
        "Language detection returned no scores. Choose a known language.",
      );
    return filter.detected;
  } finally {
    features.input_features.dispose();
  }
}

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
    // Avoid retaining arena/pattern allocations across encoder/decoder calls,
    // especially for Medium on memory-constrained devices. Hardware limits remain.
    session_options: { enableCpuMemArena: false, enableMemPattern: false },
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
      throw new Error("Choose Tiny, Base, Small or Medium.");
    if (kind === "install") {
      await load(model, id, true);
      send(id, { kind: "installed" });
    } else if (kind === "transcribe") {
      send(id, { kind: "stage", stage: "Loading transcription model" });
      const audio = event.data.audio as Float32Array;
      if (
        !(audio instanceof Float32Array) ||
        audio.length === 0 ||
        audio.length > SAMPLE_RATE * (AUDIO_WINDOW_SECONDS + 1)
      )
        throw new Error("Invalid or oversized audio buffer.");
      send(id, { kind: "stage", stage: "Transcribing audio" });
      const segments: Segment[] = [];
      const offset = Number(event.data.offset || 0);
      const ranges = speechRanges(audio);
      const asr = ranges.length ? await load(model, id, false) : null;
      for (const range of ranges) {
        if (!asr) break;
        const part = audio.subarray(range.start, range.end);
        const auto = event.data.language === "auto";
        const detection = auto
          ? await detectLanguage(asr, part)
          : { language: event.data.language, probability: null };
        const output = await asr(part, {
          return_timestamps: true,
          task: "transcribe",
          language: detection.language,
          chunk_length_s: 0,
          max_new_tokens: 224,
        });
        if (Array.isArray(output))
          throw new Error("Unexpected batched transcript.");
        for (const chunk of output.chunks || []) {
          if (!chunk.text.trim()) continue;
          segments.push({
            id: segments.length,
            text: chunk.text.trim(),
            start:
              typeof chunk.timestamp[0] === "number"
                ? offset +
                  range.start / SAMPLE_RATE +
                  Math.max(0, chunk.timestamp[0])
                : null,
            end:
              typeof chunk.timestamp[1] === "number"
                ? Math.min(
                    event.data.duration,
                    offset +
                      range.start / SAMPLE_RATE +
                      Math.min(part.length / SAMPLE_RATE, chunk.timestamp[1]),
                  )
                : null,
            language: detection.language,
            ...(detection.probability !== null
              ? { language_probability: detection.probability }
              : {}),
          });
        }
        send(id, {
          kind: "progress",
          processed_seconds: offset + range.end / SAMPLE_RATE,
          language: detection.language,
        });
      }
      send(id, { kind: "stage", stage: "Preparing transcript" });
      // Each segment carries its actual detected language. Global mixed-language
      // confidence is not meaningful; keep it null instead of inventing a value.
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
      /cache|Install|No intelligible|Invalid or oversized|Choose Tiny|Language|browser did not retain/.test(
        text,
      );
    send(id, {
      kind: "error",
      error: /bad_alloc|out of memory|memory access|allocation/i.test(text)
        ? "This model exceeded available browser memory during inference. Export completed sections and choose a smaller model, or use the native app on capable hardware."
        : known
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
