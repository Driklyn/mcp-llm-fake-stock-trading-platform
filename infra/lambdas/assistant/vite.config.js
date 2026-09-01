/**
 * Vite build for the assistant Lambda.
 *
 * Bundles the API Gateway adapter (index.mjs), the shared `chat-assistant`
 * workspace package, and @aws-sdk into one self-contained ESM file at
 * dist/index.mjs. Terraform's archive_file zips dist/ directly (see
 * infra/terraform/main.tf), so the Lambda needs no node_modules at runtime.
 */
import { defineConfig } from "vite";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

// The Node 22 Lambda runtime provides every built-in module. Externalize both
// spellings (`util` and `node:util`) so Rollup never tries to resolve or
// inline them — the AWS SDK imports bare builtins in places.
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export default defineConfig({
  build: {
    target: "node22",
    minify: false,
    sourcemap: false,
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    lib: {
      entry: resolve(root, "index.mjs"),
      formats: ["es"],
      fileName: () => "index.mjs",
    },
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id) || id.startsWith("@aws-sdk/"),
      output: {
        // Single self-contained chunk (no dynamic-import code splitting).
        codeSplitting: false,
      },
    },
  },
});
