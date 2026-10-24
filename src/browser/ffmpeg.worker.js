// Dedicated entry versions the worker's Content-Security-Policy cache.
// JS intentionally isolates upstream worker-only/no-default-lib declarations.
import "@ffmpeg/ffmpeg/worker";
Object.defineProperty(self, "clipscribeRuntimePolicy", { value: 2 });
