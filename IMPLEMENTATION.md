# ClipScribe implementation notes

## Repository inspection
- Existing workspace contains independent projects; root is not a Git repository.
- Requested GitHub remote returned no refs on initial inspection (apparently empty).
- New app is isolated in `clipscribe/`; existing apps and their dependencies are preserved.
- Available locally: Node 24.13.0, npm 11.6.2, Python 3.13.2, FFmpeg and FFprobe.
- Use npm, React/TypeScript/Vite/Tailwind, Python FastAPI and faster-whisper.

## Completed implementation sequence
1. Built the isolated React application, dark landing page and responsive workspace.
2. Added bounded local uploads, media validation and cancellable background workers.
3. Integrated FFmpeg and genuine faster-whisper inference using cached local models only.
4. Added timestamp-synchronized editing, search, clipboard and TXT/SRT/VTT/JSON exports.
5. Verified actual human speech, offline inference, cancellation, cleanup, browser workflows and the production build; documented setup and limitations in README.md and TESTING.md.

## Final environment and handoff
- Use Homebrew Python 3.13.1, not the initially detected Designer Python 3.13.2: the latter could not load the PyAV native module.
- PyAV 16.1.0 is pinned after reproducing an incompatibility with PyAV 19.
- Base and Tiny model weights are cached locally, not committed. Base CPU recognition was tested; other hardware/models are qualified in TESTING.md.
- Git source is published to https://github.com/DhruvBansalGit/ClipScribe on main. The initial permission error was resolved using an explicitly user-supplied credential for the push. The credential was supplied only to the Git subprocess environment, not saved to source, Git configuration or a credential helper. Remote main was verified against the local commit. Repository permissions were not changed.

## Privacy boundary
Model installation is an explicit separate network-enabled action. Transcription loads only already-installed model directories, with offline model loading. No media, transcription text, credentials or analytics leave localhost. Uploaded/extracted media live in bounded temporary job directories and are removed on completion/failure/cancellation. Optional short retention is explicitly selected. Jobs and transcripts are in memory, not a database.

## Hosted browser mode (requested follow-up)
- Public site: https://clipscribe-flax.vercel.app. Only static assets are sent to Vercel using scripts/stage-vercel.mjs. The Python backend remains local and is not deployed.
- User explicitly confirmed personal/non-commercial Hobby use; no billing/plan changes.
- Transformers.js 4.3.1, pinned Xenova Tiny/Base ONNX revisions, CPU Q8 WebAssembly, self-hosted FFmpeg/ONNX runtimes, browser Cache Storage and app-shell service worker.
- Explicit download consent, actual per-file byte progress, cache completion/eviction checks and model removal. Models are stored in browser-managed site storage, not installed system-wide.
- Read-only WORKERFS mounts selected video; workers extract/transcribe locally. Browser limit 100 MiB / 600 seconds. Cancellation terminates workers, with no uploaded or persisted user media.
- Hosted Tiny and Base passed real human-speech recognition, edited exports, playback synchronization, cache reuse, offline reload/inference, cancellation and corrupt-media checks. Base removal was verified. See TESTING.md.
- CLI deployment only; GitHub source publishing does not automatically trigger Vercel. Runtime notices and upstream source are exposed through the footer.
