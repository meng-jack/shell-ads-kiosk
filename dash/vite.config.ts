import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  appType: "spa",
  publicDir: "static",
  server: {
    port: 5173, 
    host: true,
    proxy: {
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
