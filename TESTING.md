# Verification report — native 2026-10-23 / hosted browser 2026-10-24

## Hosted browser mode — verified on the real public Vercel URL

Public site: **https://clipscribe-flax.vercel.app**. Static-only deployment to the existing Hobby account after explicit owner confirmation of personal/non-commercial use. No billing or plan changes. Unauthenticated HTTP/browser access to the production alias succeeded; preview protection remains a separate Vercel setting.

Actual Transformers.js 4.3.1 / ONNX Runtime Web / Q8 WASM inference succeeded for **both multilingual Tiny and Base** using the real 11-second JFK video. No Python backend or inference API was involved. Both produced recognizable speech including “ask not what your country can do for you, ask what you can do for your country.” ONNX segment boundaries differ from native faster-whisper; timestamps come from the model, not from the native fixture result. Auto-detected language/probability is not reported by the browser pipeline and is intentionally null rather than fabricated.

Hosted on-device suite:
- Tiny: **9 checks passed**, including cache reuse across separate browser launches.
- Base: **10 checks passed**, including first-download consent and remove-model verification.
- Tests cover real model installation, fresh-worker recognition, no local API calls/media upload bodies, no external downloads during inference, text editing/search/copy, playback synchronization, TXT/SRT/VTT/JSON exports, FFprobe parsing of actual exported subtitles, 390 px layout, offline page reload plus actual inference with browser networking disabled, worker cancellation, and corrupt-video rejection.
- The same checks ran on the actual public hostname without Vercel credentials or bypass headers. Cached models are specific to that origin/browser; localhost/native cache files were not used for the hosted result.
- Final no-timestamp unit coverage preserves null timestamps and refuses to manufacture SRT/VTT cue times. Frontend unit count is now **12**; the native regression suites remain 18 backend tests and 3 browser workflows.

Implementation issues caught and repaired:
- Runtime cache streaming failures under local disk pressure: buffer known bounded public assets before writing, report local-storage failure, and keep service-worker cache errors from breaking valid network responses.
- FFprobe WASM reports -1 after successful cleanup; accept it only with complete parseable stream/duration metadata. Corrupt input remains rejected.
- Transformers.js metadata probes default to main even when a pinned revision is requested. Explicit components and a narrowly scoped cache alias keep cached inference offline.
- Hosted CSP initially blocked local blob-WASM reads. Added `blob:` to connect-src and versioned the FFmpeg worker to invalidate stale cached security headers. Model-host allowlisting remains narrow; arbitrary remote uploads are not permitted by application code.
- Preserved the original backend but staged only built static assets for Vercel, avoiding multi-service autodetection and any Python/cloud inference deployment.

Browser limitations: no GPU/WebGPU path is exposed; current desktop Chromium tested, other browsers/OSes and mobile inference not verified. The 100 MiB / 10-minute bounds are product safeguards, not a promise every limited-memory device can process those maxima. Full 10-minute quality/performance was not benchmarked. Model-host outages, cache eviction and storage limitations can require retry/reinstallation. First use requires internet. Only app/model files are cached; transcripts remain tab-local. See [README.md](README.md) for exact hosted and native instructions.

## Original Python localhost mode — verified with real speech recognition

Environment: macOS Apple Silicon, Homebrew Python 3.13.1, Node 24.13.0, npm 11.6.2, local FFmpeg/FFprobe, faster-whisper 1.2.1 + PyAV 16.1.0, **Base / CPU / INT8**.

Input: actual JFK human speech from the whisper.cpp public `samples/jfk.wav`, muxed into an 11-second H.264/AAC MP4 with a static background. No transcript was supplied to the recognizer. The application's output included:

> And so my fellow Americans ask not what your country can do for you,
> ask what you can do for your country.

Actual returned segments: **0.0–8.0 seconds**, **8.0–11.0 seconds**. Automatic language detection returned English. This is an observed short-sample result, not a promise of perfect recognition or alignment for other media.

### Real pipeline: 8 checks passed

1. Actual upload → FFprobe validation → mono audio extraction → Base recognition → language/timestamps → immediate cleanup.
2. Optional retention keeps successful media; explicit discard removes it and the in-memory job.
3. Real subprocess cancellation removes temporary files.
4. Corrupt media fails with a useful message and is removed.
5. A three-second video with a silent audio track fails as “No intelligible speech,” not a fabricated transcript.
6. A **187-second video** made by repeating the real speech clip reached active inference. The config API responded in under two seconds during inference. Cancellation stopped the worker and deleted media. This checks responsiveness/cancellation, **not full three-minute recognition quality**.
7. A video with a two-second delayed audio track extracted to 16 kHz mono with the leading silence preserved. This checks the source-timeline offset numerically, not only by looking at waveform labels.
8. Actual Base inference succeeded with **Python socket connect/connect_ex blocked**; no connection attempts occurred and the model weight timestamp did not change. FFmpeg is separately restricted to local protocols and approved demuxers. This is not an OS-wide packet capture.

Base was downloaded once via the explicit local installer. A second **Tiny** installation was verified through `POST /api/models/tiny/install`: 202/downloading → installed. Recognition testing used Base; Tiny/Small/Medium accuracy was not measured.

## Frontend/browser verification

**3 Chromium browser workflows passed**:

- Landing page, local connection indicator, settings, keyboard dialog dismissal, 390 px responsive layout.
- Genuine local video upload and actual model inference, edit/search, timestamp seeking, active-segment highlighting on play/seek/pause, playback speed, complete/selected clipboard, all four downloaded formats, cleanup message, discard/new transcription, desktop/mobile screenshots and zero page errors or external browser requests.
- Invalid file extension and backend-offline/reconnect UX. The offline UI check intentionally aborts the local config request; it is not presented as a real backend crash.

**Production smoke passed** against the built frontend at port 4175:

- Production assets and proxy connected to the real FastAPI server.
- Actual Base transcription completed.
- Downloaded SRT/VTT were parsed by FFprobe as `subrip` / `webvtt` streams.
- No horizontal overflow at 360 px, no external browser requests, no page errors.
- Final production landing/workspace screenshots were inspected.

## Unit/policy verification

- **11 frontend unit tests passed**: timestamp precision/carry, active segment boundaries/gaps, edited text, JSON/SRT/VTT output, escaping, omitted empty subtitle cues and invalid timing.
- **18 backend tests passed**: config, exact origin/host/CSRF policy, settings/extension rejection, missing FFmpeg and Python speech dependencies, missing installed model, header/stream size limits, empty uploads, safe filenames, duplicate request IDs, cancellation/discard, queue limits, model download error messaging, corrupt/playlist input, missing audio, duration limits and missing FFprobe.
- Error-path tests use dependency/failure injection where stated. Unit fixtures are not application transcription results.
- TypeScript + Vite production build passed.
- `npm audit`: **0 vulnerabilities** in the resolved frontend tool/runtime dependency tree.
- `pip check`: no broken Python dependency requirements. This is dependency-consistency checking, not a Python vulnerability audit.

## Fixed during verification

- Designer's embedded Python could not load PyAV due to macOS library validation. Used an isolated Homebrew Python virtual environment; no global security changes.
- PyAV 19 removed an argument faster-whisper 1.2.1 calls. Pinned PyAV 16.1.0 and reran actual inference successfully.
- Upgraded the initial Vitest dependency after npm reported vulnerabilities; final npm audit is clean.
- Corrected the browser test's macOS keyboard-selection sequence; both real clipboard controls pass.
- Added explicit handling for expired/restarted backend jobs, sanitized inference errors, blocked playlist/network demuxing, and skipped empty subtitle cues.

## Not yet verified / limitations

- CUDA/GPU inference, Windows and Linux execution, Safari/Firefox.
- Full-length multi-hour transcription, memory-exhaustion recovery under actual OS pressure, all supported codecs/languages and Small/Medium recognition. CPU resource guidance is not a benchmark.
- No deliberate two-hour model-host outage was induced; download-failure messaging is covered through injected failure. The successful real installation endpoint was verified separately.
- Fifteen-minute/one-hour expiration is implemented in the janitor but was not tested by waiting the entire wall-clock interval. Immediate cleanup, cancellation, retained media and explicit deletion were tested.
- Browser selection must remain available to preview; unsupported browser codecs need conversion for synchronized playback. FFmpeg may support more formats than the browser.
- Edits are tab-local. Download before closing/reloading; there is no durable transcript storage or database.
- Fresh machines require dependency and model installation before they can work offline. No promise that a fresh clone works without internet.

## Reproduce

Use the commands and fixture preparation in [README.md](README.md). Start the backend and Vite dev server, install Base, then run:

```sh
npm test
python -m pytest backend/test_app.py -q
python tests/real_pipeline.py .local/real-speech.mp4
npm run test:browser
npm run build
npm audit
python -m pip check
```

For the production smoke, additionally start `npm run preview`, then run `npm run test:production`. Local media, screenshots, test downloads and logs live under ignored `.local/`; they are not shipped as application demo outputs.
