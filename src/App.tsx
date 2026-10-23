import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AudioLines,
  ArrowRight,
  ArrowUpRight,
  Upload,
  Film,
  ShieldCheck,
  SlidersHorizontal,
  Plus,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Search,
  FileText,
  LoaderCircle,
  CircleHelp,
  Cpu,
  HardDrive,
  LockKeyhole,
  Headphones,
  Scissors,
  Captions,
  RotateCcw,
  TriangleAlert,
  CheckCheck,
  Radio,
  PanelLeftClose,
} from "lucide-react";
import type { Config, Format, Job, Model, Segment, Settings } from "./types";
import {
  activeSegment,
  clock,
  download,
  fullText,
  loadSettings,
} from "./transcript";

const models: { id: Model; label: string; note: string }[] = [
  { id: "tiny", label: "Tiny", note: "Light & fast" },
  { id: "base", label: "Base", note: "Everyday balance" },
  { id: "small", label: "Small", note: "More detail" },
  { id: "medium", label: "Medium", note: "More demanding" },
];
const stages = [
  "Preparing video",
  "Extracting audio",
  "Loading transcription model",
  "Transcribing audio",
  "Preparing transcript",
];
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const languageName = (code: string) => {
  try {
    return languageNames.of(code) || code;
  } catch {
    return code;
  }
};
const bytes = (size: number) =>
  size >= 1024 ** 3
    ? `${(size / 1024 ** 3).toFixed(1)} GB`
    : `${(size / 1024 ** 2).toFixed(1)} MB`;

async function responseJSON(response: Response) {
  const data = await response
    .json()
    .catch(() => ({ detail: "The backend returned an unreadable response." }));
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request could not be completed.",
    );
  return data;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [config, setConfig] = useState<Config | null>(null);
  const [offline, setOffline] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [previewError, setPreviewError] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [follow, setFollow] = useState(true);
  const [edited, setEdited] = useState(false);
  const [selected, setSelected] = useState("");
  const [installing, setInstalling] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const submitLock = useRef(false);
  const resultId = useRef("");
  const modal = useRef<HTMLDialogElement>(null);
  const reduced = useReducedMotion();
  const busy =
    uploading ||
    (!!job && ["queued", "processing", "uploading"].includes(job.status));
  const active = activeSegment(segments, time);
  const matching = segments.filter((s) =>
    s.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const words = fullText(segments).match(/\S+/gu)?.length || 0;
  const modelState = config?.models[settings.model];

  const refresh = useCallback(async () => {
    try {
      const c = await responseJSON(
        await fetch("/api/config", { signal: AbortSignal.timeout(7000) }),
      );
      setConfig(c);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    try {
      localStorage.setItem("clipscribe.settings", JSON.stringify(settings));
    } catch {
      /* Memory-only settings still work. */
    }
  }, [settings]);
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const object = URL.createObjectURL(file);
    setUrl(object);
    return () => URL.revokeObjectURL(object);
  }, [file]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!job || !["queued", "processing", "uploading"].includes(job.status))
      return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}`, {
          signal: AbortSignal.timeout(7000),
        });
        if (response.status === 404) {
          if (!cancelled) {
            setJob({ ...job, status: "failed", stage: "Failed" });
            setError(
              "The backend restarted or this job expired. Your video is still selected; retry transcription.",
            );
          }
          return;
        }
        const next: Job = await responseJSON(response);
        if (cancelled) return;
        setJob(next);
        setOffline(false);
        if (next.duration) setDuration(next.duration);
        if (
          next.status === "completed" &&
          next.result &&
          resultId.current !== next.id
        ) {
          setSegments(next.result.segments);
          resultId.current = next.id;
          setToast("Transcript ready. Make it yours.");
        }
        if (next.status === "failed")
          setError(next.error || "Transcription failed. Please retry.");
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Connection lost. Reconnecting…",
          );
          setOffline(true);
        }
      }
    };
    const id = setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (
      active !== null &&
      follow &&
      playing &&
      !query &&
      document.activeElement?.tagName !== "TEXTAREA"
    )
      document.getElementById(`segment-${active}`)?.scrollIntoView({
        behavior: reduced ? "instant" : "smooth",
        block: "nearest",
      });
  }, [active, follow, playing, query, reduced]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (busy || edited) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [busy, edited]);
  useEffect(() => {
    if (settingsOpen || helpOpen) modal.current?.showModal();
    else modal.current?.close();
  }, [settingsOpen, helpOpen]);
  useEffect(() => () => xhr.current?.abort(), []);

  function preference<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }
  async function api(path: string, method = "POST") {
    if (!config) throw new Error("Start the local backend, then retry.");
    return responseJSON(
      await fetch(path, {
        method,
        headers: { "X-ClipScribe-Token": config.token },
        signal: AbortSignal.timeout(10000),
      }),
    );
  }
  async function reset() {
    if (busy) return false;
    if (
      segments.length &&
      !window.confirm(
        "Start a new transcription? Download your transcript first; current edits will be discarded.",
      )
    )
      return false;
    if (job) {
      try {
        await api(`/api/jobs/${job.id}`, "DELETE");
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    }
    setFile(null);
    setJob(null);
    setSegments([]);
    setQuery("");
    setError("");
    setDuration(0);
    setTime(0);
    setPlaying(false);
    setEdited(false);
    setSelected("");
    setPreviewError(false);
    setSpeed("1");
    resultId.current = "";
    if (input.current) input.current.value = "";
    return true;
  }
  async function choose(candidate?: File) {
    if (!candidate || busy) return;
    const ext = candidate.name.split(".").pop()?.toLowerCase() || "";
    if (candidate.size === 0) {
      setError("This file is empty. Choose a video containing speech.");
      return;
    }
    if (config && candidate.size > config.max_bytes) {
      setError(`Choose a file smaller than ${bytes(config.max_bytes)}.`);
      return;
    }
    if (
      !(
        config?.extensions || [
          "mp4",
          "mov",
          "webm",
          "mkv",
          "avi",
          "m4v",
          "mpeg",
          "mpg",
          "mts",
          "m2ts",
          "ts",
          "3gp",
          "ogv",
          "wmv",
          "flv",
        ]
      ).includes(ext)
    ) {
      setError("Choose a supported video such as MP4, MOV, WebM or MKV.");
      return;
    }
    if (file && !(await reset())) return;
    setError("");
    setFile(candidate);
    setPreviewError(false);
    setDuration(0);
    setJob(null);
  }
  async function transcribe() {
    if (!file || !config || busy || submitLock.current) return;
    if (modelState?.status !== "installed") {
      setSettingsOpen(true);
      return;
    }
    submitLock.current = true;
    setError("");
    setUploading(true);
    setUploadPercent(null);
    const params = new URLSearchParams({
      model: settings.model,
      language: settings.language,
      device: settings.device,
      cleanup: settings.cleanup,
    });
    const requestId = crypto.randomUUID();
    const request = new XMLHttpRequest();
    xhr.current = request;
    request.open("POST", `/api/jobs?${params}`);
    request.timeout = 1800000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-ClipScribe-Token", config.token);
    request.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    request.setRequestHeader("X-Request-ID", requestId);
    request.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setUploadPercent(Math.round((e.loaded / e.total) * 100));
    };
    request.onload = () => {
      try {
        const data = JSON.parse(request.responseText);
        if (request.status < 200 || request.status >= 300)
          throw new Error(data.detail || "Upload failed.");
        setJob(data);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    request.onerror = () =>
      setError("Cannot reach the local backend. Start FastAPI and retry.");
    request.ontimeout = () =>
      setError(
        "Upload timed out. Check the backend and choose a smaller video.",
      );
    request.onabort = () => setToast("Upload cancelled.");
    request.onloadend = () => {
      setUploading(false);
      submitLock.current = false;
      xhr.current = null;
    };
    request.send(file); // Send the File directly; no base64 or full-file JS buffer.
  }
  async function cancel() {
    if (uploading) {
      xhr.current?.abort();
      return;
    }
    if (job) {
      try {
        setJob(await api(`/api/jobs/${job.id}/cancel`));
        setToast("Transcription cancelled.");
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }
  async function installModel() {
    setInstalling(true);
    setError("");
    try {
      await api(`/api/models/${settings.model}/install`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied to clipboard.");
    } catch {
      setError(
        "Clipboard access was blocked. Select the transcript text and use your keyboard to copy.",
      );
    }
  }
  function exportAs(format: Format) {
    try {
      download(format, segments, file?.name || "transcript", job?.result);
      setToast(
        `${format.toUpperCase()} download prepared with your latest edits.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function seek(seconds: number) {
    if (video.current && !previewError) {
      video.current.currentTime = seconds;
      setTime(seconds);
    }
  }
  const picker = (
    <input
      ref={input}
      type="file"
      className="sr-only"
      aria-label="Choose video"
      accept={(
        config?.extensions || [
          "mp4",
          "mov",
          "webm",
          "mkv",
          "avi",
          "m4v",
          "mpeg",
          "mpg",
          "mts",
          "m2ts",
          "ts",
          "3gp",
          "ogv",
          "wmv",
          "flv",
        ]
      )
        .map((x) => "." + x)
        .join(",")}
      onChange={(e) => void choose(e.target.files?.[0])}
    />
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            void reset();
          }}
          aria-label="ClipScribe home"
        >
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <span>
            Clip<span className="brand-light">Scribe</span>
            <span className="brand-dot">.</span>
          </span>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <button
          className="nav-item nav-active"
          onClick={() => {
            if (!file) input.current?.click();
            else
              document
                .getElementById("workspace")
                ?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <FileText size={18} /> Transcription{" "}
          <span className="nav-count">01</span>
        </button>
        <button
          className="nav-item"
          disabled={busy}
          onClick={() =>
            void reset().then((ok) => {
              if (ok) input.current?.click();
            })
          }
        >
          <Plus size={18} /> New transcription
        </button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={20} />
            </span>
            <strong>
              Your machine.
              <br />
              Your words.
            </strong>
            <p>
              No cloud uploads.
              <br />
              No accounts. Just you.
            </p>
            <span className="local-card-tag">
              <span className="dot" /> PRIVATE BY DESIGN
            </span>
          </div>
          <button className="nav-item" onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontal size={17} /> Settings
          </button>
          <button className="nav-item" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={17} /> How it works{" "}
            <ArrowUpRight size={15} className="ml-auto" />
          </button>
          <div className="sidebar-footer">
            <span>CLIPSCRIBE / LOCAL</span>
            <PanelLeftClose size={14} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{file ? "Video to transcript" : "Overview"}</strong>
          </div>
          <div className="top-actions">
            <span className={`connection ${offline ? "disconnected" : ""}`}>
              <span className="dot" />
              {offline
                ? "Backend offline"
                : config
                  ? "Local engine connected"
                  : "Connecting to engine"}
            </span>
            <button
              className="icon-button mobile-settings"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SlidersHorizontal size={18} />
            </button>
            <span className="local-badge">
              <LockKeyhole size={12} /> LOCAL ONLY
            </span>
          </div>
        </header>
        <main id="workspace">
          {picker}
          {offline && (
            <div className="alert" role="status">
              <TriangleAlert size={18} />
              <div>
                <strong>Start your local engine</strong>
                <p>
                  Run FastAPI on 127.0.0.1:8001 using the README instructions.
                  Your selected video stays here.
                </p>
              </div>
              <button className="text-button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {config && (!config.ffmpeg || !config.speech_dependencies) && (
            <div className="alert" role="alert">
              <TriangleAlert size={18} />
              <span>
                {!config.ffmpeg
                  ? "FFmpeg or FFprobe is missing. Install FFmpeg, then restart the backend."
                  : "Speech dependencies are missing. Install backend/requirements.txt in your Python environment."}
              </span>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <AnimatePresence mode="wait">
            {!file ? (
              <motion.div
                key="landing"
                initial={{ opacity: 0, y: reduced ? 0 : 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="hero">
                  <div className="eyebrow">
                    <span className="mini-wave">
                      <AudioLines size={14} />
                    </span>{" "}
                    LESS TYPING. MORE CREATING.
                  </div>
                  <h1>
                    Turn Every Video
                    <br />
                    Into <span>Words.</span>
                    <svg
                      className="hero-spark"
                      viewBox="0 0 42 42"
                      aria-hidden="true"
                    >
                      <path d="M21 0v42M0 21h42M6 6l30 30M6 36 36 6" />
                    </svg>
                  </h1>
                  <p>
                    Your ideas, interviews, and conversations — transcribed.
                    <br className="desktop-break" /> Beautifully simple.
                    Completely on your machine.
                  </p>
                  <div className="hero-note">
                    <ShieldCheck size={15} /> Private by default <span>·</span>{" "}
                    Powered by local Whisper
                  </div>
                </div>
                <div className="section-heading">
                  <h2>Start with a video</h2>
                  <span>
                    01 <span className="muted">/ UPLOAD</span>
                  </span>
                </div>
                <div
                  className={`dropzone ${dragging ? "dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setDragging(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    if (e.dataTransfer.files.length !== 1) {
                      setError("Choose one video at a time.");
                      return;
                    }
                    void choose(e.dataTransfer.files[0]);
                  }}
                >
                  <span className="corner corner-tl" />
                  <span className="corner corner-tr" />
                  <span className="corner corner-bl" />
                  <span className="corner corner-br" />
                  <div className="upload-art" aria-hidden="true">
                    <span className="art-back" />
                    <span className="art-front">
                      <Film size={29} strokeWidth={1.3} />
                      <span>
                        <i />
                        <i />
                        <i />
                      </span>
                    </span>
                    <span className="art-plus">
                      <Plus size={15} />
                    </span>
                  </div>
                  <h3>
                    {dragging
                      ? "Drop it. We’ll take it from here."
                      : "Drop your video here"}
                  </h3>
                  <p>Give your video a voice on the page.</p>
                  <button
                    className="primary upload-button"
                    onClick={() => input.current?.click()}
                  >
                    <Upload size={16} /> Choose a video <ArrowRight size={17} />
                  </button>
                  <span className="file-guidance">
                    MP4, MOV, WebM, MKV & more <span>·</span>{" "}
                    {config
                      ? `Up to ${bytes(config.max_bytes)}`
                      : "Size limit shown when engine connects"}
                  </span>
                </div>
                <div className="privacy-line">
                  <LockKeyhole size={13} />
                  <span>
                    Your video never goes to a cloud transcription service.
                    Ever.
                  </span>
                </div>
                <div className="feature-grid">
                  <article>
                    <span className="feature-icon purple">
                      <AudioLines size={19} />
                    </span>
                    <h3>Real words. Real recognition.</h3>
                    <p>
                      Local Whisper turns speech into text, in the language it
                      was spoken.
                    </p>
                    <span className="feature-meta">
                      100 LANGUAGES SUPPORTED
                    </span>
                  </article>
                  <article>
                    <span className="feature-icon peach">
                      <Scissors size={19} />
                    </span>
                    <h3>Fine-tune every sentence.</h3>
                    <p>
                      Edit with your video in view. Click a timestamp to jump to
                      the moment.
                    </p>
                    <span className="feature-meta">
                      TIMESTAMP-SYNCED EDITOR
                    </span>
                  </article>
                  <article>
                    <span className="feature-icon lime">
                      <Captions size={19} />
                    </span>
                    <h3>Ready for what’s next.</h3>
                    <p>
                      From a clean transcript to timed subtitles. Take your
                      words anywhere.
                    </p>
                    <span className="feature-meta">
                      TXT <b>/</b> SRT <b>/</b> VTT <b>/</b> JSON
                    </span>
                  </article>
                </div>
                <div className="bottom-note">
                  <span>A little less busywork. A lot more possibility.</span>
                  <AudioLines size={18} />
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="editor"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="workspace-heading">
                  <div>
                    <div className="eyebrow">VIDEO TO TRANSCRIPT</div>
                    <h1>
                      Your words, in focus<span>.</span>
                    </h1>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void reset().then((ok) => {
                        if (ok) input.current?.click();
                      })
                    }
                  >
                    <Plus size={16} /> New transcription
                  </button>
                </div>
                <div className="workspace-grid">
                  <section
                    className="video-column"
                    aria-label="Video preview and transcription settings"
                  >
                    <div className="panel video-panel">
                      <div className="panel-heading">
                        <span>
                          <Film size={16} /> Source video
                        </span>
                        <span className="small-label">LOCAL PREVIEW</span>
                      </div>
                      <div className="video-stage">
                        <video
                          ref={video}
                          src={url}
                          controls
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(e) => {
                            const d = e.currentTarget.duration;
                            if (Number.isFinite(d)) setDuration(d);
                            e.currentTarget.playbackRate = Number(speed);
                          }}
                          onTimeUpdate={(e) =>
                            setTime(e.currentTarget.currentTime)
                          }
                          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
                          onPlay={() => setPlaying(true)}
                          onPause={() => setPlaying(false)}
                          onEnded={() => setPlaying(false)}
                          onError={() => setPreviewError(true)}
                        />
                      </div>
                      {previewError && (
                        <div className="preview-note">
                          <TriangleAlert size={15} /> Your browser cannot
                          preview this codec. FFmpeg may still transcribe it;
                          convert to H.264 MP4 for playback synchronization.
                        </div>
                      )}
                      <div className="video-controls">
                        <span className="mono">
                          {clock(time)} <span>/ {clock(duration)}</span>
                        </span>
                        <label>
                          Playback{" "}
                          <select
                            aria-label="Playback speed"
                            value={speed}
                            onChange={(e) => {
                              setSpeed(e.target.value);
                              if (video.current)
                                video.current.playbackRate = Number(
                                  e.target.value,
                                );
                            }}
                          >
                            {["0.5", "0.75", "1", "1.25", "1.5", "2"].map(
                              (n) => (
                                <option key={n} value={n}>
                                  {n}×
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      </div>
                      <div className="file-row">
                        <span className="file-icon">
                          <Film size={19} />
                        </span>
                        <div>
                          <strong title={file.name}>{file.name}</strong>
                          <p>
                            {bytes(file.size)} <span>·</span>{" "}
                            {file.name.split(".").pop()?.toUpperCase()}{" "}
                            <span>·</span>{" "}
                            {duration ? clock(duration) : "Duration pending"}
                          </p>
                        </div>
                        <button
                          className="icon-button"
                          disabled={busy}
                          onClick={() => void reset()}
                          aria-label="Remove video"
                        >
                          <X size={17} />
                        </button>
                      </div>
                    </div>
                    <div className="panel setup-panel">
                      <div className="panel-heading">
                        <span>
                          <SlidersHorizontal size={16} /> Transcription setup
                        </span>
                        <button
                          className="icon-button"
                          aria-label="All settings"
                          onClick={() => setSettingsOpen(true)}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <div className="setup-body">
                        <label className="field-label">
                          WHISPER MODEL{" "}
                          <span>
                            {settings.model === "base"
                              ? "RECOMMENDED"
                              : settings.device.toUpperCase()}
                          </span>
                        </label>
                        <div className="model-tabs">
                          {models.map((m) => (
                            <button
                              key={m.id}
                              disabled={busy}
                              aria-pressed={settings.model === m.id}
                              className={
                                settings.model === m.id ? "selected" : ""
                              }
                              onClick={() => preference("model", m.id)}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                        <div className="model-caption">
                          <Cpu size={13} />
                          <span>
                            {models.find((m) => m.id === settings.model)?.note}{" "}
                            ·{" "}
                            {modelState?.status === "installed"
                              ? "Cached on this computer"
                              : modelState?.status === "downloading"
                                ? "Downloading model…"
                                : "Model installation needed"}
                          </span>
                        </div>
                        <label
                          className="field-label"
                          htmlFor="workspace-language"
                        >
                          SPOKEN LANGUAGE
                        </label>
                        <select
                          id="workspace-language"
                          className="full-select"
                          disabled={busy}
                          value={settings.language}
                          onChange={(e) =>
                            preference("language", e.target.value)
                          }
                        >
                          <option value="auto">Detect automatically</option>
                          {config?.languages.map((l) => (
                            <option key={l} value={l}>
                              {languageName(l)}
                            </option>
                          ))}
                        </select>
                        <p className="setup-note">
                          Speech stays in its original language. Accuracy varies
                          with audio quality, language and model size.
                        </p>
                        {busy ? (
                          <button
                            className="secondary full-width"
                            onClick={() => void cancel()}
                          >
                            <X size={16} /> Cancel{" "}
                            {uploading ? "upload" : "transcription"}
                          </button>
                        ) : (
                          <button
                            className="primary full-width"
                            disabled={
                              !config ||
                              offline ||
                              !config.ffmpeg ||
                              !config.speech_dependencies ||
                              segments.length > 0
                            }
                            onClick={() => void transcribe()}
                          >
                            {segments.length ? (
                              <>
                                <CheckCheck size={17} /> Transcription complete
                              </>
                            ) : modelState?.status === "installed" ? (
                              <>
                                <AudioLines size={17} />{" "}
                                {job?.status === "failed" ||
                                job?.status === "cancelled"
                                  ? "Retry transcription"
                                  : "Transcribe video"}
                                <ArrowRight size={17} />
                              </>
                            ) : (
                              <>
                                <Download size={17} /> Set up local model
                                <ArrowRight size={17} />
                              </>
                            )}
                          </button>
                        )}
                        <span className="setup-footer">
                          <LockKeyhole size={11} /> Processed here. Not in the
                          cloud.
                        </span>
                      </div>
                    </div>
                  </section>
                  <section
                    className="panel transcript-panel"
                    aria-label="Transcript editor"
                  >
                    <div className="panel-heading">
                      <span>
                        <FileText size={17} /> Transcript{" "}
                        {segments.length > 0 && (
                          <span className="edited-badge">
                            {edited ? "EDITED" : "READY"}
                          </span>
                        )}
                      </span>
                      <span className="small-label">
                        {job?.result
                          ? languageName(job.result.language)
                          : "YOUR WORDS, RIGHT HERE"}
                      </span>
                    </div>
                    {segments.length > 0 ? (
                      <>
                        <div className="transcript-toolbar">
                          <label className="search">
                            <Search size={16} />
                            <input
                              aria-label="Search transcript"
                              placeholder="Find in transcript…"
                              value={query}
                              onChange={(e) => setQuery(e.target.value)}
                            />
                            {query && (
                              <button
                                className="icon-button"
                                aria-label="Clear search"
                                onClick={() => setQuery("")}
                              >
                                <X size={13} />
                              </button>
                            )}
                          </label>
                          <button
                            className="icon-button"
                            title="Copy complete transcript"
                            aria-label="Copy complete transcript"
                            onClick={() => void copy(fullText(segments))}
                          >
                            <Copy size={17} />
                          </button>
                          <button
                            className="icon-button"
                            title="Copy selected text"
                            aria-label="Copy selected text"
                            disabled={!selected}
                            onClick={() => void copy(selected)}
                          >
                            <CheckCheck size={17} />
                          </button>
                        </div>
                        <div className="transcript-subbar">
                          <span>
                            {query
                              ? `${matching.length} matching segments`
                              : "Click a timestamp to seek · Text is editable"}
                          </span>
                          <label>
                            <input
                              type="checkbox"
                              checked={follow}
                              onChange={(e) => setFollow(e.target.checked)}
                            />{" "}
                            Follow video
                          </label>
                        </div>
                        <div className="segments">
                          {matching.length ? (
                            matching.map((s) => (
                              <div
                                id={`segment-${s.id}`}
                                key={s.id}
                                className={`segment ${active === s.id ? "active" : ""}`}
                                data-active={active === s.id}
                              >
                                <button
                                  className="timestamp"
                                  disabled={previewError}
                                  aria-label={`Seek to ${clock(s.start)}`}
                                  onClick={() => seek(s.start)}
                                >
                                  <span className="segment-indicator" />
                                  {clock(s.start)}
                                </button>
                                <textarea
                                  aria-label={`Segment ${s.id + 1}`}
                                  rows={Math.max(
                                    2,
                                    Math.ceil(s.text.length / 55),
                                  )}
                                  value={s.text}
                                  onSelect={(e) => {
                                    const el = e.currentTarget;
                                    setSelected(
                                      el.value.slice(
                                        el.selectionStart,
                                        el.selectionEnd,
                                      ),
                                    );
                                  }}
                                  onChange={(e) => {
                                    setSegments((previous) =>
                                      previous.map((item) =>
                                        item.id === s.id
                                          ? { ...item, text: e.target.value }
                                          : item,
                                      ),
                                    );
                                    setEdited(true);
                                    setSelected("");
                                  }}
                                />
                              </div>
                            ))
                          ) : (
                            <div className="no-results">
                              <Search size={22} />
                              <h3>No matching words</h3>
                              <p>Try a different word or clear your search.</p>
                              <button
                                className="text-button"
                                onClick={() => setQuery("")}
                              >
                                Clear search
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="transcript-stats">
                          <span>
                            {words} words <b>·</b> {segments.length} segments{" "}
                            <b>·</b> {clock(duration)}
                          </span>
                          <span>
                            <Check size={12} />{" "}
                            {edited ? "Edits in this tab" : "Local result"}
                          </span>
                        </div>
                        <div className="export-row">
                          <label className="export-select">
                            <FileText size={15} />
                            <select
                              aria-label="Export format"
                              value={settings.format}
                              onChange={(e) =>
                                preference("format", e.target.value as Format)
                              }
                            >
                              <option value="txt">Plain text (.txt)</option>
                              <option value="srt">SubRip (.srt)</option>
                              <option value="vtt">WebVTT (.vtt)</option>
                              <option value="json">Structured JSON</option>
                            </select>
                          </label>
                          <button
                            className="primary"
                            onClick={() => exportAs(settings.format)}
                          >
                            <Download size={16} /> Download
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </>
                    ) : busy ? (
                      <div className="processing">
                        <div className="processing-orbit">
                          <AudioLines size={33} />
                          <span />
                        </div>
                        <span className="eyebrow">ON YOUR MACHINE</span>
                        <h2>
                          {uploading
                            ? "Preparing your video"
                            : job?.stage === "Queued"
                              ? "You’re in the local queue"
                              : "Finding the words"}
                        </h2>
                        <p>
                          {uploading
                            ? "Sending your video to your local backend."
                            : job?.stage === "Queued"
                              ? "Another local job is running. Yours will start next."
                              : "Local recognition takes time. Your workspace stays responsive."}
                        </p>
                        {uploading ? (
                          <div className="upload-progress">
                            <progress
                              max="100"
                              value={uploadPercent ?? undefined}
                            />
                            <span>
                              {uploadPercent === null
                                ? "Uploading…"
                                : `${uploadPercent}% transferred to localhost`}
                            </span>
                          </div>
                        ) : (
                          <ol className="stage-list">
                            {stages.map((s, i) => {
                              const index = stages.indexOf(job?.stage || "");
                              return (
                                <li
                                  key={s}
                                  className={
                                    i === index
                                      ? "current"
                                      : i < index
                                        ? "done"
                                        : ""
                                  }
                                >
                                  {i < index ? (
                                    <Check size={15} />
                                  ) : i === index ? (
                                    <LoaderCircle className="spin" size={15} />
                                  ) : (
                                    <span className="stage-dot" />
                                  )}
                                  {s}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                        {job?.processed_seconds !== undefined && (
                          <span className="processed">
                            Recognized through {clock(job.processed_seconds)} of{" "}
                            {clock(duration)} — not an ETA
                          </span>
                        )}
                        <p className="processing-foot">
                          You can preview your video while we work.
                        </p>
                      </div>
                    ) : (
                      <div className="empty-transcript">
                        <div className="empty-lines">
                          <FileText size={34} strokeWidth={1} />
                          <span />
                          <span />
                          <span />
                        </div>
                        <span className="eyebrow">A BLANK PAGE, FOR NOW</span>
                        <h2>
                          {job?.status === "cancelled"
                            ? "Paused before the words."
                            : job?.status === "failed"
                              ? "Let’s try that again."
                              : "Your story starts here."}
                        </h2>
                        <p>
                          {job?.status === "failed"
                            ? "Check the error above, adjust your settings, and retry."
                            : job?.status === "cancelled"
                              ? "Your video is still here. Restart whenever you’re ready."
                              : "Choose your model and hit transcribe. Your timestamped, editable transcript will appear here."}
                        </p>
                        <div className="empty-pills">
                          <span>
                            <AudioLines size={12} /> Recognize
                          </span>
                          <ChevronRight size={12} />
                          <span>
                            <Scissors size={12} /> Refine
                          </span>
                          <ChevronRight size={12} />
                          <span>
                            <Download size={12} /> Export
                          </span>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
                <div className="workspace-footer">
                  <ShieldCheck size={13} />
                  <span>
                    {job?.media_deleted
                      ? "Temporary backend media deleted. Your browser preview and transcript remain in this tab."
                      : segments.length
                        ? "Backend media retained for up to 15 minutes. New transcription deletes it now."
                        : "Local files. Local model. No cloud transcription."}{" "}
                    {segments.length > 0 &&
                      "Download before leaving; edits are not saved to disk."}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
        <footer className="page-footer">
          <span>Made for your words. Built for your privacy.</span>
          <span>
            <span className="dot" /> NO API KEYS. NO SUBSCRIPTIONS.
          </span>
        </footer>
      </div>
      <dialog
        ref={modal}
        className="settings-modal"
        onCancel={() => {
          setSettingsOpen(false);
          setHelpOpen(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setSettingsOpen(false);
            setHelpOpen(false);
          }
        }}
        aria-labelledby="modal-title"
      >
        <div className="modal-inner">
          <div className="modal-heading">
            <span className="feature-icon lime">
              {helpOpen ? (
                <CircleHelp size={21} />
              ) : (
                <SlidersHorizontal size={21} />
              )}
            </span>
            <button
              className="icon-button"
              aria-label="Close dialog"
              onClick={() => {
                setSettingsOpen(false);
                setHelpOpen(false);
              }}
            >
              <X size={20} />
            </button>
          </div>
          <h2 id="modal-title">
            {helpOpen
              ? "A simpler way to transcribe."
              : "Make yourself at home."}
          </h2>
          <p className="modal-intro">
            {helpOpen
              ? "One video. A local engine. All your words."
              : "Your preferences stay in this browser. Your media stays on this machine."}
          </p>
          {helpOpen ? (
            <div className="help-body">
              <article>
                <span>01</span>
                <div>
                  <h3>Bring your video</h3>
                  <p>
                    Choose a video with speech. Preview it without loading the
                    whole file into JavaScript memory. Browser codec support
                    varies.
                  </p>
                </div>
              </article>
              <article>
                <span>02</span>
                <div>
                  <h3>Install once. Transcribe locally.</h3>
                  <p>
                    Start FastAPI and Vite as described in the README. In
                    Settings, install a Whisper model. Only this installation
                    contacts the model host. Cached models work without an
                    internet connection.
                  </p>
                </div>
              </article>
              <article>
                <span>03</span>
                <div>
                  <h3>Listen, edit, take it with you</h3>
                  <p>
                    Click timestamps to seek. Correct text without changing its
                    timing. Export TXT, SRT, VTT or JSON. Download before
                    closing the tab; transcripts are not saved permanently.
                  </p>
                </div>
              </article>
              <div className="guidance">
                <ShieldCheck size={18} />
                <p>
                  No accounts, paid APIs, cloud storage or analytics. Backend
                  media is deleted after processing by default; results expire
                  after one hour. Keep the servers bound to localhost.
                </p>
              </div>
            </div>
          ) : (
            <div className="settings-fields">
              <label className="field-label">LOCAL WHISPER MODEL</label>
              <div className="model-choices">
                {models.map((m) => (
                  <button
                    key={m.id}
                    className={settings.model === m.id ? "chosen" : ""}
                    disabled={busy}
                    onClick={() => preference("model", m.id)}
                  >
                    <span>
                      {m.label}
                      {m.id === "base" && <small>DEFAULT</small>}
                    </span>
                    <p>{m.note}</p>
                    {settings.model === m.id && <Check size={15} />}
                  </button>
                ))}
              </div>
              <div className="model-install">
                <div>
                  <HardDrive size={17} />
                  <span>
                    {settings.model.toUpperCase()}{" "}
                    <strong>
                      {modelState?.status === "installed"
                        ? "Installed locally"
                        : modelState?.status === "downloading"
                          ? "Downloading weights…"
                          : modelState?.status === "failed"
                            ? "Installation failed"
                            : "Not installed yet"}
                    </strong>
                  </span>
                </div>
                {modelState?.status !== "installed" && (
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      installing ||
                      offline ||
                      !config ||
                      Object.values(config.models).some(
                        (m) => m.status === "downloading",
                      )
                    }
                    onClick={() => void installModel()}
                  >
                    {modelState?.status === "downloading" ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Download size={14} />
                    )}{" "}
                    {modelState?.status === "failed"
                      ? "Retry"
                      : "Install model"}
                  </button>
                )}
              </div>
              {modelState?.error && (
                <p className="inline-error" role="alert">
                  {modelState.error}
                </p>
              )}
              <p className="hint">
                Installation downloads model weights from Hugging Face and needs
                internet. No video is sent. After installation, transcription
                uses local files only. Larger models require more disk space,
                memory and time.
              </p>
              <div className="settings-pair">
                <label>
                  Spoken language
                  <select
                    disabled={busy}
                    value={settings.language}
                    onChange={(e) => preference("language", e.target.value)}
                  >
                    <option value="auto">Detect automatically</option>
                    {config?.languages.map((l) => (
                      <option key={l} value={l}>
                        {languageName(l)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Processing device
                  <select
                    disabled={busy}
                    value={settings.device}
                    onChange={(e) =>
                      preference("device", e.target.value as Settings["device"])
                    }
                  >
                    <option value="cpu">CPU · compatible default</option>
                    <option value="cuda" disabled={!config?.cuda}>
                      NVIDIA CUDA{!config?.cuda ? " · unavailable" : ""}
                    </option>
                  </select>
                </label>
              </div>
              <div className="guidance">
                <Cpu size={18} />
                <p>
                  Start with Base on CPU. Try Tiny for less memory and faster
                  results. CUDA requires a supported NVIDIA GPU plus compatible
                  CUDA/cuDNN libraries. Apple Metal is not supported.
                </p>
              </div>
              <label className="settings-label">
                Temporary media cleanup
                <select
                  disabled={busy}
                  value={settings.cleanup}
                  onChange={(e) =>
                    preference("cleanup", e.target.value as Settings["cleanup"])
                  }
                >
                  <option value="immediate">
                    Immediately after processing (recommended)
                  </option>
                  <option value="15min">
                    Keep for up to 15 minutes after success
                  </option>
                </select>
              </label>
              <p className="hint">
                Failures and cancellations always delete media. Restarting the
                backend clears stale media. In-memory job results expire after
                one hour.
              </p>
              <label className="settings-label">
                Default export
                <select
                  value={settings.format}
                  onChange={(e) =>
                    preference("format", e.target.value as Format)
                  }
                >
                  {(["txt", "srt", "vtt", "json"] as Format[]).map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary full-width"
                onClick={() => setSettingsOpen(false)}
              >
                Done <Check size={16} />
              </button>
            </div>
          )}
        </div>
      </dialog>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={16} />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
