export type Model = "tiny" | "base" | "small" | "medium";
export type Format = "txt" | "srt" | "vtt" | "json";
export type Segment = {
  id: number;
  start: number | null;
  end: number | null;
  text: string;
  language?: string;
  language_probability?: number;
};
export type Settings = {
  model: Model;
  language: string;
  device: "cpu" | "cuda";
  cleanup: "immediate" | "15min";
  format: Format;
};
export type Config = {
  token: string;
  max_bytes: number | null;
  max_duration: number | null;
  ffmpeg: boolean;
  speech_dependencies: boolean;
  cuda: boolean;
  languages: string[];
  extensions: string[];
  models: Record<
    Model,
    {
      status: string;
      error?: string;
      file?: string;
      loaded?: number;
      total?: number;
    }
  >;
};
export type Result = {
  segments: Segment[];
  language: string | null;
  language_probability: number | null;
  duration: number;
  model: Model;
  text: string;
  partial?: boolean;
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
