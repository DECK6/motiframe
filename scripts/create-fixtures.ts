import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
export async function createMixedFixture() {
  const folder = path.resolve("tests/fixtures/mixed-phrase");
  await mkdir(path.join(folder, "assets"), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30:duration=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(folder, "assets/video.mp4"),
  ]);
  const samples = 96000,
    pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < 480; i++)
    pcm.writeInt16LE(Math.round(26000 * Math.cos((i * Math.PI) / 8) * Math.exp(-i / 90)), (24000 + i) * 2);
  const wav = Buffer.alloc(44);
  wav.write("RIFF");
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  await writeFile(path.join(folder, "assets/pulse.wav"), Buffer.concat([wav, pcm]));
  await copyFile("tests/fixtures/fonts/NotoSansKR.ttf", path.join(folder, "assets/NotoSansKR.ttf"));
  const asset = async (logicalPath: string, kind: string, extra = {}) => ({
    sha256: createHash("sha256")
      .update(await readFile(path.join(folder, logicalPath)))
      .digest("hex"),
    kind,
    logicalPath,
    ...extra,
  });
  const channels = [
    "x",
    "y",
    "z",
    "scaleX",
    "scaleY",
    "rotateX",
    "rotateY",
    "rotateZ",
    "opacity",
    "clipProgress",
    "gain",
    "props.text",
  ];
  const definition = (id: string, kind: string, moduleHash: string) => ({
    id,
    revision: 1,
    kind,
    moduleHash,
    propsSchema: {},
    targets: [{ key: "root", channels, coordinateSpace: "local" }],
    slots: [],
    assets: [],
  });
  const duration = 1440000;
  const instance = (definitionId: string, start: number, length: number, props: Record<string, unknown>) => ({
    definitionId,
    definitionRevision: 1,
    parentId: null,
    slotId: null,
    trackId: definitionId,
    start,
    duration: length,
    props,
    locked: false,
  });
  const doc = {
    schemaVersion: 1,
    id: "mixed-phrase",
    revision: 0,
    settings: {
      width: 320,
      height: 180,
      fps: { num: 30, den: 1 },
      duration,
      ticksPerSecond: 240000,
      seed: 7,
      colorSpace: "srgb",
      sampleRate: 48000,
    },
    definitions: {
      video: definition("video", "html", "builtin:media"),
      wipe: definition("wipe", "html", "builtin:html-rect"),
      title: definition("title", "react", "builtin:react-text"),
      audio: definition("audio", "html", "builtin:audio"),
    },
    scenes: { main: { start: 0, duration, rootIds: ["video", "wipe", "title", "audio"] } },
    instances: {
      video: instance("video", 648000, 720000, { width: 320, height: 180, assetId: "video" }),
      wipe: instance("wipe", 0, duration, { width: 20, height: 20, color: "#9aff6b" }),
      title: instance("title", 0, duration, {
        text: "모션",
        fontSize: 38,
        color: "#ffffff",
        fontFamily: "MotiFrame Sans",
        width: 320,
        height: 80,
      }),
      audio: instance("audio", 240000, 480000, {}),
    },
    tracks: [
      { id: "video", kind: "video", instanceIds: ["video"], locked: false, muted: false },
      { id: "wipe", kind: "graphics", instanceIds: ["wipe"], locked: false, muted: false },
      { id: "title", kind: "graphics", instanceIds: ["title"], locked: false, muted: false },
      { id: "audio", kind: "audio", instanceIds: ["audio"], locked: false, muted: false },
    ],
    channels: {} as Record<string, unknown>,
    assets: {
      video: await asset("assets/video.mp4", "video"),
      pulse: await asset("assets/pulse.wav", "audio"),
      font: await asset("assets/NotoSansKR.ttf", "font", { fontMetadata: { family: "MotiFrame Sans" } }),
    },
    mediaClips: {
      video: { assetId: "video", sourceIn: 0, sourceOut: 720000, rate: { num: 1, den: 1 }, gain: 0 },
      audio: { assetId: "pulse", sourceIn: 0, sourceOut: 480000, rate: { num: 1, den: 1 }, gain: 1 },
    },
    score: { phrases: [], events: [], windows: [], tensions: [], handoffs: [] },
    references: [],
    provenance: { runtime: "0.1.0", sdk: "0.1.0", sources: ["synthetic-fixture"] },
  };
  const channel = (id: string, name: string, keys: [number, string | number, string?][]) => {
    doc.channels[`${id}:root:${name}`] = {
      target: { instanceId: id, targetKey: "root", channel: name },
      owner: "manual",
      locked: false,
      keys: keys.map(([at, value, mode], i) => ({
        id: `${id}-${name}-${i}`,
        at,
        value,
        interpolation: mode ?? "linear",
      })),
    };
  };
  channel("title", "x", [
    [0, 30],
    [240000, 60],
    [360000, 230],
    [648000, 30],
  ]);
  channel("title", "y", [[0, 60]]);
  channel("title", "props.text", [
    [0, "모션", "hold"],
    [336000, "●", "hold"],
    [840000, "MotiFrame", "hold"],
  ]);
  channel("title", "opacity", [
    [0, 1],
    [360000, 1],
    [432000, 0],
    [792000, 0],
    [840000, 1],
  ]);
  channel("wipe", "x", [
    [0, 240],
    [360000, 240],
    [648000, 0],
  ]);
  channel("wipe", "y", [
    [0, 80],
    [360000, 80],
    [648000, 0],
  ]);
  channel("wipe", "scaleX", [
    [0, 0],
    [360000, 0],
    [384000, 1],
    [648000, 16],
  ]);
  channel("wipe", "scaleY", [
    [0, 0],
    [360000, 0],
    [384000, 1],
    [648000, 9],
  ]);
  channel("wipe", "opacity", [
    [0, 1],
    [648000, 1],
    [720000, 0],
  ]);
  await writeFile(path.join(folder, "project.json"), JSON.stringify(doc, null, 2) + "\n");
  return { folder, project: doc };
}
