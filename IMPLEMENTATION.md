# ClipScribe implementation notes

## Repository inspection
- Existing workspace contains independent projects; root is not a Git repository.
- Requested GitHub remote returned no refs on initial inspection (apparently empty).
- New app is isolated in `clipscribe/`; existing apps and their dependencies are preserved.
- Available locally: Node 24.13.0, npm 11.6.2, Python 3.13.2, FFmpeg and FFprobe.
- Use npm, React/TypeScript/Vite/Tailwind, Python FastAPI and faster-whisper.

## Implementation sequence
1. Scaffold local application and dark upload workspace.
2. Add bounded local uploads, media validation and cancellable background workers.
3. Extract audio with FFmpeg; invoke genuine faster-whisper inference with cached local models only.
4. Add timestamp-synchronized editing, search and TXT/SRT/VTT/JSON export.
5. Test with actual speech, audit local-only behavior, document exact setup and limitations.

## Privacy boundary
Model installation is an explicit separate network-enabled action. Transcription loads only already-installed model directories, with offline model loading. No media, transcription text, credentials or analytics leave localhost. Uploaded/extracted media live in bounded temporary job directories and are removed on completion/failure/cancellation. Optional short retention is explicitly selected. Jobs and transcripts are in memory, not a database.
