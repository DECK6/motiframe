import { useState } from "react";
import { compileProject } from "../../../../packages/core/src/compile";
import type { PanelProps } from "../types";

type Props = PanelProps & { setSelection: (ids: string[]) => void; onTick: (tick: number) => void };
export default function Timeline(props: Props) {
  const { document: doc, tick, selection } = props;
  const [pps, setPps] = useState(75);
  const compiled = compileProject(doc);
  const total = doc.settings.duration / 240000,
    width = Math.max(total * pps, 800);
  const snap = (time: number) => (Math.round(time * doc.settings.fps.num) * 240000) / doc.settings.fps.num;
  function scrub(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    props.onTick(
      Math.max(
        0,
        Math.min(
          doc.settings.duration - 240000 / doc.settings.fps.num,
          snap((event.clientX - rect.left) / pps),
        ),
      ),
    );
  }
  function drag(event: React.PointerEvent, instanceId: string, edge?: "start" | "end") {
    event.stopPropagation();
    const instance = doc.instances[instanceId];
    props.setSelection(event.shiftKey ? [...new Set([...selection, instanceId])] : [instanceId]);
    if (!props.editing) return;
    if (instance.locked || doc.tracks.find((t) => t.id === instance.trackId)?.locked) return;
    props.setSelection(event.shiftKey ? [...new Set([...selection, instanceId])] : [instanceId]);
    const initial = event.clientX;
    const element = event.currentTarget.closest<HTMLElement>(".timeline-clip");
    if (!element) return;
    const end = (e: PointerEvent) => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointermove", move);
      element.style.transform = "";
      const delta = snap((e.clientX - initial) / pps);
      if (!delta) return;
      if (edge === "start")
        void props.submit([
          {
            type: "TrimClip",
            instanceId,
            start: Math.max(0, instance.start + delta),
            duration: instance.duration - delta,
          },
        ]);
      else if (edge === "end")
        void props.submit([
          {
            type: "TrimClip",
            instanceId,
            start: instance.start,
            duration: Math.max(240000 / doc.settings.fps.num, instance.duration + delta),
          },
        ]);
      else
        void props.submit([{ type: "MoveInstance", instanceId, start: Math.max(0, instance.start + delta) }]);
    };
    const move = (e: PointerEvent) => {
      if (!edge) element.style.transform = `translateX(${e.clientX - initial}px)`;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  const split = () =>
    void props.submit(
      selection.map((instanceId) => ({
        type: "SplitClip",
        instanceId,
        at: tick,
        newInstanceId: `${instanceId}-${crypto.randomUUID().slice(0, 6)}`,
      })),
    );
  return (
    <section className="timeline">
      <div className="timeline-toolbar">
        <strong>TIMELINE</strong>
        <span className="muted">{doc.tracks.length} tracks</span>
        {props.editing && (
          <>
            <button onClick={split} disabled={!selection.length}>
              Split <kbd>S</kbd>
            </button>
            <button
              disabled={!selection.length}
              onClick={() =>
                void props.submit(
                  selection.map((instanceId) => ({
                    type: "DuplicateInstance",
                    instanceId,
                    newInstanceId: `${instanceId}-copy-${crypto.randomUUID().slice(0, 4)}`,
                  })),
                )
              }
            >
              Duplicate
            </button>
            <button
              disabled={!selection.length}
              onClick={() =>
                void props.submit(selection.map((instanceId) => ({ type: "RemoveInstance", instanceId })))
              }
            >
              Remove
            </button>
          </>
        )}
        <label className="timeline-zoom">
          Zoom{" "}
          <input
            aria-label="Timeline zoom"
            type="range"
            min="25"
            max="180"
            value={pps}
            onChange={(e) => setPps(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="timeline-body">
        <div className="track-headers">
          <div className="ruler-header">Layers / Tracks</div>
          {[...doc.tracks].reverse().map((track) => (
            <div className="track-header" key={track.id}>
              <span className={`track-dot ${track.kind}`} />
              <span>{track.id}</span>
              <button
                disabled={!props.editing}
                aria-label={`${track.id} mute`}
                className={track.muted ? "is-active" : ""}
                onClick={() =>
                  void props.submit([{ type: "SetTrackMuted", trackId: track.id, muted: !track.muted }])
                }
              >
                {track.muted ? "○" : "●"}
              </button>
              <button
                disabled={!props.editing}
                aria-label={`${track.id} Lock`}
                onClick={() =>
                  void props.submit([{ type: "SetLock", trackId: track.id, locked: !track.locked }])
                }
              >
                {track.locked ? "▣" : "◇"}
              </button>
              <button
                disabled={!props.editing}
                aria-label={`${track.id} move up`}
                onClick={() =>
                  void props.submit([
                    {
                      type: "ReorderTrack",
                      trackId: track.id,
                      index: Math.min(
                        doc.tracks.length - 1,
                        doc.tracks.findIndex((t) => t.id === track.id) + 1,
                      ),
                    },
                  ])
                }
              >
                ↑
              </button>
            </div>
          ))}
        </div>
        <div className="timeline-scroll">
          <div className="time-content" style={{ width }}>
            <div
              className="time-ruler"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                window.getSelection()?.removeAllRanges();
                event.currentTarget.setPointerCapture(event.pointerId);
                scrub(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.preventDefault();
                  scrub(event);
                }
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  scrub(event);
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
            >
              {Array.from({ length: Math.ceil(total) + 1 }, (_, i) => (
                <span key={i} style={{ left: i * pps }}>{`00:${String(i).padStart(2, "0")}`}</span>
              ))}
            </div>
            {[...doc.tracks].reverse().map((track) => (
              <div
                className={`track-lane ${track.muted ? "is-muted" : ""}`}
                key={track.id}
                style={{ backgroundSize: `${pps}px 100%` }}
              >
                {track.instanceIds.map((id) => {
                  const instance = doc.instances[id];
                  return (
                    <div
                      key={id}
                      className={`timeline-clip ${track.kind} ${selection.includes(id) ? "selected" : ""} ${instance.locked ? "locked" : ""}`}
                      style={{
                        left: ((compiled.ok ? compiled.value.starts[id] : instance.start) / 240000) * pps,
                        width: Math.max(8, (instance.duration / 240000) * pps),
                      }}
                      onPointerDown={(e) => drag(e, id)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Clip ${id}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") props.setSelection([id]);
                      }}
                    >
                      <div
                        className="trim-handle left"
                        hidden={!props.editing}
                        aria-label={`${id} trim start`}
                        onPointerDown={(e) => drag(e, id, "start")}
                      />
                      <span className="clip-kind">
                        {doc.definitions[instance.definitionId].kind === "react" ? "R" : "H"}
                      </span>
                      <span className="clip-name">{id}</span>
                      {Object.values(doc.channels)
                        .filter((c) => c.target.instanceId === id)
                        .flatMap((c) => c.keys)
                        .map((key) => (
                          <i key={key.id} className="key-dot" style={{ left: (key.at / 240000) * pps }} />
                        ))}
                      <div
                        className="trim-handle right"
                        hidden={!props.editing}
                        aria-label={`${id} trim end`}
                        onPointerDown={(e) => drag(e, id, "end")}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="playhead" style={{ left: (tick / 240000) * pps }}>
              <span />
            </div>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>Frame snap · {doc.settings.fps.num} fps</span>
        <span>Ripple off</span>
        <span>{total.toFixed(2)}s</span>
      </div>
    </section>
  );
}
