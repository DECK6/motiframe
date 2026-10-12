import path from "node:path";
import { build } from "esbuild";
import { build as buildEditor } from "vite";
import { packageSdk } from "./package-sdk.mjs";

await build({
  entryPoints: ["apps/runner/src/cli.ts"],
  outfile: "dist/runner/cli.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
});
await build({
  entryPoints: ["packages/stage/src/main.tsx"],
  outfile: "dist/stage/stage.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
await buildEditor({
  configFile: false,
  root: path.resolve("apps/editor"),
  build: {
    outDir: path.resolve("dist/editor"),
    emptyOutDir: false,
    rollupOptions: {
      input: { index: path.resolve("apps/editor/index.html"), stage: path.resolve("apps/editor/stage.html") },
    },
  },
});
await packageSdk();
console.log("Built runner, unified stage and editor.");
