import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { expect, it } from "vitest";
import { openStage } from "../../apps/runner/src/stage-session";
import { buildDefinition } from "../../packages/authoring/src/build";
import type { FrameContext, ProjectDocument } from "../../packages/document/src/schema";
import { createStarterProject } from "../../packages/document/src/starter";
import { expectOk } from "../helpers/result";

it("renders Three.js in the shared stage at deterministic ticks and disposes its scene", async () => {
  const document: ProjectDocument = JSON.parse(
    readFileSync("tests/fixtures/mixed-static/project.json", "utf8"),
  );
  document.instances = { red: document.instances.red };
  document.scenes.main.rootIds = ["red"];
  document.tracks = [document.tracks[0]];
  document.channels = {};
  const manifest = { ...document.definitions.red, moduleHash: "", revision: 2 };
  const artifact = expectOk(
    await buildDefinition({
      manifest,
      files: {
        "index.tsx": [
          "import {defineReactElement,ThreeCanvas} from '@motiframe/authoring';",
          "import {Scene,OrthographicCamera,BoxGeometry,MeshBasicMaterial,Mesh} from 'three';",
          "const probe=globalThis.__threeProbe={ticks:[],disposed:0,geometryDisposed:0,materialDisposed:0};",
          "function create(){const scene=new Scene();const camera=new OrthographicCamera(-2,2,1.5,-1.5,0.1,10);camera.position.z=5;",
          "const geometry=new BoxGeometry(1,1,1),material=new MeshBasicMaterial({color:'#ff0000'}),mesh=new Mesh(geometry,material);scene.add(mesh);",
          "geometry.addEventListener('dispose',()=>probe.geometryDisposed++);material.addEventListener('dispose',()=>probe.materialDisposed++);",
          "return {scene,camera,update(frame){probe.ticks.push(frame.tick);mesh.position.x=frame.tick/240000-1;mesh.rotation.y=frame.tick/240000*0.4;},dispose(){probe.disposed++;}};}",
          "export default defineReactElement(" +
            JSON.stringify(manifest) +
            ",({frame})=><ThreeCanvas frame={frame} width={180} height={120} create={create}/>);",
        ].join("\n"),
      },
    }),
  );
  document.definitions.red = artifact.manifest;
  document.instances.red.definitionRevision = 2;
  const stage = await openStage(320, 180, { definitions: [artifact.code] });
  try {
    expectOk(await stage.page.evaluate((doc) => window.motiframe.load(doc), document));
    async function frame(tick: number) {
      const context: FrameContext = {
        tick,
        frame: Math.floor(tick / 8000),
        fps: { num: 30, den: 1 },
        seed: 7,
        frameToken: "three:" + tick,
        documentRevision: 0,
      };
      const receipt = expectOk(
        await stage.page.evaluate((value) => window.motiframe.renderFrame(value), context),
      );
      expect(receipt).toMatchObject({ tick, ready: true });
      return Buffer.from(await stage.page.screenshot({ type: "png" }));
    }
    const start = await frame(0),
      moved = await frame(240000),
      again = await frame(0);
    expect(again.equals(start)).toBe(true);
    expect(moved.equals(start)).toBe(false);
    const pixel = (bytes: Buffer, x: number, y: number) => {
      const png = PNG.sync.read(bytes);
      return [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)];
    };
    expect(pixel(start, 45, 60)).toEqual([255, 0, 0]);
    expect(pixel(moved, 45, 60)).toEqual([0, 0, 0]);
    expect(pixel(moved, 90, 60)).toEqual([255, 0, 0]);
    await stage.page.evaluate(() => window.motiframe.dispose());
    const probe = await stage.page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __threeProbe: {
              ticks: number[];
              disposed: number;
              geometryDisposed: number;
              materialDisposed: number;
            };
          }
        ).__threeProbe,
    );
    expect(probe).toEqual({ ticks: [0, 240000, 0], disposed: 1, geometryDisposed: 1, materialDisposed: 1 });
    document.instances.red.start = 240000;
    document.instances.red.duration -= 240000;
    expectOk(await stage.page.evaluate((doc) => window.motiframe.load(doc), document));
    // The shared stage supplies negative local ticks to hidden future instances.
    // A delayed Three instance must not break an otherwise valid earlier project frame.
    const beforeStart = await frame(0);
    expect(pixel(beforeStart, 45, 60)).toEqual([0, 0, 0]);
    await stage.page.evaluate(() => window.motiframe.dispose());
  } finally {
    await stage.close();
  }
}, 30000);

it("keeps the example's actor release, camera response and caption reading on independent absolute clocks", async () => {
  const source = JSON.parse(readFileSync("skills/motiframe/examples/three-phrase.source.json", "utf8"));
  const artifact = expectOk(await buildDefinition(source));
  const document = createStarterProject("three-phrase");
  document.definitions.title = artifact.manifest;
  document.instances.title.definitionRevision = 2;
  const stage = await openStage(1280, 720, { definitions: [artifact.code] });
  try {
    expectOk(await stage.page.evaluate((doc) => window.motiframe.load(doc), document));
    async function sample(tick: number) {
      const context: FrameContext = {
        tick,
        frame: Math.floor(tick / 8000),
        fps: { num: 30, den: 1 },
        seed: 42,
        frameToken: "phrase:" + tick,
        documentRevision: 0,
      };
      expectOk(await stage.page.evaluate((frame) => window.motiframe.renderFrame(frame), context));
      return stage.page.evaluate(() => {
        const shadow = window.document.querySelector<HTMLElement>('[data-instance="title"]')!.shadowRoot!;
        return {
          pixels: shadow.querySelector("canvas")!.toDataURL(),
          captionOpacity: Number(
            shadow.querySelector<HTMLElement>('[data-motion-target="caption"] > div')!.style.opacity,
          ),
        };
      });
    }
    const prepare = await sample(48000),
      release = await sample(96000),
      response = await sample(168000);
    const reading = await sample(288000),
      lateAccent = await sample(600000),
      repeated = await sample(96000);
    expect(release.pixels).not.toBe(prepare.pixels);
    expect(release.captionOpacity).toBe(0);
    expect(response.captionOpacity).toBeGreaterThan(0);
    expect(response.captionOpacity).toBeLessThan(1);
    expect(reading.captionOpacity).toBe(1);
    expect(lateAccent.pixels).not.toBe(reading.pixels);
    expect(repeated).toEqual(release);
  } finally {
    await stage.close();
  }
}, 30000);
