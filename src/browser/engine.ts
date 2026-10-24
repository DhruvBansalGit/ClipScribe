import type { Config, Job, Model, Settings, Result, Segment } from "../types";
import {
  BROWSER_MODELS,
  MODEL_CACHE_PREFIX,
  MEDIA_CACHE,
  AUDIO_WINDOW_SECONDS,
  LANGUAGES,
  EXTENSIONS,
  isBrowserModel,
  type BrowserModel,
} from "./registry";
import { modelInstalled } from "./cache";
import { LocalMedia } from "./media";

type ModelState = Config["models"][Model];
type WorkerEvent = {
  id: string;
  kind: string;
  error?: string;
  stage?: string;
  result?: Result;
  file?: string;
  loaded?: number;
  total?: number;
  processed_seconds?: number;
  language?: string;
};

class BrowserEngine {
  private worker: Worker | null = null;
  private pending: ((error: Error) => void) | null = null;
  private media: LocalMedia | null = null;
  private abort: AbortController | null = null;
  private operation: "install" | "transcribe" | null = null;
  private model: BrowserModel | null = null;
  private state: Partial<Record<BrowserModel, ModelState>> = {};
  private listeners = new Set<() => void>();
  private job: Job | null = null;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
  async config(): Promise<Config> {
    const models = {} as Config["models"];
    for (const model of Object.keys(BROWSER_MODELS) as BrowserModel[]) {
      const cached = await modelInstalled(model);
      models[model] =
        this.state[model]?.status === "downloading"
          ? this.state[model]!
          : cached
            ? { status: "installed" }
            : this.state[model] || { status: "not_installed" };
      if (models[model].status === "installed" && !cached)
        models[model] = { status: "not_installed" };
    }
    return {
      token: "",
      max_bytes: null,
      max_duration: null,
      ffmpeg: true,
      speech_dependencies:
        typeof WebAssembly !== "undefined" &&
        "caches" in globalThis &&
        window.isSecureContext,
      cuda: false,
      languages: LANGUAGES,
      extensions: EXTENSIONS,
      models,
    };
  }
  private request(
    message: object,
    progress: (event: WorkerEvent) => void,
    transfer: Transferable[] = [],
  ): Promise<WorkerEvent> {
    const worker =
      this.worker ||
      (this.worker = new Worker(new URL("./asr.worker.ts", import.meta.url), {
        type: "module",
      }));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending = null;
          worker.onmessage = null;
          worker.onerror = null;
          this.stopWorker();
          reject(
            new Error(
              "This model operation stalled for 20 minutes. Completed windows are preserved; try a smaller model or another browser. This is a per-window watchdog, not a recording-duration limit.",
            ),
          );
        },
        20 * 60 * 1000,
      );
      const finish = () => {
        clearTimeout(timer);
        worker.onmessage = null;
        worker.onerror = null;
        this.pending = null;
      };
      this.pending = (error) => {
        finish();
        reject(error);
      };
      worker.onerror = () => {
        finish();
        this.stopWorker();
        reject(
          new Error(
            "The browser inference worker stopped. Try Tiny, close other tabs, or use a supported desktop browser.",
          ),
        );
      };
      worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
        if (data.id !== id) return;
        if (data.kind === "error") {
          finish();
          reject(new Error(data.error));
        } else if (data.kind === "result" || data.kind === "installed") {
          finish();
          resolve(data);
        } else progress(data);
      };
      worker.postMessage({ id, ...message }, transfer);
    });
  }
  private stopWorker() {
    this.worker?.terminate();
    this.worker = null;
  }
  async install(model: Model) {
    if (!isBrowserModel(model))
      throw new Error("Choose Tiny, Base, Small or Medium.");
    if (this.operation)
      throw new Error("Wait for the current browser operation or cancel it.");
    this.operation = "install";
    this.model = model;
    this.abort = new AbortController();
    this.state[model] = {
      status: "downloading",
      file: "Preparing on-device audio runtime",
    };
    this.notify();
    try {
      // Browser persistence is a request, not a guarantee; browsers can evict data.
      await navigator.storage?.persist?.().catch(() => false);
      this.media = new LocalMedia();
      await this.media.load(true, this.abort.signal);
      this.media.dispose();
      this.media = null;
      if (this.abort.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      await this.request({ kind: "install", model }, (event) => {
        if (event.kind === "progress") {
          this.state[model] = {
            status: "downloading",
            file: event.file,
            loaded: event.loaded,
            total: event.total,
          };
          this.notify();
        }
      });
      this.state[model] = { status: "installed" };
    } catch (error) {
      this.state[model] = {
        status:
          error instanceof DOMException && error.name === "AbortError"
            ? "not_installed"
            : "failed",
        error:
          error instanceof Error ? error.message : "Model download failed.",
      };
      throw error;
    } finally {
      this.stopWorker();
      this.media?.dispose();
      this.media = null;
      this.operation = null;
      this.abort = null;
      this.notify();
    }
  }
  cancelInstall() {
    if (this.operation !== "install") return;
    this.abort?.abort();
    this.media?.dispose();
    const reject = this.pending;
    this.stopWorker();
    reject?.(
      new DOMException(
        "Download cancelled. Partial files can be reused on retry.",
        "AbortError",
      ),
    );
  }
  async remove(model: Model) {
    if (!isBrowserModel(model)) return;
    if (this.operation)
      throw new Error("Cancel the current operation before removing a model.");
    this.stopWorker();
    await caches.delete(MODEL_CACHE_PREFIX + model);
    delete this.state[model];
    this.notify();
  }
  async start(file: File, settings: Settings, onUpdate: (job: Job) => void) {
    if (this.operation)
      throw new Error("Another browser operation is running.");
    if (!isBrowserModel(settings.model))
      throw new Error("Choose Tiny, Base, Small or Medium.");
    this.operation = "transcribe";
    this.abort = new AbortController();
    this.job = {
      id: crypto.randomUUID(),
      filename: file.name,
      status: "processing",
      stage: "Preparing video",
      media_deleted: false,
    };
    const update = (patch: Partial<Job>) => {
      this.job = { ...this.job!, ...patch };
      onUpdate({ ...this.job });
    };
    update({});
    const segments: Segment[] = [];
    let duration = 0;
    const snapshot = (partial: boolean): Result => {
      const languages = new Set(
        segments.map((s) => s.language).filter(Boolean),
      );
      return {
        segments: [...segments],
        text: segments.map((s) => s.text).join("\n"),
        model: settings.model,
        duration,
        language:
          languages.size > 1
            ? "mul"
            : languages.size === 1
              ? [...languages][0]!
              : null,
        language_probability: null,
        partial,
      };
    };
    try {
      if (!(await modelInstalled(settings.model)))
        throw new Error(
          "Install the model before transcribing. The browser may have cleared its cache.",
        );
      this.media = new LocalMedia();
      duration = await this.media.prepare(file, this.abort.signal, (stage) =>
        update({ stage }),
      );
      if (this.abort.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      update({ duration });
      for (let offset = 0; offset < duration; offset += AUDIO_WINDOW_SECONDS) {
        if (this.abort.signal.aborted)
          throw new DOMException("Cancelled", "AbortError");
        update({ stage: "Extracting audio" });
        const { audio } = await this.media.extractWindow(
          offset,
          this.abort.signal,
        );
        const event = await this.request(
          {
            kind: "transcribe",
            model: settings.model,
            language: settings.language,
            audio,
            duration,
            offset,
          },
          (event) => {
            if (event.kind === "stage") update({ stage: event.stage! });
            if (event.processed_seconds !== undefined)
              update({ processed_seconds: event.processed_seconds });
          },
          [audio.buffer],
        );
        if (!event.result)
          throw new Error("The browser returned no window result.");
        for (const segment of event.result.segments)
          segments.push({ ...segment, id: segments.length });
        update({
          result: snapshot(true),
          processed_seconds: Math.min(duration, offset + AUDIO_WINDOW_SECONDS),
        });
      }
      if (!segments.length)
        throw new Error(
          "No intelligible speech was detected. Check the audio or choose another model.",
        );
      update({
        status: "completed",
        stage: "Completed",
        result: snapshot(false),
        media_deleted: true,
      });
    } catch (error) {
      const cancelled = this.abort?.signal.aborted;
      update({
        status: cancelled ? "cancelled" : "failed",
        stage: cancelled ? "Cancelled" : "Failed",
        media_deleted: true,
        error: cancelled
          ? undefined
          : error instanceof Error
            ? error.message
            : "Browser transcription failed.",
      });
    } finally {
      this.media?.dispose();
      this.media = null;
      this.stopWorker();
      this.operation = null;
      this.abort = null;
      this.notify();
    }
  }
  cancel() {
    if (this.operation !== "transcribe") return;
    this.abort?.abort();
    this.media?.dispose();
    const reject = this.pending;
    this.stopWorker();
    reject?.(new DOMException("Cancelled", "AbortError"));
  }
}
export const browserEngine = new BrowserEngine();
