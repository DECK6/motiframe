import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDefinition } from "../packages/authoring/src/build";
import { compileProject } from "../packages/core/src/compile";
import { compileScore } from "../packages/core/src/score/compile";
import { validateScore } from "../packages/core/src/score/schema";
import { frameCount } from "../packages/core/src/time";
import { segmentText } from "../packages/core/src/type/segment";
import { applyTransaction } from "../packages/document/src/apply";
import type {
  Channel,
  ElementManifest,
  Instance,
  JsonValue,
  ProjectDocument,
} from "../packages/document/src/schema";
import { createStarterProject } from "../packages/document/src/starter";

const tick = (seconds: number) => Math.round(seconds * 240000);
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const colors = {
  ink: "#10241f",
  night: "#111d21",
  paper: "#ede9dd",
  mint: "#b5e6c4",
  orange: "#efae79",
  dim: "#73928b",
};
function base(id: string, seconds: number): ProjectDocument {
  const doc = createStarterProject(id);
  doc.settings = { ...doc.settings, width: 640, height: 360, duration: tick(seconds), seed: 917 };
  doc.instances = {};
  doc.channels = {};
  doc.scenes = {};
  doc.mediaClips = {};
  doc.assets = {};
  doc.tracks = [
    ["background", "graphics"],
    ["geometry", "graphics"],
    ["media", "video"],
    ["type", "graphics"],
    ["details", "graphics"],
    ["audio", "audio"],
  ].map(([id, kind]) => ({
    id,
    kind: kind as "graphics" | "video" | "audio",
    instanceIds: [],
    locked: false,
    muted: false,
  }));
  doc.provenance.sources = [
    "scripts/create-showcase.ts",
    "original-synthetic-audio-and-video",
    "Noto Sans KR / SIL OFL 1.1",
  ];
  return doc;
}
function scene(doc: ProjectDocument, id: string, start: number, duration: number) {
  doc.scenes[id] = { start: tick(start), duration: tick(duration), rootIds: [] };
}
function add(
  doc: ProjectDocument,
  id: string,
  definitionId: string,
  sceneId: string,
  start: number,
  duration: number,
  props: Instance["props"],
  trackId = "geometry",
  x = 0,
  y = 0,
) {
  doc.instances[id] = {
    definitionId,
    definitionRevision: doc.definitions[definitionId].revision,
    parentId: null,
    slotId: null,
    trackId,
    start: tick(start),
    duration: tick(duration),
    props,
    locked: false,
  };
  doc.tracks.find((t) => t.id === trackId)!.instanceIds.push(id);
  doc.scenes[sceneId].rootIds.push(id);
  curve(doc, id, "x", [[0, x]]);
  curve(doc, id, "y", [[0, y]]);
  const global = doc.scenes[sceneId].start + tick(start);
  doc.score.windows.push({
    id: `${id}:texture`,
    range: { start: global, end: global + tick(duration) },
    targetIds: [id],
    role: "texture",
  });
}
type Cue = [seconds: number, value: number, interpolation?: "hold" | "linear" | "cubic"];
function curve(doc: ProjectDocument, id: string, property: string, cues: Cue[], recipeId?: string) {
  const keys: Channel["keys"] = cues.map(([seconds, value, interpolation], i) => ({
    id: `${id}:${property}:${i}`,
    at: tick(seconds),
    value,
    interpolation: interpolation ?? "cubic",
  }));
  for (let i = 0; i < keys.length - 1; i++)
    if (keys[i].interpolation === "cubic") {
      keys[i].out = [0.25, keys[i].value as number];
      keys[i + 1].in = [0.75, keys[i + 1].value as number];
    }
  doc.channels[`${id}:root:${property}`] = {
    target: { instanceId: id, targetKey: "root", channel: property },
    owner: recipeId ? "recipe" : "manual",
    ...(recipeId ? { recipeId } : {}),
    locked: false,
    keys,
  };
}
function text(
  doc: ProjectDocument,
  id: string,
  sceneId: string,
  start: number,
  duration: number,
  content: string,
  x: number,
  y: number,
  size: number,
  color = colors.paper,
  reveal?: { start: number; end: number; stagger: number },
  track = "type",
) {
  add(
    doc,
    id,
    "title",
    sceneId,
    start,
    duration,
    {
      text: content,
      fontSize: size,
      fontFamily: "MotiFrame Sans",
      fontWeight: size < 16 ? 500 : 700,
      color,
      width: 560,
      height: size * 1.45,
      ...(reveal
        ? {
            textUnit: "grapheme",
            textUnits: segmentText(content, "grapheme"),
            textSelector: {
              range: { start: tick(reveal.start), end: tick(reveal.end) },
              offset: 0,
              shape: "smooth",
              stagger: tick(reveal.stagger),
            },
          }
        : {}),
    },
    track,
    x,
    y,
  );
}
function rect(
  doc: ProjectDocument,
  id: string,
  sceneId: string,
  start: number,
  duration: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  track = "geometry",
) {
  add(doc, id, "shape", sceneId, start, duration, { width, height, color }, track, x, y);
}
function reading(
  doc: ProjectDocument,
  id: string,
  start: number,
  end: number,
  targets: string[],
  role: "reading" | "closure" | "tension" = "reading",
) {
  doc.score.windows.push({ id, range: { start: tick(start), end: tick(end) }, targetIds: targets, role });
}
function phrase(
  doc: ProjectDocument,
  id: string,
  actor: string,
  start: number,
  end: number,
  arrival: number,
  rest: number,
  response: number,
) {
  const events = [
    { id: `${id}:on`, phraseId: id, kind: "onset", tick: tick(start), targetIds: [actor] },
    { id: `${id}:arrive`, phraseId: id, kind: "accent", tick: tick(arrival), targetIds: [actor] },
    { id: `${id}:rest`, phraseId: id, kind: "rest", tick: tick(rest), targetIds: [actor] },
    { id: `${id}:reply`, phraseId: id, kind: "response", tick: tick(response), targetIds: [actor] },
  ];
  doc.score.phrases.push({
    id,
    range: { start: tick(start), end: tick(end) },
    primaryActor: actor,
    eventIds: events.map((e) => e.id),
    grammar: "phrase-exchange",
    bases: { [`${actor}:x`]: 48 },
  });
  doc.score.events.push(...events);
  const channel = doc.channels[`${actor}:root:x`];
  channel.owner = "recipe";
  channel.recipeId = id;
}
async function definitions(doc: ProjectDocument, folder: string) {
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
  ];
  for (const [id, css] of Object.entries({
    disc: ".form{border-radius:50%;box-sizing:border-box}",
    ring: ".form{border-radius:50%;box-sizing:border-box;border:1px solid currentColor;background:transparent!important}",
    field:
      ".form{background-image:radial-gradient(circle at 80% 30%,rgba(170,220,190,.1),transparent 48%),repeating-linear-gradient(90deg,transparent,transparent 79px,rgba(170,220,190,.055) 80px),repeating-linear-gradient(0deg,transparent,transparent 59px,rgba(170,220,190,.055) 60px)}",
  })) {
    const manifest: ElementManifest = {
      id: `showcase-${id}`,
      revision: 1,
      kind: "html",
      moduleHash: "",
      propsSchema: { type: "object" },
      targets: [{ key: "root", channels, coordinateSpace: "local" }],
      slots: [],
      assets: [],
    };
    const template = {
      html: '<div class="form"></div>',
      css,
      bindings: [
        { selector: ".form", prop: "width", kind: "style", name: "width", unit: "px" },
        { selector: ".form", prop: "height", kind: "style", name: "height", unit: "px" },
        { selector: ".form", prop: "fill", kind: "style", name: "background-color" },
        { selector: ".form", prop: "color", kind: "style", name: "color" },
      ],
    };
    const source = {
      manifest,
      files: {
        "index.ts": `import {defineHtmlElement} from '@motiframe/authoring';\nexport default defineHtmlElement(${JSON.stringify(manifest)},${JSON.stringify(template)});\n`,
      },
    };
    const artifact = await buildDefinition(source);
    if (!artifact.ok) throw new Error(artifact.error.message);
    doc.definitions[`${manifest.id}@1`] = artifact.value.manifest;
    await mkdir(path.join(folder, "definitions"), { recursive: true });
    await writeFile(path.join(folder, artifact.value.bundlePath), artifact.value.code);
    await writeFile(
      path.join(folder, `definitions/${artifact.value.moduleHash}.source.json`),
      JSON.stringify(source, null, 2) + "\n",
    );
  }
}
async function assets(doc: ProjectDocument, folder: string, seconds: number, cues: number[], drone = false) {
  await mkdir(path.join(folder, "assets"), { recursive: true });
  await copyFile("assets/fonts/NotoSansKR.ttf", path.join(folder, "assets/NotoSansKR.ttf"));
  await copyFile("assets/fonts/OFL.txt", path.join(folder, "assets/OFL.txt"));
  const register = async (
    id: string,
    logicalPath: string,
    kind: string,
    extra: Record<string, JsonValue> = {},
  ) => {
    doc.assets[id] = {
      sha256: digest(await readFile(path.join(folder, logicalPath))),
      kind,
      logicalPath,
      ...extra,
    };
  };
  await register("font", "assets/NotoSansKR.ttf", "font", { fontMetadata: { family: "MotiFrame Sans" } });
  await register("font-license", "assets/OFL.txt", "license");
  const samples = Math.round(seconds * 48000),
    pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const time = i / 48000;
    let value = drone
      ? Math.sin(2 * Math.PI * 73.416 * time) * Math.min(1, time / 2, (seconds - time) / 2) * 950
      : 0;
    for (const [index, cue] of cues.entries()) {
      const age = time - cue;
      if (age >= 0 && age < 0.65)
        value +=
          Math.sin(2 * Math.PI * (index % 2 ? 440 : 220) * age) *
          Math.exp(-age * 12) *
          Math.min(1, age * 1000) *
          4400;
    }
    pcm.writeInt16LE(Math.round(Math.max(-32767, Math.min(32767, value))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(96000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(path.join(folder, "assets/score.wav"), Buffer.concat([header, pcm]));
  await register("sound", "assets/score.wav", "audio");
  const firstScene = Object.keys(doc.scenes)[0];
  add(doc, "soundtrack", "audio", firstScene, 0, seconds, {}, "audio");
  doc.mediaClips.soundtrack = {
    assetId: "sound",
    sourceIn: 0,
    sourceOut: tick(seconds),
    rate: { num: 1, den: 1 },
    gain: 0.6,
  };
}
function header(
  doc: ProjectDocument,
  sceneId: string,
  prefix: string,
  duration: number,
  label: string,
  dark = false,
) {
  text(
    doc,
    `${prefix}-eyebrow`,
    sceneId,
    0,
    duration,
    label,
    48,
    31,
    10,
    dark ? colors.ink : colors.mint,
    undefined,
    "details",
  );
  text(
    doc,
    `${prefix}-footer`,
    sceneId,
    0,
    duration,
    "MOTIFRAME   /   FORM · TIME · INTENT",
    48,
    329,
    9,
    dark ? "#73847a" : colors.dim,
    undefined,
    "details",
  );
  rect(doc, `${prefix}-rule`, sceneId, 0, duration, 48, 58, 544, 1, dark ? "#c7d0bf" : "#294139", "details");
}
function field(doc: ProjectDocument, id: string, sceneId: string, duration: number, color = colors.night) {
  add(
    doc,
    id,
    "showcase-field@1",
    sceneId,
    0,
    duration,
    { width: 640, height: 360, fill: color, color: colors.mint },
    "background",
  );
}
async function hangul(folder: string) {
  const doc = base("hangul-rhythm-15s", 15);
  scene(doc, "main", 0, 15);
  await definitions(doc, folder);
  field(doc, "field", "main", 15);
  header(doc, "main", "type", 15, "01 / HANGUL MOTION STUDY");
  add(
    doc,
    "halo",
    "showcase-ring@1",
    "main",
    0,
    15,
    { width: 240, height: 240, fill: "transparent", color: colors.mint },
    "geometry",
    425,
    75,
  );
  curve(doc, "halo", "opacity", [[0, 0.12]]);
  curve(doc, "halo", "scaleX", [
    [0, 0.82],
    [15, 1.1],
  ]);
  curve(doc, "halo", "scaleY", [
    [0, 0.82],
    [15, 1.1],
  ]);
  const cards = [
    { id: "a", start: 0, length: 5.2, lines: ["움직임 사이,", "리듬이 생긴다."], color: colors.paper },
    { id: "b", start: 5, length: 5.2, lines: ["빠르게 말고,", "다르게."], color: colors.orange },
    { id: "c", start: 10, length: 5, lines: ["다음 움직임에", "여백을 건네다."], color: colors.mint },
  ];
  for (const card of cards) {
    for (const [lineIndex, content] of card.lines.entries()) {
      const id = `${card.id}-line-${lineIndex}`;
      text(doc, id, "main", card.start, card.length, content, 48, 107 + lineIndex * 59, 42, card.color, {
        start: 0.15 + lineIndex * 0.18,
        end: 0.75 + lineIndex * 0.18,
        stagger: 0.045,
      });
      curve(doc, id, "opacity", [
        [0, 0],
        [0.2, 1],
        [card.length - 0.4, 1, "hold"],
        [card.length, 0],
      ]);
      if (lineIndex === 0) {
        phrase(
          doc,
          `${card.id}-phrase`,
          id,
          card.start,
          card.start + card.length,
          card.start + 1.05,
          card.start + 1.5,
          card.start + card.length - 0.3,
        );
        reading(doc, `${id}:read`, card.start + 1.5, card.start + card.length - 0.4, [id]);
      } else reading(doc, `${id}:read`, card.start + 1.6, card.start + card.length - 0.4, [id]);
    }
    rect(
      doc,
      `${card.id}-accent`,
      "main",
      card.start,
      card.length,
      48,
      273,
      card.id === "b" ? 126 : 180,
      4,
      card.color,
    );
    curve(doc, `${card.id}-accent`, "clipProgress", [
      [0, 0],
      [0.8, 1],
      [card.length - 0.4, 1],
      [card.length, 0],
    ]);
    text(
      doc,
      `${card.id}-number`,
      "main",
      card.start,
      card.length,
      `${cards.indexOf(card) + 1}  /  3`,
      553,
      276,
      11,
      card.color,
      undefined,
      "details",
    );
  }
  reading(doc, "final-reading", 11.6, 14.6, ["c-line-0", "c-line-1"], "closure");
  await assets(doc, folder, 15, [0.55, 5.45, 10.55, 13.4]);
  return doc;
}
async function tension(folder: string) {
  const doc = base("slow-tension-10s", 10);
  scene(doc, "main", 0, 10);
  await definitions(doc, folder);
  field(doc, "field", "main", 10, "#171e20");
  header(doc, "main", "slow", 10, "02 / SLOW TENSION");
  text(doc, "line-1", "main", 0, 10, "아직,", 48, 102, 54, colors.paper, {
    start: 0.7,
    end: 1.9,
    stagger: 0.1,
  });
  text(doc, "line-2", "main", 0, 10, "움직이지 않았다.", 48, 171, 38, colors.paper, {
    start: 1.2,
    end: 2.4,
    stagger: 0.055,
  });
  text(doc, "aside", "main", 0, 10, "해소를 미룬 10초", 48, 280, 12, colors.orange);
  curve(doc, "aside", "opacity", [
    [0, 0],
    [3.1, 0],
    [4.2, 1],
  ]);
  add(
    doc,
    "anchor",
    "showcase-disc@1",
    "main",
    0,
    10,
    { width: 5, height: 5, fill: colors.paper },
    "geometry",
    432,
    276,
  );
  add(
    doc,
    "orb",
    "showcase-disc@1",
    "main",
    0,
    10,
    { width: 30, height: 30, fill: colors.orange },
    "geometry",
    452,
    264,
  );
  curve(
    doc,
    "orb",
    "x",
    [
      [0, 452],
      [9.5, 444],
    ],
    "slow-phrase",
  );
  curve(doc, "orb", "scaleX", [
    [0, 0.86],
    [8, 1],
  ]);
  curve(doc, "orb", "scaleY", [
    [0, 0.86],
    [8, 1],
  ]);
  rect(doc, "distance", "main", 0, 10, 438, 278, 1, 1, colors.orange);
  curve(doc, "distance", "scaleX", [
    [0, 14],
    [9.5, 6],
  ]);
  curve(doc, "distance", "opacity", [
    [0, 0.22],
    [8, 0.65],
  ]);
  doc.score.phrases.push({
    id: "slow-phrase",
    range: { start: 0, end: tick(10) },
    primaryActor: "orb",
    eventIds: ["slow-cue", "slow-suspend"],
    grammar: "phrase-exchange",
    bases: { "orb:x": 500 },
  });
  doc.score.events.push(
    { id: "slow-cue", phraseId: "slow-phrase", kind: "onset", tick: 0, targetIds: ["orb"] },
    { id: "slow-suspend", phraseId: "slow-phrase", kind: "prepare", tick: tick(9.5), targetIds: ["orb"] },
  );
  doc.score.tensions.push({
    id: "intentional-suspension",
    cueEvent: "slow-cue",
    unresolvedState: "The warm disc approaches the anchor; the remaining gap stays open.",
    intentionalUnresolvedEnd: true,
  });
  reading(doc, "slow-title-read", 3, 10, ["line-1", "line-2"]);
  reading(doc, "slow-tension", 0, 10, ["orb", "anchor", "distance"], "tension");
  await assets(doc, folder, 10, [0.8, 8.2], true);
  return doc;
}
async function mixed(folder: string) {
  const doc = base("mixed-material-30s", 30);
  scene(doc, "signal", 0, 10);
  scene(doc, "material", 10, 10);
  scene(doc, "continuation", 20, 10);
  await definitions(doc, folder);
  field(doc, "field-1", "signal", 10);
  field(doc, "field-2", "material", 10, "#172827");
  field(doc, "field-3", "continuation", 10, colors.paper);
  header(doc, "signal", "s1", 10, "03 / SIGNAL TO SCENE");
  header(doc, "material", "s2", 10, "03 / DIFFERENT MATERIALS");
  header(doc, "continuation", "s3", 10, "03 / CONTINUATION", true);
  const titles = [
    { scene: "signal", start: 0, lines: ["작은 신호가", "장면을 바꾼다."], color: colors.paper },
    { scene: "material", start: 10, lines: ["하나의 시간 위에", "다른 재료를 엮다."], color: colors.paper },
    { scene: "continuation", start: 20, lines: ["장면은 닫혀도,", "리듬은 이어진다."], color: colors.ink },
  ];
  for (const [index, title] of titles.entries())
    for (const [lineIndex, line] of title.lines.entries()) {
      const id = `scene${index + 1}-line${lineIndex + 1}`,
        delay = index === 1 ? 2 : 0;
      text(doc, id, title.scene, 0, 10, line, 48, 103 + lineIndex * 57, 39, title.color, {
        start: delay + 0.2 + lineIndex * 0.16,
        end: delay + 0.95 + lineIndex * 0.16,
        stagger: 0.04,
      });
      curve(doc, id, "opacity", [
        [0, delay ? 0 : 1],
        [delay + 0.15, 1],
        [9.3, 1, "hold"],
        [10, 0],
      ]);
      if (lineIndex === 0) {
        phrase(
          doc,
          `scene${index + 1}-phrase`,
          id,
          title.start,
          title.start + 10,
          title.start + delay + 1.1,
          title.start + delay + 1.5,
          title.start + 9.7,
        );
        reading(doc, `${id}-reading`, title.start + delay + 1.5, title.start + 9.3, [id]);
      } else reading(doc, `${id}-reading`, title.start + delay + 1.8, title.start + 9.3, [id]);
    }
  add(
    doc,
    "signal-orb",
    "showcase-disc@1",
    "signal",
    0,
    10,
    { width: 32, height: 32, fill: colors.orange },
    "geometry",
    492,
    257,
  );
  curve(doc, "signal-orb", "x", [
    [0, 452],
    [1.2, 492],
    [8.6, 492, "hold"],
    [10, 512],
  ]);
  curve(doc, "signal-orb", "scaleX", [
    [0, 0],
    [0.6, 1.15],
    [1, 1],
    [8.6, 1],
    [10, 1],
  ]);
  curve(doc, "signal-orb", "scaleY", [
    [0, 0],
    [0.6, 1.15],
    [1, 1],
    [8.6, 1],
    [10, 1],
  ]);
  add(
    doc,
    "material-orb",
    "showcase-disc@1",
    "material",
    0,
    10,
    { width: 32, height: 32, fill: colors.orange },
    "details",
    512,
    257,
  );
  curve(
    doc,
    "material-orb",
    "x",
    [
      [0, 512],
      [1.2, 600],
    ],
    "material-handoff",
  );
  curve(doc, "material-orb", "y", [[0, 257]], "material-handoff");
  curve(doc, "material-orb", "opacity", [
    [0, 1],
    [0.6, 1],
    [1.4, 0],
  ]);
  curve(doc, "material-orb", "scaleX", [
    [0, 1],
    [1.2, 7],
  ]);
  curve(doc, "material-orb", "scaleY", [
    [0, 1],
    [1.2, 7],
  ]);
  const video = path.join(folder, "assets/material.mp4");
  await mkdir(path.dirname(video), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "nullsrc=size=640x360:rate=30:duration=10,geq=r='18+10*sin(X/90+N/60)':g='34+20*sin(Y/120+N/90)':b='35+22*sin((X+Y)/140+N/70)'",
    "-vf",
    "drawgrid=width=80:height=60:thickness=1:color=0xaddac1@0.14",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    video,
  ]);
  doc.assets.material = {
    kind: "video",
    logicalPath: "assets/material.mp4",
    sha256: digest(await readFile(video)),
  };
  add(
    doc,
    "material-video",
    "video",
    "material",
    0,
    10,
    { assetId: "material", width: 640, height: 360 },
    "media",
  );
  doc.mediaClips["material-video"] = {
    assetId: "material",
    sourceIn: 0,
    sourceOut: tick(10),
    rate: { num: 1, den: 1 },
    gain: 0,
  };
  curve(doc, "material-video", "clipProgress", [
    [0, 0],
    [0.35, 0],
    [1.6, 1],
  ]);
  curve(doc, "material-video", "opacity", [
    [0, 0.8],
    [9.2, 0.8],
    [10, 0],
  ]);
  for (let i = 0; i < 3; i++) {
    rect(
      doc,
      `reply-${i}`,
      "continuation",
      0,
      10,
      48 + i * 30,
      265,
      12,
      12,
      i === 0 ? colors.ink : "#98a99c",
    );
    curve(doc, `reply-${i}`, "x", [
      [0, -32 - i * 15],
      [0.4 + i * 0.22, 48 + i * 30 + 8],
      [0.9 + i * 0.22, 48 + i * 30],
      [10, 48 + i * 30],
    ]);
  }
  text(doc, "ending", "continuation", 0, 10, "다음 장면을 위한 여백", 48, 292, 12, "#6b7e70");
  curve(doc, "ending", "opacity", [
    [0, 0],
    [2.5, 0],
    [3.6, 1],
  ]);
  doc.score.handoffs.push({
    id: "material-handoff",
    fromTarget: "signal-orb",
    toTarget: "material-orb",
    at: tick(10),
    mode: "match-cut",
    preserve: ["position"],
  });
  reading(doc, "mixed-final-hold", 23.6, 30, ["scene3-line1", "scene3-line2", "ending"], "closure");
  await assets(doc, folder, 30, [0.6, 9.8, 10.6, 12.5, 20.6, 21.3, 27.6]);
  return doc;
}
export async function createShowcases(outputRoot = path.resolve("examples/showcase")) {
  const works = [
    {
      id: "hangul",
      seconds: 15,
      make: hangul,
      title: "사이의 리듬",
      intent:
        "Three Korean phrases alternate entry, reading, response and closure; text units preserve graphemes.",
    },
    {
      id: "slow-tension",
      seconds: 10,
      make: tension,
      title: "해소를 미룬 시간",
      intent:
        "A near-still disc approaches an anchor without resolving the final gap. Low speed and sustained tension are separate.",
    },
    {
      id: "mixed",
      seconds: 30,
      make: mixed,
      title: "작은 신호, 다른 재료",
      intent:
        "Three scenes combine React typography, custom HTML circles and grids, original video and a sparse generated soundtrack.",
    },
  ];
  const results = [];
  for (const work of works) {
    const folder = path.join(outputRoot, work.id);
    await mkdir(folder, { recursive: true });
    let doc = await work.make(folder);
    const planned = compileScore(doc);
    if (!planned.ok) throw new Error(`${work.id}: ${planned.error.code}: ${planned.error.message}`);
    const applied = applyTransaction(doc, planned.value);
    if (!applied.ok) throw new Error(`${work.id}: ${applied.error.message}`);
    doc = applied.value.document;
    doc.revision = 0;
    const compiled = compileProject(doc),
      score = validateScore(doc);
    if (!compiled.ok) throw new Error(compiled.error.message);
    if (!score.ok) throw new Error(score.error.message);
    const frames = frameCount(doc.settings.duration, doc.settings.fps);
    if (frames !== work.seconds * 30) throw new Error("Wrong frame count");
    const json = JSON.stringify(doc, null, 2) + "\n";
    if (json.includes("/Volumes/") || json.includes("/Users/"))
      throw new Error("Private path escaped into portable project");
    await writeFile(path.join(folder, "project.json"), json);
    await writeFile(
      path.join(folder, "README.md"),
      `# ${work.title}\n\n${work.intent}\n\n640 × 360 · 30 fps · ${work.seconds} seconds · ${frames} frames.\n\nGenerated by \`bunx tsx scripts/create-showcase.ts\`. All timing is deterministic. The video and soundtrack are original synthetic material. Noto Sans KR is included under SIL OFL 1.1; see assets/OFL.txt.\n\nThis folder is a portable working project with relative asset paths and bundled custom HTML source/artifacts.\n`,
    );
    results.push({
      id: work.id,
      title: work.title,
      project: `${work.id}/project.json`,
      frames,
      durationSeconds: work.seconds,
      sha256: digest(Buffer.from(json)),
    });
  }
  await writeFile(
    path.join(outputRoot, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, width: 640, height: 360, fps: 30, works: results }, null, 2) + "\n",
  );
  await writeFile(
    path.join(outputRoot, "README.md"),
    "# MotiFrame motion studies\n\nThree authored examples distinguish speed, tension and rhythm.\n\n- [사이의 리듬](hangul/project.json): 15 seconds of Hangul typography with long reading windows.\n- [해소를 미룬 시간](slow-tension/project.json): a 10-second intentional unresolved tension.\n- [작은 신호, 다른 재료](mixed/project.json): a 30-second React / HTML / video composition in three scenes.\n\nRegenerate with `bunx tsx scripts/create-showcase.ts`. Each working folder is portable.\n",
  );
  return results;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  createShowcases()
    .then((results) => process.stdout.write(JSON.stringify(results, null, 2) + "\n"))
    .catch((error) => {
      process.stderr.write(String(error) + "\n");
      process.exitCode = 1;
    });
