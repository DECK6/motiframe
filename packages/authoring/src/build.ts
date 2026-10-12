import { createHash } from "node:crypto";
import path from "node:path";
import { build } from "esbuild";
import * as THREE from "three";
import { fail, ok, type Result } from "../../document/src/result";
import { type ElementManifest, manifestSchema } from "../../document/src/schema";
export type DefinitionSource = { manifest: ElementManifest; files: Record<string, string>; entry?: string };
export type DefinitionArtifact = {
  manifest: ElementManifest;
  moduleHash: string;
  bundlePath: string;
  code: string;
  diagnostics: string[];
};
export async function buildDefinition(source: DefinitionSource): Promise<Result<DefinitionArtifact>> {
  const parsed = manifestSchema.safeParse(source.manifest);
  if (!parsed.success) return fail("INVALID_MANIFEST", parsed.error.message);
  if (
    !source.files ||
    Object.entries(source.files).some(
      ([p, s]) =>
        p.startsWith("/") || p.includes("\\") || p.split("/").includes("..") || typeof s !== "string",
    )
  )
    return fail("CAPABILITY_DENIED", "Source paths must be local and relative");
  const entry =
    source.entry ?? ["index.tsx", "index.ts", "index.jsx", "index.js"].find((p) => p in source.files);
  if (!entry) return fail("MISSING_ENTRY", "Source needs index.tsx, index.ts or an explicit entry");
  const vendors: Record<string, string> = {
    "@motiframe/authoring":
      "const s=window.MotiFrameSDK; export const defineReactElement=s.defineReactElement,defineHtmlElement=s.defineHtmlElement,MotionTarget=s.MotionTarget,MotionSlot=s.MotionSlot,ThreeCanvas=s.ThreeCanvas;",
    "@motiframe/authoring/three": "export const ThreeCanvas=window.MotiFrameSDK.ThreeCanvas;",
    "@motiframe/authoring/tone":
      "const t=window.MotiFrameTone;export const renderToneScore=t.renderToneScore,parseToneScore=t.parseToneScore,encodePcmWav=t.encodePcmWav;",
    three: `const t=window.MotiFrameThree; ${Object.keys(THREE)
      .filter((key) => /^[A-Za-z_$][\w$]*$/.test(key))
      .map((key) => `export const ${key}=t.${key};`)
      .join("\n")}`,
    react:
      "const r=window.MotiFrameReact; export default r; export const {createElement,Fragment,useMemo,useCallback,useRef,useState,useEffect,useLayoutEffect}=r;",
    "react/jsx-runtime": "const r=window.MotiFrameJSX; export const {jsx,jsxs,Fragment}=r;",
  };
  let denied = false;
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "MotiFrameElement",
      jsx: "automatic",
      logLevel: "silent",
      plugins: [
        {
          name: "in-memory-allowlist",
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (args.path in vendors) return { path: args.path, namespace: "vendor" };
              const p =
                args.kind === "entry-point"
                  ? args.path
                  : args.path.startsWith(".")
                    ? path.posix.normalize(path.posix.join(path.posix.dirname(args.importer), args.path))
                    : "";
              const found = [p, `${p}.tsx`, `${p}.ts`, `${p}.js`, `${p}/index.tsx`, `${p}/index.ts`].find(
                (x) => x in source.files,
              );
              if (!p || p.startsWith("../") || !found) {
                denied = true;
                return { errors: [{ text: `Import capability denied: ${args.path}` }] };
              }
              return { path: found, namespace: "source" };
            });
            b.onLoad({ filter: /.*/, namespace: "vendor" }, (args) => ({
              contents: vendors[args.path],
              loader: "js",
            }));
            b.onLoad({ filter: /.*/, namespace: "source" }, (args) => ({
              contents: source.files[args.path],
              loader: args.path.endsWith(".json")
                ? "json"
                : args.path.endsWith(".tsx") || args.path.endsWith(".jsx")
                  ? "tsx"
                  : "ts",
            }));
          },
        },
      ],
    });
    const code = `${result.outputFiles[0].text}\nwindow.motiframe.registerDefinition(${JSON.stringify(`${source.manifest.id}@${source.manifest.revision}`)},MotiFrameElement.default);`;
    const moduleHash = createHash("sha256").update(code).digest("hex");
    return ok({
      manifest: { ...parsed.data, moduleHash },
      moduleHash,
      bundlePath: `definitions/${moduleHash}.js`,
      code,
      diagnostics: result.warnings.map((w) => w.text),
    });
  } catch (error) {
    return fail(denied ? "CAPABILITY_DENIED" : "BUILD_FAILED", String(error));
  }
}
