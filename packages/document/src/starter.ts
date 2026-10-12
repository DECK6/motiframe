import type { Channel, ElementManifest, Instance, ProjectDocument } from "./schema";
export function createStarterProject(id = "untitled"): ProjectDocument {
  const duration = 3600000;
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
    "props.text",
  ];
  const define = (
    id: string,
    kind: "react" | "html",
    moduleHash: string,
    propsSchema: ElementManifest["propsSchema"],
  ): ElementManifest => ({
    id,
    revision: 1,
    kind,
    moduleHash,
    propsSchema: { type: "object", properties: propsSchema },
    targets: [{ key: "root", channels, coordinateSpace: "local" }],
    slots: [],
    assets: [],
  });
  const number = { type: "number" },
    string = { type: "string" };
  const definitions = {
    title: define("title", "react", "builtin:react-text", {
      text: string,
      fontSize: number,
      fontWeight: number,
      fontFamily: string,
      color: string,
      width: number,
      height: number,
    }),
    shape: define("shape", "html", "builtin:html-rect", { color: string, width: number, height: number }),
    video: define("video", "html", "builtin:media", { width: number, height: number, assetId: string }),
    audio: define("audio", "html", "builtin:audio", {}),
  };
  const instance = (definitionId: string, trackId: string, props: Instance["props"]): Instance => ({
    definitionId,
    definitionRevision: 1,
    trackId,
    parentId: null,
    slotId: null,
    start: 0,
    duration,
    props,
    locked: false,
  });
  const doc: ProjectDocument = {
    schemaVersion: 1,
    id,
    revision: 0,
    settings: {
      width: 1280,
      height: 720,
      fps: { num: 30, den: 1 },
      duration,
      ticksPerSecond: 240000,
      seed: 42,
      colorSpace: "srgb",
      sampleRate: 48000,
    },
    definitions,
    scenes: { main: { start: 0, duration, rootIds: ["background", "accent", "title"] } },
    instances: {
      background: instance("shape", "background", { width: 1280, height: 720, color: "#111412" }),
      accent: instance("shape", "graphics", { width: 10, height: 100, color: "#bcf77b" }),
      title: instance("title", "type", {
        text: "모션에 리듬을.",
        fontSize: 84,
        fontWeight: 700,
        fontFamily: "MotiFrame Sans",
        width: 1050,
        height: 220,
        color: "#f3f3e9",
      }),
    },
    tracks: [
      { id: "background", kind: "graphics", instanceIds: ["background"], locked: false, muted: false },
      { id: "graphics", kind: "graphics", instanceIds: ["accent"], locked: false, muted: false },
      { id: "type", kind: "graphics", instanceIds: ["title"], locked: false, muted: false },
      { id: "video", kind: "video", instanceIds: [], locked: false, muted: false },
      { id: "audio", kind: "audio", instanceIds: [], locked: false, muted: false },
    ],
    channels: {},
    assets: {},
    mediaClips: {},
    score: { phrases: [], events: [], windows: [], tensions: [], handoffs: [] },
    references: [],
    provenance: { runtime: "0.1.0", sdk: "0.1.0", sources: [] },
  };
  const set = (id: string, name: string, keys: Channel["keys"]) => {
    doc.channels[`${id}:root:${name}`] = {
      target: { instanceId: id, targetKey: "root", channel: name },
      owner: "manual",
      locked: false,
      keys,
    };
  };
  const key = (id: string, at: number, value: number | string): Channel["keys"][number] => ({
    id,
    at,
    value,
    interpolation: typeof value === "string" ? "hold" : "linear",
  });
  set("title", "x", [
    key("tx0", 0, 155),
    key("tx1", 240000, 115),
    key("tx2", 720000, 115),
    key("tx3", 960000, 155),
  ]);
  set("title", "y", [key("ty", 0, 285)]);
  set("title", "opacity", [key("to0", 0, 0), key("to1", 160000, 1)]);
  set("title", "props.text", [
    key("tt0", 0, "모션에 리듬을."),
    key("tt1", 1200000, "긴장은 속도가 아니다."),
    key("tt2", 2400000, "MotiFrame"),
  ]);
  set("accent", "x", [key("ax", 0, 75)]);
  set("accent", "y", [key("ay", 0, 285)]);
  set("accent", "scaleY", [
    key("as0", 0, 0),
    key("as1", 160000, 1),
    key("as2", 640000, 1),
    key("as3", 800000, 0.2),
    key("as4", 960000, 1),
  ]);
  return doc;
}
