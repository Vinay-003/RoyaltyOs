import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "apps/web"),
  base: "/",
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, "apps/web/public"),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "apps/web/app.html"),
      },
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});
