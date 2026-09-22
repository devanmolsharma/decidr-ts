import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site (not a user/org site) from
  // https://<user>.github.io/<repo>/ -- the repo name is a real path
  // segment, so absolute asset URLs need it as a prefix. "./" (relative)
  // would also work when this is embedded elsewhere, but Pages needs an
  // exact prefix for a deep-linked reload to resolve /assets/... correctly.
  base: "/decidr-ts/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // decidr-ts's TokenCache reaches Node's fs/os/path only through a
    // dynamic import() it never takes in the browser (see
    // node-cache-store.js) -- this app never uses TokenCache at all, but
    // Rollup still statically resolves that dynamic import's target
    // unless it's told the module is external.
    rollupOptions: {
      external: ["node:fs", "node:os", "node:path"],
    },
  },
});
