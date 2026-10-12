import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyTransaction, projectContentHash } from "../../packages/document/src/apply";
import type { EditCommand, EditTransaction } from "../../packages/document/src/commands";
import { commitHistory, createHistory, redo, undo } from "../../packages/document/src/history";
import type { ProjectDocument } from "../../packages/document/src/schema";
import { expectOk } from "../helpers/result";

const fixture = (): ProjectDocument =>
  JSON.parse(readFileSync("tests/fixtures/mixed-static/project.json", "utf8"));
const tx = (doc: ProjectDocument, commands: EditCommand[]): EditTransaction => ({
  id: "edit",
  baseRevision: doc.revision,
  author: "user",
  scope: {
    instanceIds: Object.keys(doc.instances),
    range: { start: 0, end: doc.settings.duration },
    preserveDuration: true,
    ripple: false,
  },
  commands,
});
describe("atomic immutable document edits", () => {
  it("rejects locked participants without mutating any original data", () => {
    const doc = fixture();
    doc.instances.blue.locked = true;
    const old = structuredClone(doc);
    const result = applyTransaction(
      doc,
      tx(doc, [
        { type: "MoveInstance", instanceId: "red", start: 8000 },
        { type: "MoveInstance", instanceId: "blue", start: 8000 },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(doc).toEqual(old);
  });
  it("rejects stale revision, scope escape and cycles", () => {
    const doc = fixture();
    const stale = tx(doc, []);
    stale.baseRevision = 3;
    expect(applyTransaction(doc, stale)).toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT" } });
    const scoped = tx(doc, [{ type: "SetProps", instanceId: "blue", props: { color: "green" } }]);
    scoped.scope.instanceIds = ["red"];
    expect(applyTransaction(doc, scoped).ok).toBe(false);
    expect(
      applyTransaction(
        doc,
        tx(doc, [
          { type: "MoveInstance", instanceId: "red", start: 0, parentId: "blue" },
          { type: "MoveInstance", instanceId: "blue", start: 0, parentId: "red" },
        ]),
      ).ok,
    ).toBe(false);
  });
  it("undo and redo restore content with monotonically increasing revisions", () => {
    const doc = fixture();
    const old = projectContentHash(doc);
    const applied = expectOk(
      commitHistory(
        createHistory(doc),
        tx(doc, [{ type: "SetProps", instanceId: "red", props: { color: "green" } }]),
      ),
    );
    const back = expectOk(undo(applied));
    expect(projectContentHash(back.document)).toBe(old);
    expect(back.document.revision).toBe(2);
    const forward = expectOk(redo(back));
    expect(projectContentHash(forward.document)).toBe(projectContentHash(applied.document));
    expect(forward.document.revision).toBe(3);
  });
  it("coalesces a gesture into one undo entry and clears a redo branch", () => {
    const doc = fixture();
    let state = createHistory(doc);
    for (let i = 0; i < 50; i++)
      state = expectOk(
        commitHistory(state, tx(state.document, [{ type: "SetProps", instanceId: "red", props: { x: i } }]), {
          gestureId: "drag",
        }),
      );
    expect(state.past).toHaveLength(1);
    state = expectOk(undo(state));
    expect(projectContentHash(state.document)).toBe(projectContentHash(doc));
    state = expectOk(
      commitHistory(state, tx(state.document, [{ type: "SetProps", instanceId: "red", props: { x: 12 } }])),
    );
    expect(state.future).toHaveLength(0);
  });
  it("protects manual channels from recipes and records ownership transfer", () => {
    const doc = fixture();
    const edit = tx(doc, [
      {
        type: "SetKeyframe",
        channelId: "red:root:x",
        key: { id: "red-x", at: 0, value: 60, interpolation: "hold" },
      },
    ]);
    edit.author = "recipe";
    expect(applyTransaction(doc, edit)).toMatchObject({ ok: false, error: { code: "OWNERSHIP_CONFLICT" } });
    const result = expectOk(
      applyTransaction(
        doc,
        tx(doc, [{ type: "SetChannelOwner", channelId: "red:root:x", owner: "recipe", recipeId: "a" }]),
      ),
    );
    expect(result.document.channels["red:root:x"].owner).toBe("recipe");
    expect(doc.channels["red:root:x"].owner).toBe("manual");
  });
  it("rejects malformed values and allows endpoints exactly at duration", () => {
    const doc = fixture();
    expect(applyTransaction(doc, tx(doc, [{ type: "MoveInstance", instanceId: "red", start: -1 }])).ok).toBe(
      false,
    );
    expect(
      applyTransaction(
        doc,
        tx(doc, [
          {
            type: "SetKeyframe",
            channelId: "red:root:x",
            key: { id: "end", at: doc.instances.red.duration, value: 100, interpolation: "hold" },
          },
        ]),
      ).ok,
    ).toBe(true);
    expect(
      applyTransaction(
        doc,
        tx(doc, [
          {
            type: "SetKeyframe",
            channelId: "red:root:x",
            key: { id: "end", at: doc.instances.red.duration + 1, value: 100, interpolation: "hold" },
          },
        ]),
      ).ok,
    ).toBe(false);
  });
});
it("enforces score edit scope and preserves locked score actors", () => {
  const doc = fixture();
  const change = tx(doc, [
    {
      type: "UpdateScore",
      score: {
        windows: [{ id: "w", range: { start: 0, end: 240000 }, targetIds: ["blue"], role: "reading" }],
      },
    },
  ]);
  change.scope.instanceIds = ["red"];
  expect(applyTransaction(doc, change)).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
  change.scope.instanceIds = ["blue"];
  doc.instances.blue.locked = true;
  expect(applyTransaction(doc, change)).toMatchObject({ ok: false, error: { code: "LOCKED" } });
});
it("enforces reference appliedRange and instance scope", () => {
  const doc = fixture();
  const change = tx(doc, [
    {
      type: "SetReference",
      reference: {
        id: "ref",
        snapshotHash: "hash",
        conceptIds: ["curve"],
        instanceIds: ["blue"],
        appliedRange: { start: 0, end: 240000 },
      },
    },
  ]);
  change.scope.instanceIds = ["red"];
  expect(applyTransaction(doc, change)).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
});
it("rejects edits below a locked ancestor", () => {
  const doc = fixture();
  doc.definitions.red.slots = [{ id: "body" }];
  doc.instances.red.locked = true;
  doc.instances.blue.parentId = "red";
  doc.instances.blue.slotId = "body";
  doc.scenes.main.rootIds = ["red"];
  expect(
    applyTransaction(doc, tx(doc, [{ type: "SetProps", instanceId: "blue", props: { color: "green" } }])),
  ).toMatchObject({ ok: false, error: { code: "LOCKED" } });
});
it("mutes only authorized unlocked tracks", () => {
  const doc = fixture();
  const muted = expectOk(
    applyTransaction(doc, tx(doc, [{ type: "SetTrackMuted", trackId: "red-track", muted: true }])),
  ).document;
  expect(muted.tracks[0].muted).toBe(true);
  expect(doc.tracks[0].muted).toBe(false);
  const escaped = tx(doc, [{ type: "SetTrackMuted", trackId: "blue-track", muted: true }]);
  escaped.scope.instanceIds = ["red"];
  expect(applyTransaction(doc, escaped)).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
  doc.tracks[0].locked = true;
  expect(
    applyTransaction(doc, tx(doc, [{ type: "SetTrackMuted", trackId: "red-track", muted: true }])).ok,
  ).toBe(false);
});
it("registers assets through full-project user transactions and refuses overwrite", () => {
  const doc = fixture();
  const command: EditCommand = {
    type: "RegisterAsset",
    assetId: "a",
    asset: { sha256: "abc", kind: "image", logicalPath: "assets/abc.png" },
  };
  const updated = expectOk(applyTransaction(doc, tx(doc, [command]))).document;
  expect(updated.assets.a).toEqual(command.asset);
  expect(doc.assets.a).toBeUndefined();
  expect(
    applyTransaction(updated, tx(updated, [{ ...command, asset: { sha256: "other", kind: "image" } }])).ok,
  ).toBe(false);
  const untrusted = tx(doc, [command]);
  untrusted.author = "agent";
  expect(applyTransaction(doc, untrusted)).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
});
it("updates project settings with explicit whole-document duration permission", () => {
  const doc = fixture();
  expect(
    expectOk(applyTransaction(doc, tx(doc, [{ type: "UpdateSettings", settings: { width: 640 } }]))).document
      .settings.width,
  ).toBe(640);
  expect(
    applyTransaction(doc, tx(doc, [{ type: "UpdateSettings", settings: { duration: 2000000 } }])),
  ).toMatchObject({ ok: false, error: { code: "DURATION_CONFLICT" } });
  const allowed = tx(doc, [{ type: "UpdateSettings", settings: { duration: 2000000 } }]);
  allowed.scope.preserveDuration = false;
  allowed.scope.range.end = 2000000;
  expect(expectOk(applyTransaction(doc, allowed)).document.settings.duration).toBe(2000000);
  const untrusted = tx(doc, [{ type: "UpdateSettings", settings: { width: 640 } }]);
  untrusted.author = "agent";
  expect(applyTransaction(doc, untrusted).ok).toBe(false);
});
it("normalizes malformed untrusted transaction inputs to Result errors", () => {
  const doc = fixture();
  for (const bad of [
    null,
    {},
    { ...tx(doc, []), commands: [null] },
    { ...tx(doc, []), scope: null },
    { ...tx(doc, []), commands: [{ type: "SetKeyframe" }] },
  ])
    expect(applyTransaction(doc, bad as EditTransaction).ok).toBe(false);
});
it("rejects unknown fields and command shapes at the public boundary", () => {
  const doc = fixture();
  const unknown = tx(doc, []) as unknown as { commands: unknown[] };
  unknown.commands = [{ type: "UpdateSettings", settings: { width: 640, unsafe: true } }];
  expect(applyTransaction(doc, unknown as EditTransaction)).toMatchObject({
    ok: false,
    error: { code: "INVALID_TRANSACTION" },
  });
  expect(
    applyTransaction(doc, {
      ...tx(doc, []),
      commands: [{ type: "NotACommand" }],
    } as unknown as EditTransaction),
  ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSACTION" } });
});
it("attaches media atomically with asset registration and rejects invalid source mappings", () => {
  const doc = fixture();
  const clip = { assetId: "video", sourceIn: 240000, sourceOut: 1680000, rate: { num: 1, den: 1 }, gain: 1 };
  const registered = expectOk(
    applyTransaction(
      doc,
      tx(doc, [
        { type: "RegisterAsset", assetId: "video", asset: { kind: "video", sha256: "hash" } },
        { type: "SetMediaClip", instanceId: "red", clip },
      ]),
    ),
  ).document;
  expect(registered.mediaClips.red).toEqual(clip);
  expect(doc.mediaClips.red).toBeUndefined();
  for (const invalid of [
    { ...clip, sourceOut: clip.sourceIn },
    { ...clip, rate: { num: 1, den: 0 } },
    { ...clip, assetId: "missing" },
    { ...clip, gain: -1 },
    { ...clip, sourceOut: 480000 },
  ])
    expect(
      applyTransaction(
        registered,
        tx(registered, [{ type: "SetMediaClip", instanceId: "red", clip: invalid }]),
      ).ok,
    ).toBe(false);
});
it("rejects creation under a locked parent and moving a parent outside descendant scope", () => {
  const doc = fixture();
  doc.definitions.red.slots = [{ id: "body" }];
  doc.instances.red.locked = true;
  const newInstance = { ...doc.instances.blue, parentId: "red", slotId: "body" };
  const addition = tx(doc, [{ type: "AddInstance", instanceId: "child", instance: newInstance }]);
  addition.scope.instanceIds.push("child");
  expect(applyTransaction(doc, addition)).toMatchObject({ ok: false, error: { code: "LOCKED" } });
  doc.instances.red.locked = false;
  doc.instances.blue.parentId = "red";
  doc.instances.blue.slotId = "body";
  doc.scenes.main.rootIds = ["red"];
  const move = tx(doc, [{ type: "MoveInstance", instanceId: "red", start: 0 }]);
  move.scope.instanceIds = ["red"];
  expect(applyTransaction(doc, move)).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
});
it("checks the existing reference scope on replacement and removal", () => {
  const doc = fixture();
  doc.references = [
    { id: "r", snapshotHash: "s", instanceIds: ["blue"], appliedRange: { start: 0, end: 240000 } },
  ];
  for (const command of [
    { type: "SetReference", reference: { id: "r" }, remove: true },
    {
      type: "SetReference",
      reference: {
        id: "r",
        snapshotHash: "s2",
        instanceIds: ["red"],
        appliedRange: { start: 0, end: 240000 },
      },
    },
  ] as EditCommand[]) {
    const scoped = tx(doc, [command]);
    scoped.scope.instanceIds = ["red"];
    expect(applyTransaction(doc, scoped)).toMatchObject({ ok: false, error: { code: "SCOPE_CONFLICT" } });
  }
});
