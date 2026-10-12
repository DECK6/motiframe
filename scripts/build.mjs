import { build } from "esbuild";

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
console.log("Built runner and unified stage.");
