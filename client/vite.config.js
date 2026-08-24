import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { vanillaExtractPlugin } from "@vanilla-extract/vite-plugin";

export default defineConfig({
  plugins: [react(), vanillaExtractPlugin()],
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  build: {
    cssMinify: false,
  },
});
