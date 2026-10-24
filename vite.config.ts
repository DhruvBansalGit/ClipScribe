import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/core"] },
  server: {
    port: 5175,
    strictPort: true,
    allowedHosts: [".ngrok-free.dev", ".ngrok.dev"],
    proxy: { "/api": "http://127.0.0.1:8001" },
  },
  preview: {
    port: 4175,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8001" },
  },
});
