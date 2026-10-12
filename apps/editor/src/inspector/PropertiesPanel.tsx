import { compileProject } from "../../../../packages/core/src/compile";
import { evaluateCurve } from "../../../../packages/core/src/curves";
import type { JsonValue } from "../../../../packages/document/src/schema";
import type { PanelProps } from "../types";
export default function PropertiesPanel(props: PanelProps) {
  const { document: doc, selection, tick } = props;
  const id = selection[0],
    instance = doc.instances[id];
  if (!instance) return <div className="empty-state">Select a layer on the canvas or timeline.</div>;
  const manifest = doc.definitions[instance.definitionId];
  const compiled = compileProject(doc);
  const at = Math.max(0, tick - (compiled.ok ? compiled.value.starts[id] : instance.start));
  const motion = (channel: string, value: number) => {
    const found = Object.entries(doc.channels).find(
      ([, c]) => c.target.instanceId === id && c.target.targetKey === "root" && c.target.channel === channel,
    );
    void props.submit([
      {
        type: "SetKeyframe",
        channelId: found?.[0] ?? `${id}:root:${channel}`,
        target: { instanceId: id, targetKey: "root", channel },
        key: {
          id: found?.[1].keys.find((k) => k.at === at)?.id ?? crypto.randomUUID(),
          at,
          value,
          interpolation: "linear",
        },
      },
    ]);
  };
  const value = (channel: string, fallback: number) => {
    const c = Object.values(doc.channels).find(
      (c) => c.target.instanceId === id && c.target.targetKey === "root" && c.target.channel === channel,
    );
    if (!c) return fallback;
    const r = evaluateCurve(c.keys, at);
    return r.ok ? Number(r.value) : fallback;
  };
  const schema = (manifest.propsSchema.properties ?? {}) as Record<string, { type?: string }>;
  const setProp = (key: string, value: JsonValue) => {
    void props.submit([{ type: "SetProps", instanceId: id, props: { [key]: value } }]);
  };
  return (
    <div className="panel-stack">
      <div className="inspector-title">
        <strong>{id}</strong>
        <span className="badge">{manifest.kind.toUpperCase()}</span>
        <button
          onClick={() => void props.submit([{ type: "SetLock", instanceId: id, locked: !instance.locked }])}
        >
          {instance.locked ? "Unlock" : "Lock"}
        </button>
      </div>
      <div className="section-label">
        TRANSFORM <span>Keyframe at playhead</span>
      </div>
      <div className="property-grid">
        {(["x", "y", "scaleX", "scaleY", "rotateZ", "opacity", "clipProgress"] as const).map((channel) => (
          <label key={`${id}-${channel}-${doc.revision}-${at}`}>
            <span>
              {
                (
                  {
                    x: "X",
                    y: "Y",
                    scaleX: "Scale X",
                    scaleY: "Scale Y",
                    rotateZ: "Rotation °",
                    opacity: "Opacity",
                    clipProgress: "Crop",
                  } as const
                )[channel]
              }
            </span>
            <input
              aria-label={channel}
              type="number"
              step={
                channel.includes("scale") || channel === "opacity" || channel === "clipProgress" ? 0.05 : 1
              }
              defaultValue={Number(
                value(channel, channel.startsWith("scale") || channel === "opacity" ? 1 : 0).toFixed(3),
              )}
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (
                  Number.isFinite(next) &&
                  next !== value(channel, channel.startsWith("scale") || channel === "opacity" ? 1 : 0)
                )
                  motion(channel, next);
              }}
            />
          </label>
        ))}
      </div>
      <div className="section-label">CONTENTS</div>
      {Object.entries(schema).map(([key, s]) => {
        const v = instance.props[key];
        if (!["string", "number", "boolean"].includes(s.type ?? "")) return null;
        return (
          <label key={`${id}-${key}-${doc.revision}`} className="property-field">
            <span>{key}</span>
            {key === "text" ? (
              <textarea
                aria-label="Text content"
                defaultValue={String(v ?? "")}
                rows={3}
                onBlur={(e) => {
                  if (e.target.value !== v) setProp(key, e.target.value);
                }}
              />
            ) : s.type === "boolean" ? (
              <input type="checkbox" checked={Boolean(v)} onChange={(e) => setProp(key, e.target.checked)} />
            ) : (
              <input
                aria-label={`Properties ${key}`}
                type={s.type === "number" ? "number" : key === "color" ? "color" : "text"}
                defaultValue={String(v ?? "")}
                onBlur={(e) => {
                  const next = s.type === "number" ? Number(e.target.value) : e.target.value;
                  if (next !== v) setProp(key, next);
                }}
              />
            )}
          </label>
        );
      })}
      <div className="section-label">CLIP</div>
      <div className="field-row">
        <label>
          Start (s)
          <input
            type="number"
            defaultValue={instance.start / 240000}
            key={`s${doc.revision}`}
            step={1 / doc.settings.fps.num}
            onBlur={(e) =>
              void props.submit([
                {
                  type: "MoveInstance",
                  instanceId: id,
                  start:
                    (Math.round(Number(e.target.value) * doc.settings.fps.num) * 240000) /
                    doc.settings.fps.num,
                },
              ])
            }
          />
        </label>
        <label>
          Duration (s)
          <input
            type="number"
            defaultValue={instance.duration / 240000}
            key={`d${doc.revision}`}
            step={1 / doc.settings.fps.num}
            onBlur={(e) =>
              void props.submit([
                {
                  type: "TrimClip",
                  instanceId: id,
                  start: instance.start,
                  duration:
                    (Math.round(Number(e.target.value) * doc.settings.fps.num) * 240000) /
                    doc.settings.fps.num,
                },
              ])
            }
          />
        </label>
      </div>
    </div>
  );
}
