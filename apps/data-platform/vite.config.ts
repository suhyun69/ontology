import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** The workspace root, where the shared .env lives. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig(({ mode }) => {
  // Note the prefix. loadEnv returns only variables that start with it, so
  // DATABASE_URL in the same file cannot be picked up here -- anything this
  // function returns is compiled into a bundle the browser can read, and the
  // connection string must never be among it.
  const env = loadEnv(mode, repoRoot, "COURSE_NOW");

  return {
    plugins: [react()],

    define: {
      // The server runs on the course's timeline (see the API's clock.ts), so
      // any window the UI measures has to be measured against the same instant.
      __COURSE_NOW__: JSON.stringify(env["COURSE_NOW"] ?? null),
    },

    server: {
      // Same-origin in the browser, so the API needs no CORS handling and the
      // client can use plain relative /api paths.
      proxy: {
        "/api": "http://localhost:3000",
      },
    },
  };
});
