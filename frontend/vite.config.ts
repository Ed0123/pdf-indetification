import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Backend base URL: override with VITE_API_URL env var in production
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../frontend-dist",
    emptyOutDir: true,
  },
});
