# Browser-local transcription

The hosted application must run inference on each visitor's device, not on Vercel.

Implementation constraints:

- Keep the existing FastAPI/faster-whisper localhost workflow unchanged by default.
- Public HTTPS hosts use a dedicated browser worker and local ONNX Whisper inference.
- Ask for explicit model-download consent; persist only model assets in browser cache.
- Never transmit selected media, audio, transcript text or filenames to a server.
- Bundle inference and FFmpeg WebAssembly runtime assets with the static deployment.
- Permit model downloads only during explicit installation; cached transcription must reject network cache misses.
- User requested removal of the old 100 MiB/10-minute ceilings. Bound only decoded audio windows (30 seconds), not source recording duration or size; hardware/browser limits still apply.
- Offer all four multilingual models, with explicit memory/storage warnings for Small and Medium.
- Detect language from Whisper's language-token logits for each short speech section; do not use Transformers.js's missing-language English fallback. Always request transcription, not translation. Language detection does not guarantee accurate native-script text.
- Preserve partial completed windows on cancellation/failure; exports must distinguish partial results. TXT carries real source-video timestamp ranges.
- Verify with real speech through the actual worker, not mock transcripts.
