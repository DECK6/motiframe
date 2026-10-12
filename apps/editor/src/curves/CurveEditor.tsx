import { useState } from "react";
import { compileProject } from "../../../../packages/core/src/compile";
import { setEndpointVelocity } from "../../../../packages/core/src/curve-handles";
import { evaluateCurve } from "../../../../packages/core/src/curves";
import type { Keyframe } from "../../../../packages/document/src/schema";
import type { PanelProps } from "../types";
export function sampleCurveGraph(
  keys: Keyframe[],
  duration: number,
  mode: "value" | "velocity",
  count = 97,
): { tick: number; value: number }[] {
  const samples: { tick: number; value: number }[] = [];
  if (count < 2 || duration <= 0) return samples;
  for (let i = 0; i < count; i++) {
    const tick = (duration * i) / (count - 1),
      start = mode === "velocity" ? Math.max(0, tick - 1) : tick,
      end = mode === "velocity" ? Math.min(duration, tick + 1) : tick;
    const a = evaluateCurve(keys, start),
      b = evaluateCurve(keys, end);
    if (!a.ok || !b.ok || typeof a.value !== "number" || typeof b.value !== "number") return [];
    samples.push({
      tick,
      value: mode === "velocity" ? ((b.value - a.value) * 240000) / (end - start) : a.value,
    });
  }
  return samples;
}
export function makeDraggedKey(
  key: Keyframe,
  tick: number,
  value: number,
  duration: number,
  frameTicks: number,
): Keyframe {
  return {
    ...key,
    at: Math.max(0, Math.min(duration, Math.round(tick / frameTicks) * frameTicks)),
    value: Math.round(value * 1000) / 1000,
  };
}
export default function CurveEditor({ document, selection, tick, submit, notify }: PanelProps) {
  const [channelId, setChannelId] = useState(""),
    [keyId, setKeyId] = useState(""),
    [mode, setMode] = useState<"value" | "velocity">("value"),
    [preview, setPreview] = useState<Keyframe | null>(null),
    [dragging, setDragging] = useState(false),
    [dragDomain, setDragDomain] = useState<{ min: number; max: number } | null>(null),
    [velocity, setVelocity] = useState(200),
    [influence, setInfluence] = useState(33),
    [side, setSide] = useState<"in" | "out">("out");
  const channels = Object.entries(document.channels).filter(([, c]) =>
    selection.includes(c.target.instanceId),
  );
  const selected = channels.find(([id]) => id === channelId) ?? channels[0];
  if (!selection.length)
    return (
      <div className="panel-stack">
        <p className="muted">Select a layer to edit its curves.</p>
      </div>
    );
  if (!selected)
    return (
      <div className="panel-stack">
        <p className="muted">This layer has no keyframe channels. Add its first key in Properties.</p>
      </div>
    );
  const [id, channel] = selected,
    instance = document.instances[channel.target.instanceId],
    keys = preview ? channel.keys.map((k) => (k.id === preview.id ? preview : k)) : channel.keys,
    key = keys.find((k) => k.id === keyId) ?? keys[0],
    numeric = keys.every((k) => typeof k.value === "number"),
    samples = numeric ? sampleCurveGraph(keys, instance.duration, mode) : [];
  const values = [
      ...samples.map((p) => p.value),
      ...(mode === "value"
        ? keys.filter((k) => typeof k.value === "number").map((k) => k.value as number)
        : []),
    ],
    low = Math.min(0, ...values),
    high = Math.max(1, ...values),
    pad = Math.max(1, (high - low) * 0.12),
    min = dragging && dragDomain ? dragDomain.min : low - pad,
    max = dragging && dragDomain ? dragDomain.max : high + pad;
  const width = 300,
    height = 160,
    x = (at: number) => 24 + (at / instance.duration) * 252,
    y = (value: number) => 136 - ((value - min) / (max - min)) * 112,
    frameTicks = 240000 / document.settings.fps.num;
  const write = (next: Keyframe) => submit([{ type: "SetKeyframe", channelId: id, key: next }]);
  const compiled = compileProject(document),
    local = tick - (compiled.ok ? compiled.value.starts[channel.target.instanceId] : instance.start);
  const add = () => {
    const at = Math.max(0, Math.min(instance.duration, Math.round(local / frameTicks) * frameTicks));
    if (channel.keys.some((k) => k.at === at)) {
      notify("A key already exists at the playhead.");
      return;
    }
    const value = evaluateCurve(channel.keys, at);
    if (!value.ok) {
      notify(value.error.message);
      return;
    }
    void write({
      id: `${id}:key:${document.revision}:${at}`,
      at,
      value: value.value,
      interpolation: typeof value.value === "number" ? "linear" : "hold",
    });
  };
  const applyVelocity = () => {
    const updated = setEndpointVelocity(channel.keys, key.id, side, velocity, influence / 100);
    if (!updated.ok) {
      notify(updated.error.message);
      return;
    }
    void submit(
      updated.value
        .filter((k) => JSON.stringify(k) !== JSON.stringify(channel.keys.find((old) => old.id === k.id)))
        .map((k) => ({ type: "SetKeyframe", channelId: id, key: k })),
    );
  };
  return (
    <div className="panel-stack">
      <div className="field-row">
        <label htmlFor="curve-channel">Channel</label>
        <select
          id="curve-channel"
          value={id}
          onChange={(e) => {
            setChannelId(e.target.value);
            setKeyId("");
            setPreview(null);
          }}
        >
          {channels.map(([channelKey, c]) => (
            <option key={channelKey} value={channelKey}>
              {c.target.instanceId} · {c.target.targetKey} / {c.target.channel}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <button type="button" aria-pressed={mode === "value"} onClick={() => setMode("value")}>
          Value graph
        </button>
        <button type="button" aria-pressed={mode === "velocity"} onClick={() => setMode("velocity")}>
          Velocity graph
        </button>
        <span className="badge">
          {channel.owner === "manual" ? "Manual" : "Recipe"}
          {channel.locked ? " · Locked" : ""}
        </span>
      </div>
      {numeric ? (
        <svg
          className="curve-display"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${channel.target.channel} ${mode === "value" ? "value" : "velocity"} curve`}
          style={{ width: "100%", touchAction: "none", borderRadius: 8 }}
          onPointerMove={(e) => {
            if (!dragging || !key || mode !== "value") return;
            const rect = e.currentTarget.getBoundingClientRect(),
              px = ((e.clientX - rect.left) / rect.width) * width,
              py = ((e.clientY - rect.top) / rect.height) * height;
            setPreview(
              makeDraggedKey(
                key,
                ((px - 24) / 252) * instance.duration,
                min + ((136 - py) / 112) * (max - min),
                instance.duration,
                frameTicks,
              ),
            );
          }}
          onPointerUp={() => {
            setDragging(false);
            if (preview) void write(preview);
            setPreview(null);
          }}
          onPointerCancel={() => {
            setDragging(false);
            setPreview(null);
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={24 + 252 * f}
              y1={16}
              x2={24 + 252 * f}
              y2={136}
              stroke="currentColor"
              opacity=".12"
            />
          ))}
          <line x1={24} y1={y(0)} x2={276} y2={y(0)} stroke="currentColor" opacity=".25" />
          <polyline
            points={samples.map((p) => `${x(p.tick)},${y(p.value)}`).join(" ")}
            fill="none"
            stroke="var(--cyan)"
            strokeWidth="2"
          />
          {mode === "value" &&
            keys.map((k) => (
              <circle
                key={k.id}
                cx={x(k.at)}
                cy={y(k.value as number)}
                r={k.id === key?.id ? 5 : 3.5}
                fill={k.id === key?.id ? "var(--display-text)" : "var(--cyan)"}
                tabIndex={0}
                role="button"
                aria-label={`Key ${(k.at / 240000).toFixed(3)}s value ${k.value}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setKeyId(k.id);
                  setPreview(k);
                  setDragDomain({ min, max });
                  setDragging(true);
                  e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    void write(
                      makeDraggedKey(
                        k,
                        k.at + (e.key === "ArrowRight" ? frameTicks : -frameTicks),
                        k.value as number,
                        instance.duration,
                        frameTicks,
                      ),
                    );
                  }
                }}
              />
            ))}
          <text x={24} y={153} fill="currentColor" fontSize="9">
            0s
          </text>
          <text x={276} y={153} textAnchor="end" fill="currentColor" fontSize="9">
            {(instance.duration / 240000).toFixed(2)}s
          </text>
          <text x={24} y={11} fill="currentColor" fontSize="9">
            {max.toFixed(1)}
            {mode === "velocity" ? " /s" : ""}
          </text>
        </svg>
      ) : (
        <p className="muted">Text channels support hold interpolation.</p>
      )}
      <p className="muted">
        {mode === "velocity"
          ? "Velocity is measured in channel units per second, independently of projected screen speed."
          : "Drag a key or enter its value. Dragged keys snap to output frames."}
      </p>
      <div className="field-row">
        <label htmlFor="curve-key">Key</label>
        <select id="curve-key" value={key?.id ?? ""} onChange={(e) => setKeyId(e.target.value)}>
          {channel.keys.map((k) => (
            <option key={k.id} value={k.id}>
              {(k.at / 240000).toFixed(3)}s · {String(k.value)}
            </option>
          ))}
        </select>
        <button type="button" onClick={add}>
          Add at playhead
        </button>
      </div>
      {key && (
        <>
          <div className="field-row">
            <label>
              Time (s)
              <input
                aria-label="Key time (s)"
                key={`${document.revision}:${key.id}:time`}
                type="number"
                min="0"
                max={instance.duration / 240000}
                step={1 / document.settings.fps.num}
                defaultValue={key.at / 240000}
                onBlur={(e) => {
                  const at = Math.round(Number(e.target.value) * 240000);
                  if (at !== key.at) void write({ ...key, at });
                }}
              />
            </label>
            <label>
              Value
              <input
                aria-label="Key value"
                key={`${document.revision}:${key.id}:value`}
                type={numeric ? "number" : "text"}
                defaultValue={typeof key.value === "object" ? JSON.stringify(key.value) : String(key.value)}
                onBlur={(e) => {
                  const value = numeric ? Number(e.target.value) : e.target.value;
                  if (value !== key.value) void write({ ...key, value });
                }}
              />
            </label>
          </div>
          <div className="field-row">
            <label htmlFor="curve-interpolation">Interpolation</label>
            <select
              id="curve-interpolation"
              value={key.interpolation}
              onChange={(e) =>
                void write({ ...key, interpolation: e.target.value as Keyframe["interpolation"] })
              }
            >
              <option value="hold">Hold · still</option>
              {numeric && (
                <>
                  <option value="linear">Linear · constant speed</option>
                  <option value="cubic">Cubic · curved</option>
                </>
              )}
            </select>
            <button
              type="button"
              onClick={() => void submit([{ type: "RemoveKeyframe", channelId: id, keyId: key.id }])}
            >
              Remove key
            </button>
          </div>
          {numeric && (
            <div className="card">
              <div className="field-row">
                <strong>Endpoint velocity</strong>
                <select
                  aria-label="Handle side"
                  value={side}
                  onChange={(e) => setSide(e.target.value as "in" | "out")}
                >
                  <option value="out">Outgoing</option>
                  <option value="in">Incoming</option>
                </select>
              </div>
              <div className="field-row">
                <label>
                  Value/s
                  <input
                    type="number"
                    aria-label="Endpoint velocity"
                    value={velocity}
                    onChange={(e) => setVelocity(Number(e.target.value))}
                  />
                </label>
                <label>
                  Influence (%)
                  <input
                    type="number"
                    aria-label="Velocity influence"
                    min="1"
                    max="100"
                    value={influence}
                    onChange={(e) => setInfluence(Number(e.target.value))}
                  />
                </label>
              </div>
              <button type="button" onClick={applyVelocity}>
                Apply velocity
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
