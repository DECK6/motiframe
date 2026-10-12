import { useEffect, useRef, useState } from "react";
import { compileProject } from "../../../../packages/core/src/compile";
import { evaluateCurve } from "../../../../packages/core/src/curves";
import { projectContentHash } from "../../../../packages/document/src/history";
import type { Result } from "../../../../packages/document/src/result";
import type { FrameReceipt } from "../../../../packages/stage/src/main";
import { isBrowserMode } from "../state/project-store";
import type { PanelProps } from "../types";
import { LatestFrameQueue } from "./latest-frame";
import { BrowserFrameRenderer } from "./offline-frame";

type Props = PanelProps & {
  setSelection: (ids: string[]) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
};
export default function StageViewport(props: Props) {
  const { document: doc, tick, selection, setSelection, zoom, setZoom } = props;
  const [frame, setFrame] = useState<{ image: string; receipt: FrameReceipt }>();
  const [browserRenderer, setBrowserRenderer] = useState<BrowserFrameRenderer>();
  const [error, setError] = useState("");
  const browser = isBrowserMode();
  const [pending, setPending] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const latest = useRef(props);
  latest.current = props;
  const queue = useRef<
    | LatestFrameQueue<
        { tick: number; revision: number; contentHash: string },
        Result<{ image: string; receipt: FrameReceipt }>
      >
    | undefined
  >(undefined);
  useEffect(() => {
    const host = area.current;
    if (!host) return;
    const observer = new ResizeObserver(() => setWidth(host.clientWidth));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (browser && !browserRenderer) return;
    queue.current = new LatestFrameQueue(
      (input) => {
        setPending(true);
        return browserRenderer
          ? browserRenderer.frame(input.tick, input.revision)
          : latest.current.api("frame", input);
      },
      (result, input) => {
        setPending(false);
        if (
          input.revision !== latest.current.document.revision ||
          input.contentHash !== projectContentHash(latest.current.document)
        )
          return;
        if (result.ok) {
          setFrame(result.value);
          setError("");
        } else if (result.error.code !== "REVISION_CONFLICT") {
          setFrame(undefined);
          setError(result.error.message);
        }
      },
    );
    queue.current.request({
      tick: latest.current.tick,
      revision: latest.current.document.revision,
      contentHash: projectContentHash(latest.current.document),
    });
    return () => queue.current?.dispose();
  }, [browser, browserRenderer]);
  useEffect(() => {
    queue.current?.request({ tick, revision: doc.revision, contentHash: projectContentHash(doc) });
  }, [doc, tick]);
  useEffect(() => {
    const changed = () =>
      queue.current?.request({
        tick: latest.current.tick,
        revision: latest.current.document.revision,
        contentHash: projectContentHash(latest.current.document),
      });
    window.addEventListener("motiframe-assets-changed", changed);
    return () => window.removeEventListener("motiframe-assets-changed", changed);
  }, []);
  const scale = Math.min((width - 80) / doc.settings.width, 450 / doc.settings.height) * zoom;
  const selected = selection[0];
  function start(event: React.PointerEvent<SVGRectElement>, id: string) {
    event.stopPropagation();
    if (doc.instances[id]?.locked || doc.tracks.find((t) => t.id === doc.instances[id]?.trackId)?.locked)
      return;
    const chosen = event.shiftKey
      ? [...new Set([...selection, id])]
      : selection.includes(id)
        ? selection
        : [id];
    setSelection(chosen);
    if (!props.editing) return;
    if (chosen.some((id) => doc.instances[id]?.parentId)) {
      props.notify("Use transform properties to adjust nested layers.");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY };
    const move = (e: PointerEvent) =>
      setGhost({ x: (e.clientX - origin.x) / scale, y: (e.clientY - origin.y) / scale });
    const end = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      setGhost(null);
      const dx = (e.clientX - origin.x) / scale,
        dy = (e.clientY - origin.y) / scale;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      const compiled = compileProject(doc);
      if (!compiled.ok) return;
      const commands = chosen.flatMap((instanceId) =>
        ["x", "y"].map((channel, index) => {
          const existing = Object.entries(doc.channels).find(
            ([, c]) =>
              c.target.instanceId === instanceId &&
              c.target.targetKey === "root" &&
              c.target.channel === channel,
          );
          const local = Math.max(0, tick - compiled.value.starts[instanceId]);
          const value = existing ? evaluateCurve(existing[1].keys, local) : { ok: true as const, value: 0 };
          const at = Math.round(local / (240000 / doc.settings.fps.num)) * (240000 / doc.settings.fps.num);
          const keyId = existing?.[1].keys.find((k) => k.at === at)?.id ?? crypto.randomUUID();
          return {
            type: "SetKeyframe" as const,
            channelId: existing?.[0] ?? `${instanceId}:root:${channel}`,
            target: { instanceId, targetKey: "root", channel },
            key: {
              id: keyId,
              at,
              value: (value.ok ? Number(value.value) : 0) + (index === 0 ? dx : dy),
              interpolation: "linear" as const,
            },
          };
        }),
      );
      void props.submit(commands);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  return (
    <div className="viewport-section">
      <div className="canvas-toolbar">
        <span className="badge">COMPOSITION</span>
        <span>
          {doc.settings.width} × {doc.settings.height}
        </span>
        <span>{doc.settings.fps.num} fps</span>
        <span className="canvas-tools">
          <button onClick={() => setZoom(Math.max(0.25, zoom - 0.25))} aria-label="Zoom out">
            −
          </button>
          <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="Zoom in">
            +
          </button>
        </span>
      </div>
      <div className="viewport" ref={area} onPointerDown={() => setSelection([])}>
        <div
          className="stage-image"
          style={{ width: doc.settings.width * scale, height: doc.settings.height * scale }}
        >
          {browser && (
            <iframe
              title="Motion preview"
              src="/stage.html"
              width={doc.settings.width}
              height={doc.settings.height}
              style={{
                border: 0,
                position: "absolute",
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
                pointerEvents: "none",
              }}
              onLoad={(event) => {
                const stage = event.currentTarget.contentWindow?.motiframe;
                if (stage) setBrowserRenderer(new BrowserFrameRenderer(stage));
              }}
            />
          )}
          {!browser && frame && <img src={frame.image} alt="Current motion frame" draggable={false} />}
          {(!frame || error) && <div className="stage-loading">{error || "Preparing frame…"}</div>}
          <svg
            className="selection-overlay"
            viewBox={`0 0 ${doc.settings.width} ${doc.settings.height}`}
            role="img"
            aria-label="Select motion layers"
          >
            {frame &&
              Object.entries(frame.receipt.targetBounds)
                .filter(([key, r]) => key.endsWith("/root") && r.width > 0 && r.height > 0)
                .map(([key, r]) => {
                  const id = key.slice(0, -5),
                    isSelected = selection.includes(id);
                  return (
                    <rect
                      key={key}
                      aria-label={`Canvas ${id}`}
                      data-instance={id}
                      x={r.x + (isSelected ? (ghost?.x ?? 0) : 0)}
                      y={r.y + (isSelected ? (ghost?.y ?? 0) : 0)}
                      width={r.width}
                      height={r.height}
                      fill="transparent"
                      stroke={isSelected ? "var(--cyan)" : "transparent"}
                      strokeWidth={2 / scale}
                      strokeDasharray={doc.instances[id]?.locked ? "6 6" : undefined}
                      onPointerDown={(e) => start(e, id)}
                    />
                  );
                })}
          </svg>
        </div>
      </div>
      <div className="canvas-status">
        <span className="status-dot" />{" "}
        {pending
          ? "Updating frame"
          : `FRAME ${Math.floor((tick * doc.settings.fps.num) / 240000)
              .toString()
              .padStart(4, "0")}`}
        <span>{selected ?? "Select a layer"}</span>
        <span className="muted">React + HTML · Shared clock</span>
      </div>
    </div>
  );
}
