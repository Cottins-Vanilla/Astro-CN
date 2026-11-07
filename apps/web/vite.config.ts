import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Resolve the internal workspace packages straight from their TypeScript
// source, so `pnpm dev` works on a fresh clone without first building their
// `dist/` output (Vite compiles the source and hot-reloads edits to it). The
// root `pnpm build` still builds each package's `dist/` for the other
// consumers (the MCP server, per-package tests) via topological order.
const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths ("./assets/...", "./logo.svg") instead of the
  // default root-absolute ones ("/assets/...") — root-absolute paths 404
  // under Electron's `file://` protocol, since there's no server to resolve
  // "/" against. A relative base still works for the browser build: `vite
  // preview`/any static host serves index.html at "/", and paths like
  // "./assets/x.js" resolve against that same location either way.
  base: "./",
  resolve: {
    alias: {
      "@solen/core": pkg("core"),
      "@solen/plugin-api": pkg("plugin-api"),
    },
  },
});
