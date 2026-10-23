"""ClipScribe localhost API. Single uvicorn worker; no database or cloud service."""
import asyncio
from contextlib import asynccontextmanager
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import unquote
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("CLIPSCRIBE_MODEL_DIR", Path.home() / ".cache/clipscribe/models")).resolve()
TEMP_ROOT = Path(os.environ.get("CLIPSCRIBE_TEMP_DIR", Path(tempfile.gettempdir()) / "clipscribe-local")).resolve()
MAX_BYTES = int(os.environ.get("CLIPSCRIBE_MAX_MB", "1024")) * 1024 * 1024
MAX_DURATION = int(os.environ.get("CLIPSCRIBE_MAX_MINUTES", "120")) * 60
JOB_TIMEOUT = int(os.environ.get("CLIPSCRIBE_JOB_TIMEOUT", "14400"))
RESULT_TTL = 3600
MODELS = ("tiny", "base", "small", "medium")
EXTENSIONS = {"mp4", "mov", "webm", "mkv", "avi", "m4v", "mpeg", "mpg", "mts", "m2ts", "ts", "3gp", "ogv", "wmv", "flv"}
ORIGINS = [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5175, 4175, 8001)]
TOKEN = secrets.token_urlsafe(32)  # local CSRF defense, not a cloud API credential
LOCK = threading.RLock()
JOBS = {}
INSTALLS = {}
PROCESSES = {}
POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="clipscribe")
STOP = threading.Event()


def installed(model):
    directory = CACHE / model
    return all((directory / name).is_file() for name in (".complete", "model.bin", "config.json", "tokenizer.json"))


def speech_ready():
    try:
        import faster_whisper
        return True
    except (ImportError, OSError):
        return False


def languages():
    try:
        from faster_whisper.tokenizer import _LANGUAGE_CODES
        return list(_LANGUAGE_CODES)
    except (ImportError, OSError):
        return ["en"]


def acceleration():
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def update(job_id, **values):
    with LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(values)


def terminate(process):
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
    except (ProcessLookupError, OSError, subprocess.TimeoutExpired):
        process.kill()


def clean(job):
    # Paths originate only from mkdtemp, never from browser input.
    shutil.rmtree(job["directory"], ignore_errors=True)
    job["media_deleted"] = not Path(job["directory"]).exists()


def public(job):
    return {k: v for k, v in job.items() if k not in {"directory", "request_id", "config", "created", "finished"}}


def work(job_id):
    with LOCK:
        job = JOBS.get(job_id)
        if job is None:  # A queued, cancelled job may already have been discarded.
            return
        if job["status"] == "cancelled":
            clean(job)
            return
        job.update(status="processing", stage="Preparing video", started=time.time())
    process = None
    try:
        config_path = Path(job["directory"]) / "config.json"
        config_path.write_text(json.dumps(job["config"]))
        with open(Path(job["directory"]) / "worker.log", "w") as log:
            with LOCK:
                if job["status"] == "cancelled":
                    return
                process = subprocess.Popen([sys.executable, str(ROOT / "worker.py"), "transcribe", str(config_path)], stdout=subprocess.PIPE, stderr=log, text=True, start_new_session=os.name == "posix")
                PROCESSES[job_id] = process
            result = None
            failure = None
            for line in process.stdout:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                with LOCK:
                    if job["status"] in {"cancelled", "failed"}:
                        break
                    for key in ("stage", "duration", "processed_seconds"):
                        if key in event:
                            job[key] = event[key]
                    if "error" in event:
                        failure = event["error"]
                    if "result" in event:
                        result = event["result"]
            code = process.wait()
            with LOCK:
                if job["status"] not in {"cancelled", "failed"}:
                    if code == 0 and result:
                        job.update(status="completed", stage="Completed", result=result)
                    else:
                        job.update(status="failed", stage="Failed", error=failure or "Worker stopped unexpectedly, possibly due to memory pressure. Try tiny on CPU.")
    except Exception:
        update(job_id, status="failed", stage="Failed", error="The local worker could not start. Check Python dependencies and available disk space.")
    finally:
        if process and process.poll() is None:
            terminate(process)
        with LOCK:
            PROCESSES.pop(job_id, None)
            job["finished"] = time.time()
            if job["status"] != "completed" or job["cleanup"] == "immediate":
                clean(job)


def install_work(model):
    process = None
    try:
        CACHE.mkdir(parents=True, exist_ok=True)
        with LOCK:
            process = subprocess.Popen([sys.executable, str(ROOT / "worker.py"), "install", model, str(CACHE)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=os.name == "posix")
            PROCESSES["model:" + model] = process
        code = process.wait(timeout=7200)
        with LOCK:
            INSTALLS[model] = {"status": "installed"} if code == 0 and installed(model) else {"status": "failed", "error": "Model download failed. Check your internet connection and free disk space, then retry. No media was sent."}
    except Exception:
        if process:
            terminate(process)
        with LOCK:
            INSTALLS[model] = {"status": "failed", "error": "Model installation could not finish. Check dependencies, connection and disk space; retry installation."}
    finally:
        with LOCK:
            PROCESSES.pop("model:" + model, None)


def janitor():
    while not STOP.wait(2):
        with LOCK:
            now = time.time()
            for job_id, job in list(JOBS.items()):
                if job["status"] == "processing" and now - job.get("started", now) > JOB_TIMEOUT:
                    job.update(status="failed", stage="Failed", error="Processing exceeded the configured time limit. Try a shorter video or smaller model.")
                    if job_id in PROCESSES:
                        terminate(PROCESSES[job_id])
                if job.get("finished") and now - job["finished"] > 900:
                    clean(job)
                if job.get("finished") and now - job["finished"] > RESULT_TTL:
                    clean(job)
                    JOBS.pop(job_id)


@asynccontextmanager
async def lifespan(app):
    TEMP_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Previous process media cannot be resumed; remove after a clean restart.
    for directory in TEMP_ROOT.glob("job-*"):
        if directory.is_dir() and not directory.is_symlink():
            shutil.rmtree(directory, ignore_errors=True)
    STOP.clear()
    threading.Thread(target=janitor, daemon=True).start()
    yield
    STOP.set()
    with LOCK:
        for process in list(PROCESSES.values()):
            terminate(process)
    POOL.shutdown(wait=True, cancel_futures=True)
    with LOCK:
        for job in JOBS.values():
            clean(job)


app = FastAPI(title="ClipScribe Local", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-ClipScribe-Token", "X-Filename", "X-Request-ID"])


@app.middleware("http")
async def local_boundary(request: Request, call_next):
    from starlette.responses import JSONResponse
    origin = request.headers.get("origin")
    if origin and origin not in ORIGINS:
        return JSONResponse({"detail": "Only the local ClipScribe frontend may access this API."}, status_code=403)
    if request.method in {"POST", "DELETE"} and not secrets.compare_digest(request.headers.get("x-clipscribe-token", ""), TOKEN):
        return JSONResponse({"detail": "Local session expired. Refresh ClipScribe and try again."}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/config")
def config():
    with LOCK:
        models = {model: {"status": "installed" if installed(model) else "not_installed", **INSTALLS.get(model, {})} for model in MODELS}
    return {"token": TOKEN, "max_bytes": MAX_BYTES, "max_duration": MAX_DURATION, "models": models, "ffmpeg": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")), "speech_dependencies": speech_ready(), "cuda": acceleration(), "languages": languages(), "extensions": sorted(EXTENSIONS)}


@app.post("/api/models/{model}/install", status_code=202)
def install_model(model: str):
    if model not in MODELS:
        raise HTTPException(400, "Choose tiny, base, small or medium.")
    if not speech_ready():
        raise HTTPException(503, "Install the backend Python requirements, then restart the server.")
    with LOCK:
        if installed(model):
            return {"status": "installed"}
        if any(value.get("status") == "downloading" for value in INSTALLS.values()):
            raise HTTPException(409, "Another model download is running. Wait for it to finish.")
        if any(job["status"] in {"uploading", "queued", "processing"} for job in JOBS.values()):
            raise HTTPException(409, "Wait for the current transcription before installing a model.")
        INSTALLS[model] = {"status": "downloading"}
        threading.Thread(target=install_work, args=(model,), daemon=True).start()
    return {"status": "downloading"}


@app.post("/api/jobs", status_code=202)
async def upload(request: Request, model: str = "base", language: str = "auto", device: str = "cpu", cleanup: str = "immediate"):
    if model not in MODELS or device not in {"cpu", "cuda"} or cleanup not in {"immediate", "15min"}:
        raise HTTPException(400, "Invalid transcription settings.")
    if language != "auto" and language not in languages():
        raise HTTPException(400, "Choose a supported Whisper language.")
    if device == "cuda" and not acceleration():
        raise HTTPException(400, "CUDA is not available. Choose CPU; Apple Metal is not supported by this backend.")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise HTTPException(503, "FFmpeg/FFprobe is missing. Install FFmpeg and restart the backend.")
    if not speech_ready():
        raise HTTPException(503, "Python speech dependencies could not load. Install backend/requirements.txt in this backend's Python environment, then restart.")
    if not installed(model):
        raise HTTPException(409, "Install this model from Settings before transcribing. Installation needs internet; transcription does not.")
    filename = unquote(request.headers.get("x-filename", "video.mp4"))
    filename = filename.replace("\\", "/").split("/")[-1][:200]
    extension = filename.rsplit(".", 1)[-1].lower()
    if extension not in EXTENSIONS:
        raise HTTPException(415, "Unsupported extension. Try MP4, MOV, WebM, MKV or another listed video format.")
    try:
        length = int(request.headers.get("content-length", "0"))
    except ValueError:
        raise HTTPException(400, "Invalid upload size.")
    if length > MAX_BYTES:
        raise HTTPException(413, f"Video exceeds the {MAX_BYTES // 1024 // 1024} MB upload limit.")
    request_id = request.headers.get("x-request-id", "")
    if not 8 <= len(request_id) <= 100:
        raise HTTPException(400, "A valid upload request ID is required.")
    with LOCK:
        previous = next((j for j in JOBS.values() if j["request_id"] == request_id), None)
        if previous:
            return public(previous)
        if any(value.get("status") == "downloading" for value in INSTALLS.values()):
            raise HTTPException(409, "Wait for the model installation to finish before transcribing.")
        if sum(j["status"] in {"uploading", "queued", "processing"} for j in JOBS.values()) >= 3 or len(JOBS) >= 100:
            raise HTTPException(429, "The local queue is full. Wait for a job to finish or remove old jobs.")
        directory = Path(tempfile.mkdtemp(prefix="job-", dir=TEMP_ROOT))
        media = directory / ("media." + extension)
        job_id = uuid.uuid4().hex
        job = {"id": job_id, "request_id": request_id, "filename": filename, "status": "uploading", "stage": "Preparing video", "created": time.time(), "directory": str(directory), "cleanup": cleanup, "media_deleted": False}
        JOBS[job_id] = job
    try:
        received = 0
        async with asyncio.timeout(1800):
            with media.open("wb") as output:
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > MAX_BYTES:
                        raise HTTPException(413, "Upload exceeded the configured size limit.")
                    await asyncio.to_thread(output.write, chunk)
        if not received:
            raise HTTPException(400, "The selected file is empty.")
        job["config"] = {"media": str(media), "model": model, "model_path": str(CACHE / model), "language": None if language == "auto" else language, "device": device, "threads": max(1, min(8, (os.cpu_count() or 2) // 2)), "max_duration": MAX_DURATION}
        update(job_id, status="queued", stage="Queued", size=received)
        POOL.submit(work, job_id)
        return public(job)
    except BaseException as error:
        with LOCK:
            clean(job)
            JOBS.pop(job_id, None)
        if isinstance(error, HTTPException):
            raise
        if isinstance(error, asyncio.CancelledError):
            raise
        raise HTTPException(400, "Upload interrupted or could not be saved. Check available disk space and retry.")


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    with LOCK:
        if job_id not in JOBS:
            raise HTTPException(404, "Job expired or the backend restarted. Start a new transcription.")
        return public(JOBS[job_id])


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    with LOCK:
        if job_id not in JOBS:
            raise HTTPException(404, "Job no longer exists.")
        job = JOBS[job_id]
        if job["status"] in {"queued", "processing"}:
            job.update(status="cancelled", stage="Cancelled", finished=time.time())
            if job_id in PROCESSES:
                terminate(PROCESSES[job_id])
            else:
                clean(job)
        return public(job)


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    with LOCK:
        job = JOBS.get(job_id)
        if not job:
            return {"deleted": True}
        if job["status"] in {"uploading", "queued", "processing"} or job_id in PROCESSES:
            raise HTTPException(409, "Cancel this job and wait for the worker to stop before removing it.")
        clean(job)
        JOBS.pop(job_id)
        return {"deleted": True}
