"""Isolated, killable job process. No network during transcription.

Stdout is a JSON-line protocol; diagnostic details remain on local stderr.
An independent process bounds memory lifetime and permits cancellation even
while the native inference library is busy. Model weights are cached on disk.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

MODELS = ("tiny", "base", "small", "medium")
SAFE_DEMUXERS = "mov,matroska,webm,avi,mpeg,mpegts,asf,flv,ogg"


def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def probe(path, max_duration):
    try:
        result = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", SAFE_DEMUXERS, "-show_format", "-show_streams", "-of", "json", str(path)], capture_output=True, timeout=45)
    except FileNotFoundError:
        raise ValueError("FFprobe is missing. Install FFmpeg, then restart the backend.")
    if result.returncode:
        raise ValueError("This video is corrupted or unreadable. Try re-exporting it as MP4 with AAC audio.")
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    if not any(s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic") for s in streams):
        raise ValueError("No video stream found. Choose a video file, not an audio-only file.")
    if not any(s.get("codec_type") == "audio" for s in streams):
        raise ValueError("This video has no audio stream. Choose a video containing speech.")
    duration = float(data.get("format", {}).get("duration", 0))
    if not 0 < duration <= max_duration:
        raise ValueError(f"Video duration is missing or exceeds the {max_duration // 60}-minute limit.")
    return duration


def extract(path, output, max_duration):
    # Normalize the container timeline, preserving delayed audio as silence.
    # Disable non-file protocols so crafted media cannot fetch remote resources.
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-format_whitelist", SAFE_DEMUXERS,
        "-copyts", "-start_at_zero", "-i", str(path), "-map", "0:a:0", "-vn",
        "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", "16000",
        "-t", str(max_duration), "-c:a", "pcm_s16le", "-y", str(output)
    ], capture_output=True, timeout=600)
    if result.returncode:
        raise ValueError("FFmpeg could not decode the audio. Re-export the video with a standard AAC or PCM audio track.")


def run_job(config):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    path = Path(config["media"])
    emit(stage="Preparing video")
    duration = probe(path, config["max_duration"])
    emit(duration=duration)
    emit(stage="Extracting audio")
    audio = path.parent / "audio.wav"
    extract(path, audio, config["max_duration"])
    emit(stage="Loading transcription model")
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(config["model_path"], device=config["device"], compute_type="int8" if config["device"] == "cpu" else "float16", cpu_threads=config["threads"], local_files_only=True)
    except ImportError:
        raise ValueError("Python speech dependencies are missing. Install backend/requirements.txt in the backend virtual environment.")
    except Exception as error:
        print(repr(error), file=sys.stderr)
        raise ValueError("The local model could not load. Check available memory, select CPU, or reinstall the model. Try tiny on low-memory computers.")
    emit(stage="Transcribing audio")
    try:
        segments, info = model.transcribe(str(audio), language=config["language"], task="transcribe", beam_size=5, vad_filter=True, condition_on_previous_text=False)
        result = []
        for segment in segments:
            text = segment.text.strip()
            start = max(0.0, min(float(segment.start), duration))
            end = max(start, min(float(segment.end), duration))
            if text and end > start:
                result.append({"id": len(result), "start": start, "end": end, "text": text})
                emit(processed_seconds=end)
    except MemoryError:
        raise
    except Exception as error:
        print(repr(error), file=sys.stderr)
        raise ValueError("Local transcription failed. Try the tiny model on CPU and check available memory and audio quality.")
    if not result:
        raise ValueError("No intelligible speech was detected. Check the audio or try a different language/model.")
    emit(stage="Preparing transcript")
    emit(result={"segments": result, "language": info.language, "language_probability": info.language_probability, "duration": duration, "model": config["model"], "text": "\n".join(s["text"] for s in result)})


def install(model, cache):
    from faster_whisper.utils import download_model
    destination = Path(cache) / model
    destination.mkdir(parents=True, exist_ok=True)
    download_model(model, output_dir=str(destination))
    (destination / ".complete").write_text("installed\n")


if __name__ == "__main__":
    try:
        if sys.argv[1] == "install":
            if sys.argv[2] not in MODELS:
                raise ValueError("Unsupported model")
            install(sys.argv[2], sys.argv[3])
        else:
            run_job(json.loads(Path(sys.argv[2]).read_text()))
    except MemoryError:
        emit(error="Not enough memory. Close other applications or choose tiny on CPU.")
        sys.exit(1)
    except Exception as error:
        print(repr(error), file=sys.stderr)
        emit(error=str(error) if isinstance(error, ValueError) else "Processing failed. Check FFmpeg and Python dependencies, then retry with a smaller video.")
        sys.exit(1)