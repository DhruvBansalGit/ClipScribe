export type Model = "tiny" | "base" | "small" | "medium";
export type Format = "txt" | "srt" | "vtt" | "json";
export type Segment = { id: number; start: number; end: number; text: string };
export type Settings = {
  model: Model;
  language: string;
  device: "cpu" | "cuda";
  cleanup: "immediate" | "15min";
  format: Format;
};
export type Config = {
  token: string;
  max_bytes: number;
  max_duration: number;
  ffmpeg: boolean;
  speech_dependencies: boolean;
  cuda: boolean;
  languages: string[];
  extensions: string[];
  models: Record<Model, { status: string; error?: string }>;
};
export type Result = {
  segments: Segment[];
  language: string;
  language_probability: number;
  duration: number;
  model: Model;
  text: string;
};
export type Job = {
  id: string;
  filename: string;
  status: string;
  stage: string;
  duration?: number;
  processed_seconds?: number;
  error?: string;
  media_deleted: boolean;
  result?: Result;
};
