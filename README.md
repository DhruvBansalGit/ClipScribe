# ClipScribe

> **Source repository:** [DhruvBansalGit/ClipScribe](https://github.com/DhruvBansalGit/ClipScribe), branch `main`. Source is published on GitHub; the application itself runs on localhost. Model weights, uploaded media, local test artifacts and credentials are not included.

**Turn Every Video Into Words.** A private, localhost video transcription workspace built with React, TypeScript, Vite, Tailwind CSS, Lucide, Motion, FastAPI, FFmpeg and **real faster-whisper inference**.

No paid transcription API, cloud credentials, accounts, database, Firebase, Supabase, analytics, remote fonts or cloud media storage. Model installation needs internet; **transcription uses installed local model files only**. This is a local application, not a hosted service.

## What works

- Drag/drop or select one video: MP4, MOV, WebM, MKV, AVI, M4V, MPEG, TS/MTS/M2TS, 3GP, OGV, WMV and FLV, subject to installed FFmpeg codecs.
- Object-URL browser preview, native play/pause/seek/volume/fullscreen controls, current time, duration and speed selection. The file is not converted to base64 or read into one JavaScript buffer.
- Base by default; Tiny, Base, Small and Medium model selection, explicit local model installation/status and disk caching.
- Automatic language detection or a known language from the model's 100 supported language codes. The task is **transcribe**, never automatic translation.
- A bounded in-memory job queue, genuine processing stages, measured upload progress and recognized-through timestamps (not a fabricated completion percentage or ETA).
- Isolated, killable worker processes; cancellation includes FFmpeg child processes. One inference job runs at a time to limit memory contention.
- Editable timestamped segments, search, active playback highlighting, timestamp seeking, optional follow scrolling, full/selected-text copying and word/segment/duration statistics.
- TXT, SRT, VTT and structured JSON downloads from **current edits** and actual model timestamps.
- Settings stored in localStorage; videos/transcripts are not stored there. No database.
- Temporary media cleanup, upload/duration/worker-time limits, explicit dependency and model errors, graceful backend-offline messaging, responsive dark layout and reduced-motion support.

Recognition is not perfect. Review names, numbers, punctuation and subtitle timing, especially for noisy or multilingual audio. There is no speaker diarization or speaker identity guessing. Word count is whitespace-based.

## Repository / prerequisites

This app was created in an isolated `clipscribe/` folder in the existing Designer workspace; other projects/configuration were preserved. The supplied GitHub repository initially had no refs. In the standalone GitHub checkout, the files described below are at repository root.

```sh
git clone https://github.com/DhruvBansalGit/ClipScribe.git
cd ClipScribe
```

For the existing Designer workspace copy, simply open a terminal in `clipscribe/` instead of cloning again.

Tested on macOS Apple Silicon with Node **24.13.0**, npm **11.6.2**, Homebrew Python **3.13.1**, FFmpeg/FFprobe, Base CPU INT8 and a Chromium browser. Use Node 24 LTS and Python 3.11–3.13. Windows/Linux instructions are provided but have not been executed on those platforms.

- Install Node.js LTS from <https://nodejs.org/> (includes npm).
- Install Python from <https://www.python.org/downloads/> or your package manager.
- Install FFmpeg **and FFprobe** on PATH.
- Leave enough free disk space for model weights, the uploaded video and uncompressed mono audio. Start with Tiny or Base on limited hardware; Medium is significantly more demanding.

### macOS

```sh
brew install node python@3.13 ffmpeg
node --version
npm --version
ffmpeg -version
ffprobe -version
```

Inside the project folder:

```sh
npm ci
$(brew --prefix python@3.13)/bin/python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
python -m pip check
```

**Designer terminal note:** use Homebrew/system Python for this virtual environment, not Designer's bundled Python. Its hardened runtime rejected PyAV's native module in our initial test. Do not change system code-signing/security settings to work around it.

### Linux (Debian/Ubuntu)

Install Node 24 LTS first using the official Node instructions, then:

```sh
sudo apt update
sudo apt install python3 python3-venv ffmpeg
python3 --version  # Use Python 3.11–3.13
npm ci
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

### Windows (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.13
winget install Gyan.FFmpeg
# Open a new terminal so PATH includes the installations.
node --version
ffmpeg -version
ffprobe -version
npm ci
py -3.13 -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

The commands below use the activated environment on macOS/Linux. On Windows, replace `python` with `.venv\Scripts\python.exe`; activation is not necessary.

### Dependency versions

Frontend dependencies are locked by `package-lock.json`; use `npm ci`. Direct Python dependencies are pinned in `backend/requirements.txt`. `backend/requirements-lock.txt` records the complete tested macOS environment, and can be installed with `python -m pip install -r backend/requirements-lock.txt` for that environment. Native wheel availability varies by platform.

**Important:** keep `av==16.1.0` with `faster-whisper==1.2.1`. PyAV 19 removed the `metadata_errors` argument used by this faster-whisper version. The earlier unpinned install failed real inference; the pin was verified by retranscribing real speech.

## Run locally: two terminals

Run all commands from the project root.

### Terminal 1 — backend

```sh
source .venv/bin/activate
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Windows:

```powershell
.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Use **one worker**, no `--reload`, and one instance per temporary directory. Jobs are process-local, not shared across server workers. Keep the host set to `127.0.0.1`, not `0.0.0.0`.

### Terminal 2 — frontend

```sh
npm run dev
```

Open **<http://127.0.0.1:5175>**. Vite proxies `/api` requests to the local backend. The header should show “Local engine connected.” Neither terminal can be closed while the app is running. Ctrl+C stops each server.

### Install a model (once)

In **Settings**, choose **Base** and click **Install model**. This explicitly downloads public weights from Hugging Face. No account or token is needed. The UI displays downloading/installed/failed status, not an invented download percentage. Only one model installation runs at once, and installation is blocked while media jobs are active.

Alternatively, before using the app:

```sh
source .venv/bin/activate
python backend/worker.py install base "$HOME/.cache/clipscribe/models"
```

Windows:

```powershell
.venv\Scripts\python.exe backend\worker.py install base "$env:USERPROFILE\.cache\clipscribe\models"
```

Substitute `tiny`, `small` or `medium` as desired. A completion marker is written only after a successful download. Partial downloads are not offered for transcription; retry installation to resume. To reinstall damaged cached weights, stop jobs/server, delete the affected model directory under your cache, restart and install that model again.

Once the model and runtime dependencies are installed, cached transcription can work offline. **Do not interpret a fresh checkout as offline-ready.** Base and Tiny are installed on the machine used for this implementation; weights are not committed to GitHub. Every new computer must install its own weights/dependencies first.

### Production frontend build (still localhost)

```sh
npm run build
npm run preview
```

Keep the backend running, then visit <http://127.0.0.1:4175>. This is a local production-build preview, not a cloud deployment.

## Settings and limits

Settings exposes only implemented controls:

- Model: Tiny, Base (default), Small, Medium.
- Language: automatic or supported known language; original language is preserved.
- Device: CPU INT8 by default. CUDA FLOAT16 is selectable only when CTranslate2 detects a CUDA device. A compatible NVIDIA driver/CUDA/cuDNN setup is additionally required; consult <https://github.com/SYSTRAN/faster-whisper#gpu>. Apple Metal/MPS is **not supported** by this backend.
- Cleanup: immediately after processing (default), or keep media up to 15 minutes after success. Failure/cancellation always deletes it.
- Default export: TXT/SRT/VTT/JSON. Dark theme is intentional; there is no nonfunctional theme switch.

Backend environment variables, set **before starting FastAPI**:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLIPSCRIBE_MAX_MB` | `1024` | Maximum upload size in MiB |
| `CLIPSCRIBE_MAX_MINUTES` | `120` | Maximum probed media duration |
| `CLIPSCRIBE_JOB_TIMEOUT` | `14400` | Maximum worker runtime in seconds |
| `CLIPSCRIBE_MODEL_DIR` | `~/.cache/clipscribe/models` | Persistent model cache |
| `CLIPSCRIBE_TEMP_DIR` | OS temp directory + `clipscribe-local` | Dedicated temporary media directory |

For example:

```sh
CLIPSCRIBE_MAX_MB=512 CLIPSCRIBE_MAX_MINUTES=60 python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Use a dedicated empty temporary directory if overriding it: app startup removes its own `job-*` subdirectories from previous runs. Do not share it with another ClipScribe process.

Uploads stream to randomized, private job directories. Filenames are display-only; they never become user-controlled filesystem paths. The backend validates the actual container with FFprobe, video/audio streams and duration. FFmpeg normalizes container time and resamples to mono 16 kHz PCM, retaining delayed audio as silence so transcript timestamps match video time. Unsafe playlist demuxers/network protocols are not enabled. Extension support does not guarantee browser codec support: convert to H.264/AAC MP4 for reliable playback synchronization if your browser cannot preview the source.

Queue: at most three uploading/queued/running jobs; one inference worker at a time, at most 100 retained job records. Upload timeout: 30 minutes. Optional media retention: 15 minutes, checked every two seconds. In-memory results expire one hour after termination. Closing the page does not immediately cancel a backend job; use Cancel. Shutdown kills active subprocesses and deletes media; a later startup removes leftover job folders after an abrupt crash. Cached model weights are intentionally retained.

**Download your transcript before navigating away.** Edits live in this tab, not on disk or in a database. Reloading loses the editor state. TXT/JSON retain edited text; SRT/VTT retain actual segment timing. Editing does not recalculate timing or invent new timestamps.

## Local security boundary

- API bound to loopback. Trusted Host checking and exact localhost origins on ports 5175, 4175 and 8001.
- Mutating requests require a per-process local CSRF token obtained from `/api/config`. This is not a cloud API key or user account. Disallowed origins and missing CSRF headers are rejected.
- No endpoint serves arbitrary local files or original media back to the browser. Playback uses the originally selected File object.
- Raw streaming uploads are size-limited even without `Content-Length`; there is no unbounded multipart parser buffer.
- FFprobe/FFmpeg restrict allowed demuxers and protocols. User names are never interpolated into a shell command.
- Worker errors are user-facing messages, not server stack traces/filesystem paths. Temporary logs disappear with the media.
- Browser assets are bundled locally. The worker sets offline model-loading flags and supplies a concrete installed model directory.

This is a single-user localhost tool, not a multi-user service or hardened sandbox for arbitrary hostile files. Keep FFmpeg and Python dependencies patched. Do not expose the ports on a LAN/public internet. Other trusted local processes can access the API; this is not an authentication boundary against malware on your computer.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Backend offline | Activate the right venv; start FastAPI on 8001 and Vite on 5175. Check the terminal error and port conflicts. |
| Missing Python import | `python -m pip install -r backend/requirements.txt`; use that same interpreter to start the backend. |
| macOS PyAV signature error | Recreate only this app's venv using Homebrew Python, not Designer's embedded interpreter. |
| Missing FFmpeg/FFprobe | Install FFmpeg; confirm both commands work in the backend terminal; restart. |
| Model install failed | Check internet, model-host availability, writable cache and free disk space; retry Settings → Install model. No media was sent. |
| Model load/insufficient memory | Choose CPU and Tiny, close memory-heavy apps; reinstall corrupted weights if necessary. |
| CUDA failure | Select CPU, or repair the compatible NVIDIA/CUDA/cuDNN setup. Device detection alone does not verify every GPU library. |
| Unsupported/corrupt media | Re-export the original to MP4 with H.264 video/AAC audio. A filename change does not repair a corrupt file. |
| No audio stream | Choose a video with an actual audio track. |
| No intelligible speech | Listen to the video, select its language and/or a different model. Silence is not a successful transcript. |
| Queue full / runtime limit | Wait/cancel jobs, shorten the video, use Tiny or adjust documented backend limits. |
| Clipboard blocked | Select segment text and use the system copy shortcut. |
| Browser can't preview | FFmpeg may still transcribe it; convert to a browser-supported codec to enable synchronization. |
| Backend restart/expired job | The editor offers retry with the still-selected video; transient backend records are not recoverable. |

## Tests and real-model verification

```sh
npm test
python -m pytest backend/test_app.py -q
npm run build
npm audit
python -m pip check
```

### Prepare a real human-speech video (test-only network download)

This public JFK recording is supplied by the whisper.cpp sample repository. It is downloaded **only to create a test fixture**, never by the application. The fixture is not a hardcoded app transcript and is not committed.

```sh
mkdir -p .local
curl -L --fail https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav -o .local/jfk.wav
ffmpeg -f lavfi -i color=c=0x19231b:s=960x540:r=24 -i .local/jfk.wav -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -y .local/real-speech.mp4
```

With both servers running and Base installed:

```sh
python tests/real_pipeline.py .local/real-speech.mp4
npx playwright install chromium
npm run test:browser
```

`real_pipeline.py` checks actual recognition, timestamps, language detection, cleanup, retention/discard, cancellation, corrupted video, silent audio and delayed audio alignment. It also performs actual cached inference with **Python socket connections prohibited** and confirms the weight file was not rewritten. FFmpeg network access is separately restricted by its protocol/demuxer whitelist. This is strong application-level offline evidence, not an OS-wide packet capture or a claim that every possible codec/model/hardware combination has been tested.

Browser tests use the real local backend and model for the transcription workflow, then verify editing, search, timestamp seeking, play/pause/speed, active-segment highlighting, both clipboard actions and all four downloaded formats. The backend-offline test intentionally blocks the local config request. Unit tests use synthetic data/failure injection for export and error paths; these are not represented as real recognition results.

See [TESTING.md](TESTING.md) for the latest verified results and untested cases.

## Source layout

- `src/App.tsx` — upload/workspace/settings UI and job polling.
- `src/transcript.ts` — export/timestamp/active-segment logic.
- `src/styles.css` — responsive dark design, Tailwind integration.
- `backend/app.py` — local API, queue supervision, install coordination and cleanup.
- `backend/worker.py` — FFprobe, FFmpeg, isolated local inference and explicit model installation.
- `backend/test_app.py`, `tests/` — policy/unit/browser/real-pipeline tests.
- `.local/` — ignored local-only test inputs/screenshots/logs; `.venv/`, models and dependencies are never committed.
