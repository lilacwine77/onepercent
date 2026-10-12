import { threeSourceShaders } from "./scripts/three-source.mjs";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { browserDeployment } from "./scripts/deployment.mjs";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { buildMetadata } from "./scripts/build-metadata.mjs";
import { browserConfig } from "./scripts/browser-config.mjs";
import { browserParams } from "./scripts/browser-params.mjs";
import {
  browserBufferGuard,
  browserByteDependencies,
} from "./scripts/browser-buffer.mjs";
// Preview builds only (VITE_PREVIEW=1): their extra chunk boundary evaluates zod
// before src/zod-setup.ts, so a first-party script sets zod's jitless flag
// first (the CSP has no 'unsafe-eval'). Production builds are unchanged.
const previewZodJitless = (): Plugin => ({
  name: "onepercent-preview-zod-jitless",
  apply: "build",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "zod-jitless.js",
      source: "globalThis.__zod_globalConfig = { jitless: true };\n",
    });
  },
  transformIndexHtml: (html) =>
    html.replace(
      '<script type="module"',
      '<script src="/zod-jitless.js"></script>\n    <script type="module"',
    ),
});
const target =
  process.env.WEB_TEST_API_URL ||
  process.env.VITE_API_URL ||
  "http://127.0.0.1:3000";
export default defineConfig(({ mode }) => ({
  define: {
    __WEB_DEPLOYMENT__: JSON.stringify(
      process.env.VITEST
        ? {
            cluster: "devnet",
            programId: JSON.parse(
              readFileSync(
                new URL(
                  "../../packages/sdk/src/idl/onepercent.json",
                  import.meta.url,
                ),
                "utf8",
              ),
            ).address,
          }
        : browserDeployment({ ...loadEnv(mode, "../..", ""), ...process.env }),
    ),
  },
  plugins: [
    react(),
    browserConfig(),
    buildMetadata(),
    threeSourceShaders(),
    { ...browserByteDependencies(), enforce: "pre" },
    browserBufferGuard(),
    ...(process.env.VITEST ? [] : [browserParams()]),
    ...(process.env.VITE_PREVIEW === "1" ? [previewZodJitless()] : []),
  ],
  envDir: "../..",
  // Source modules let the bundler keep Rip-only Three features out of the TV.
  // The prebuilt Three bundles merge those features into one shared download.
  resolve: { alias: [{ find: /^three$/, replacement: "three/src/Three.js" }] },
  optimizeDeps: { rolldownOptions: { plugins: [browserByteDependencies()] } },
  // index.html preloads nothing and every supported browser has native
  // modulepreload (Baseline 2023); the polyfill only cost entry bytes.
  build: {
    manifest: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // Everything the first page needs in one file: left to itself, the
        // bundler splits the modules that lazy routes share (zod, React's JSX
        // runtime, the copy) into small chunks, and each file compresses on
        // its own (about 1.2 KB gzip more for the same code).
        codeSplitting: { groups: [{ name: "index", tags: ["$initial"] }] },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target, changeOrigin: true } },
  },
  preview: { proxy: { "/api": { target, changeOrigin: true } } },
  test: {
    environment: "jsdom",
    exclude: [
      "scripts/**",
      "e2e/**",
      "tests/chain/**",
      "**/node_modules/**",
      "**/dist/**",
    ],
  },
}));
