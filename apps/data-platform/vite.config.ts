import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin in the browser, so the API needs no CORS handling and the
    // client can use plain relative /api paths.
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
