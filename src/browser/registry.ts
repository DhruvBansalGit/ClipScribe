// Pinned public ONNX model revisions, verified against Hugging Face metadata.
// Native faster-whisper model files are not compatible with browser inference.
export const BROWSER_MODE =
  !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ||
  new URLSearchParams(location.search).get("engine") === "browser";
export const BROWSER_MODELS = {
  tiny: {
    repo: "Xenova/whisper-tiny",
    revision: "5332fcc35e32a33b86612b9a57a89be7906102b1",
  },
  base: {
    repo: "Xenova/whisper-base",
    revision: "64da57285918e20ea79ea5c88eed7197933abaa8",
  },
  small: {
    repo: "Xenova/whisper-small",
    revision: "2d67713f236afa48a18992566e7647f6ca848e13",
  },
  medium: {
    repo: "Xenova/whisper-medium",
    revision: "8c5b90880ab9f79487ab33613413431bf661d595",
  },
} as const;
export type BrowserModel = keyof typeof BROWSER_MODELS;
export const MODEL_CACHE_PREFIX = "clipscribe-onnx-v1-";
export const MEDIA_CACHE = "clipscribe-media-v1";
// No application-level file size or recording duration ceiling. Only the
// currently processed PCM window is bounded; browser/hardware limits remain.
export const AUDIO_WINDOW_SECONDS = 30;
export const RUNTIME_ROOT = "/runtime/browser-v1";
// Language codes from the pinned multilingual generation_config.json files.
export const LANGUAGES =
  "af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu haw ha he hi hr ht hu hy id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo zh".split(
    " ",
  );
export const EXTENSIONS = [
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
];
export function isBrowserModel(value: string): value is BrowserModel {
  return Object.prototype.hasOwnProperty.call(BROWSER_MODELS, value);
}
