import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

export default defineConfig(({ command }) => ({
  plugins: [react(), vanillaExtractPlugin()],
  // Expose IS_DIRECT_MODE (in addition to VITE_*) to import.meta.env so
  // config.ts can detect direct (client-only) builds via an explicit flag
  // rather than the presence of VITE_API_BASE_URL.
  envPrefix: ["VITE_", "IS_DIRECT_MODE"],
  // Relative asset base for production builds so the built client works on
  // GitHub Pages project sites at any subpath (https://<user>.github.io/<repo>/)
  // and on custom domains. The app has no history-based routing, so "./" is
  // safe. Dev mode keeps the default "/" base for standard HMR behaviour.
  base: command === "build" ? "./" : "/",
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  build: {
    cssMinify: false,
  },
}));
