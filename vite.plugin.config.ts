import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: resolve(import.meta.dirname, "src/fontra-core-entry.ts"),
      formats: ["es"],
      fileName: () => "fit-core.js",
    },
    outDir: "fontra-plugin",
    emptyOutDir: false,
    minify: true,
  },
});
