import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import classWorkerURL from "./ffmpeg.worker?worker&url";
import { MEDIA_CACHE, RUNTIME_ROOT, AUDIO_WINDOW_SECONDS } from "./registry";

export class LocalMedia {
  private ffmpeg = new FFmpeg();
  private urls: string[] = [];
  private disposed = false;
  private input = "";
  private duration = 0;
  async load(download: boolean, signal: AbortSignal) {
    const cache = await caches.open(MEDIA_CACHE);
    const get = async (name: string, type: string) => {
      const key = new URL(`${RUNTIME_ROOT}/${name}`, location.origin).href;
      let response = await cache.match(key);
      if (!response) {
        if (!download)
          throw new Error(
            "Audio runtime cache was cleared. Reinstall a model to prepare this browser.",
          );
        try {
          response = await fetch(key, { signal });
        } catch (error) {
          if (signal.aborted) throw error;
          throw new Error(
            "Could not download the audio runtime. Check the connection and free disk space, then retry.",
          );
        }
        if (!response.ok)
          throw new Error(
            "Could not download the local audio runtime. Check your connection and retry.",
          );
        const buffer = await response.arrayBuffer();
        try {
          await cache.put(
            key,
            new Response(buffer, { headers: response.headers }),
          );
        } catch {
          throw new Error(
            "The browser could not save the audio runtime. Free disk space, enable site storage, or try a regular browser window, then retry.",
          );
        }
        response = new Response(buffer, { headers: response.headers });
      }
      const url = URL.createObjectURL(
        new Blob([await response.arrayBuffer()], { type }),
      );
      this.urls.push(url);
      return url;
    };
    const coreURL = await get("ffmpeg-core.js", "text/javascript");
    const wasmURL = await get("ffmpeg-core.wasm", "application/wasm");
    if (this.disposed || signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    try {
      await this.ffmpeg.load({ coreURL, wasmURL, classWorkerURL }, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        "The browser audio worker could not start. Reload the page, check browser security/storage permissions, and retry.",
      );
    }
  }
  async prepare(
    file: File,
    signal: AbortSignal,
    onStage: (stage: string) => void,
  ) {
    if (!file.size) throw new Error("Choose a non-empty video.");
    onStage("Preparing video");
    await this.load(false, signal);
    await this.ffmpeg.createDir("/input");
    // WORKERFS mounts the File as read-only slices rather than copying the
    // entire large video into frontend JavaScript or WASM memory.
    await this.ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, "/input");
    const input = "/input/" + file.name;
    this.input = input;
    const safe = [
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "mov,matroska,webm,avi,mpeg,mpegts,asf,flv,ogg",
    ];
    const code = await this.ffmpeg.ffprobe(
      [
        "-v",
        "error",
        ...safe,
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        "-o",
        "/metadata.json",
        input,
      ],
      120000,
    );
    // This pinned ffprobe WASM build reports -1 after successful cleanup.
    // Accept it only with complete, parseable metadata; never infer success from -1.
    let metadata;
    try {
      if (code !== 0 && code !== -1) throw new Error("Probe failed");
      metadata = JSON.parse(
        (await this.ffmpeg.readFile("/metadata.json", "utf8")) as string,
      );
    } catch {
      throw new Error(
        "This video is unreadable or unsupported by the browser FFmpeg build. Try an MP4 with AAC audio.",
      );
    }
    if (
      !metadata.streams?.some(
        (s: { codec_type: string; disposition?: { attached_pic?: number } }) =>
          s.codec_type === "video" && !s.disposition?.attached_pic,
      )
    )
      throw new Error(
        "No video stream found. Choose a video containing speech.",
      );
    if (
      !metadata.streams.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      )
    )
      throw new Error(
        "This video has no audio stream. Choose a video containing speech.",
      );
    const duration = Number(metadata.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(
        "This video has no readable finite duration. Try re-exporting it as MP4.",
      );
    this.duration = duration;
    return duration;
  }
  async extractWindow(start: number, signal: AbortSignal) {
    if (!this.input || start < 0 || start >= this.duration)
      throw new Error("Invalid source-video audio window.");
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const windowDuration = Math.min(
      AUDIO_WINDOW_SECONDS,
      this.duration - start,
    );
    const safe = [
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "mov,matroska,webm,avi,mpeg,mpegts,asf,flv,ogg",
    ];
    const status = await this.ffmpeg.exec(
      [
        "-nostdin",
        "-v",
        "error",
        ...safe,
        // Input seeking keeps decode bounded. Default FFmpeg timestamp
        // normalization yields window-relative samples; offsets are added once
        // to real model timestamps in the ASR worker, on the original timeline.
        "-ss",
        String(start),
        "-i",
        this.input,
        "-map",
        "0:a:0",
        "-vn",
        "-af",
        "aresample=async=1:first_pts=0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        String(windowDuration),
        "-c:a",
        "pcm_s16le",
        "-y",
        "/audio.wav",
      ],
      300000,
    );
    if (status !== 0)
      throw new Error(
        "An audio window could not be decoded. Export the completed transcript, then try re-encoding the video as MP4/AAC.",
      );
    const wav = await this.ffmpeg.readFile("/audio.wav");
    if (typeof wav === "string")
      throw new Error("Audio extraction returned an invalid buffer.");
    const audio = readPCM(wav);
    await this.ffmpeg.deleteFile("/audio.wav");
    // Bounded PCM output is essential: never accumulate decoded whole videos.
    if (audio.length > 16000 * (AUDIO_WINDOW_SECONDS + 1))
      throw new Error("Audio decoder exceeded the processing-window bound.");
    return {
      audio: audio.subarray(0, Math.ceil(windowDuration * 16000)),
      duration: windowDuration,
    };
  }
  dispose() {
    this.disposed = true;
    this.ffmpeg.terminate();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }
}

export function readPCM(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, n: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + n));
  if (bytes.length < 44 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE")
    throw new Error("The extracted audio is not a valid WAV file.");
  let valid = false;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const size = view.getUint32(offset + 4, true),
      start = offset + 8;
    if (start + size > bytes.length)
      throw new Error("The extracted audio is truncated.");
    if (text(offset, 4) === "fmt ") {
      valid =
        size >= 16 &&
        view.getUint16(start, true) === 1 &&
        view.getUint16(start + 2, true) === 1 &&
        view.getUint32(start + 4, true) === 16000 &&
        view.getUint16(start + 14, true) === 16;
    }
    if (text(offset, 4) === "data") {
      if (!valid) throw new Error("Expected 16 kHz mono PCM audio.");
      const result = new Float32Array(Math.floor(size / 2));
      for (let i = 0; i < result.length; i++)
        result[i] = view.getInt16(start + i * 2, true) / 32768;
      return result;
    }
    offset = start + size + (size % 2);
  }
  throw new Error("The extracted WAV contains no audio samples.");
}
