import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function run(args: string[], cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 45000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}

describe("portable installed authoring SDK", () => {
  it("installs its local tarball and exposes runtime exports and strict NodeNext declarations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "motiframe-sdk-consumer-"));
    const packed = JSON.parse(run(["scripts/package-sdk.mjs", "--output", path.join(directory, "sdk")]));
    expect(packed.manifest.files).toContain("types/packages/document/src/schema.d.ts");
    const consumer = path.join(directory, "consumer");
    await mkdir(consumer);
    // Use the already installed public dependencies. The SDK itself must be installed from its tarball.
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "sdk-consumer",
        private: true,
        type: "module",
        dependencies: {
          react: "file:" + path.join(root, "node_modules/react"),
          three: "file:" + path.join(root, "node_modules/three"),
          zod: "file:" + path.join(root, "node_modules/zod"),
          tone: "file:" + path.join(root, "node_modules/tone"),
          "@types/react": "file:" + path.join(root, "node_modules/@types/react"),
          "@types/three": "file:" + path.join(root, "node_modules/@types/three"),
        },
      }),
    );
    const npm = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        packed.path,
      ],
      { cwd: consumer, encoding: "utf8", timeout: 45000, shell: process.platform === "win32" },
    );
    expect(npm.status, npm.stdout + npm.stderr).toBe(0);
    const installed = JSON.parse(
      await readFile(path.join(consumer, "node_modules/@motiframe/authoring/package.json"), "utf8"),
    );
    expect(installed.exports["."].import).toBe("./dist/index.js");
    await writeFile(
      path.join(consumer, "consumer.tsx"),
      [
        "import {defineReactElement,defineHtmlElement,MotionTarget,MotionSlot,manifestSchema,type ElementManifest} from '@motiframe/authoring';",
        "import {ThreeCanvas,type ThreeScene} from '@motiframe/authoring/three';",
        "import {parseToneScore,type ToneScore} from '@motiframe/authoring/tone';",
        "const tone:ToneScore={durationTicks:48000,notes:[]};parseToneScore(tone);",
        "const manifest:ElementManifest={id:'test',revision:1,kind:'react',moduleHash:'',propsSchema:{},targets:[],slots:[],assets:[]};",
        "const react=defineReactElement(manifest,({props,frame})=><MotionTarget targetKey='title'><MotionSlot slotId='children'/>{String(props.text)}{frame.tick}</MotionTarget>);",
        "const html=defineHtmlElement({...manifest,kind:'html'},{html:'<div/>',css:'',bindings:[]});",
        "manifestSchema.parse(react.manifest);export {react,html};",
      ].join("\n"),
    );
    run(
      [
        path.join(root, "node_modules/typescript/bin/tsc"),
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--target",
        "ES2023",
        "--jsx",
        "react-jsx",
        "consumer.tsx",
      ],
      consumer,
    );
    const runtime = run(
      [
        "--input-type=module",
        "--eval",
        "import {defineHtmlElement,manifestSchema} from '@motiframe/authoring';const manifest={id:'shape',revision:1,kind:'html',moduleHash:'',propsSchema:{},targets:[],slots:[],assets:[]};const result=defineHtmlElement(manifest,{html:'<div/>',css:'',bindings:[]});if(!manifestSchema.safeParse(result.manifest).success)throw Error('Invalid');console.log(result.kind);",
      ],
      consumer,
    );
    expect(runtime.trim()).toBe("html");
    const toneRuntime = run(
      [
        "--input-type=module",
        "--eval",
        "import {parseToneScore,renderToneScore} from '@motiframe/authoring/tone';import {ThreeCanvas} from '@motiframe/authoring/three';const score={durationTicks:48000,notes:[]};if(!parseToneScore(score).ok||typeof ThreeCanvas!=='function')throw Error('Missing exports');const result=await renderToneScore(score);if(result.ok||result.error.code!=='TONE_BROWSER_REQUIRED')throw Error('Unexpected Node audio context');console.log('safe');",
      ],
      consumer,
    );
    expect(toneRuntime.trim()).toBe("safe");
  }, 60000);

  it("applies both shipped source examples through the CLI and preserves actual HTML colors", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "motiframe-sdk-example-"));
    const cli = (args: string[]) =>
      JSON.parse(run(["--import", "tsx", "apps/runner/src/cli.ts", ...args, "--json"]));
    expect(cli(["init", directory]).ok).toBe(true);
    const project = path.join(directory, "project.json");
    for (const example of ["react-title", "html-shape"]) {
      const result = cli([
        "element",
        "build",
        project,
        "--file",
        "skills/motiframe/examples/" + example + ".source.json",
      ]);
      expect(result.ok, JSON.stringify(result.error)).toBe(true);
    }
    const document = JSON.parse(await readFile(project, "utf8"));
    expect(document.revision).toBe(2);
    expect(document.instances.title.definitionRevision).toBe(2);
    expect(document.instances.accent.definitionRevision).toBe(2);
    expect(document.instances.title.props.text).toBe("모션에 리듬을.");
    expect(document.channels["title:root:x"].owner).toBe("manual");
    const output = path.join(directory, "example.png");
    expect(cli(["capture", project, "--tick", "360000", "--output", output]).ok).toBe(true);
    const frame = PNG.sync.read(await readFile(output));
    const pixel = (x: number, y: number) => [
      ...frame.data.subarray((y * frame.width + x) * 4, (y * frame.width + x) * 4 + 3),
    ];
    expect(pixel(20, 20)).toEqual([17, 20, 18]);
    expect(pixel(80, 300)).toEqual([188, 247, 123]);
    // React title content is visible in its expected frame area, not merely a successful build.
    let titlePixels = 0;
    for (let y = 300; y < 400; y++)
      for (let x = 115; x < 700; x++) {
        const color = pixel(x, y);
        if (color[0] > 200 && color[1] > 200 && color[2] > 200) titlePixels += 1;
      }
    expect(titlePixels).toBeGreaterThan(1000);
  }, 60000);
});
