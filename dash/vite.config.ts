import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  appType: "spa",
  server: {
    port: 5173, // dev server — launcher is on 6969
    host: true,
    proxy: {
      // In dev, forward /api/* to the running launcher on :6969
      "/api": {
        target: "http://localhost:6969",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 6969,
    host: true,
  },
});
