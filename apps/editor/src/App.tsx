import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStarterProject } from "../../../packages/document/src/starter";
import AssetPanel from "./assets/AssetPanel";
import SourceEditor from "./authoring/SourceEditor";
import AgentPanel from "./automation/AgentPanel";
import StageViewport from "./canvas/StageViewport";
import CurveEditor from "./curves/CurveEditor";
import PropertiesPanel from "./inspector/PropertiesPanel";
import RecoveryDialog from "./recovery/RecoveryDialog";
import ReviewPanel from "./review/ReviewPanel";
import VariantPanel from "./review/VariantPanel";
import ScorePanel from "./score/ScorePanel";
import { api, isBrowserMode, offlineStore, useProjectStore } from "./state/project-store";
import Timeline from "./timeline/Timeline";
import Transport from "./transport/Transport";
import TypePanel from "./type/TypePanel";
import type { PanelProps } from "./types";

type Job = {
  jobId: string;
  state: string;
  progress: { completed: number; total: number };
  result?: { outputPath: string };
  error?: { message: string };
};
export default function App() {
  const [message, setMessage] = useState("");
  const notify = useCallback((s: string) => setMessage(s), []);
  const store = useProjectStore(notify);
  const doc = store.document;
  const [selection, setSelection] = useState<string[]>(["title"]);
  const [tick, setTick] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [leftTab, setLeftTab] = useState("layers");
  const [rightTab, setRightTab] = useState("review");
  const [editing, setEditing] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const browser = isBrowserMode();
  const [toggleSignal, setToggleSignal] = useState(0);
  const [job, setJob] = useState<Job>();
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [review, setReview] = useState<unknown>();
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 9000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (!doc) return;
    setTick((t) => Math.min(t, doc.settings.duration - 240000 / doc.settings.fps.num));
    setSelection((ids) => ids.filter((id) => Boolean(doc.instances[id])));
  }, [doc]);
  useEffect(() => {
    if (!doc || !Object.keys(doc.mediaClips).length) {
      setAudio(null);
      return;
    }
    let cancelled = false;
    void api<{ dataUrl: string }>("audio", {}).then((r) => {
      if (!cancelled && r.ok) setAudio(new Audio(r.value.dataUrl));
    });
    return () => {
      cancelled = true;
    };
  }, [doc?.revision]);
  useEffect(() => {
    if (!job || ["completed", "failed", "cancelled"].includes(job.state)) return;
    const timer = setInterval(() => {
      void api<Job>(`job?id=${job.jobId}`).then((r) => {
        if (r.ok) setJob(r.value);
      });
    }, 600);
    return () => clearInterval(timer);
  }, [job]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable]") || !doc) return;
      if (e.code === "Space") {
        e.preventDefault();
        setToggleSignal((s) => s + 1);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        void store.history(e.shiftKey ? "redo" : "undo");
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setTick((t) =>
          Math.max(
            0,
            Math.min(
              doc.settings.duration - 240000 / doc.settings.fps.num,
              t + ((e.key === "ArrowRight" ? 1 : -1) * 240000) / doc.settings.fps.num,
            ),
          ),
        );
      } else if (editing && e.key.toLowerCase() === "s" && selection.length) {
        e.preventDefault();
        void store.submit(
          selection.map((instanceId) => ({
            type: "SplitClip",
            instanceId,
            at: tick,
            newInstanceId: `${instanceId}-${crypto.randomUUID().slice(0, 4)}`,
          })),
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [doc, selection, tick, editing, store.history, store.submit]);
  const selected = selection[0];
  const panels = useMemo(
    () => ({
      review: ReviewPanel,
      properties: PropertiesPanel,
      curves: CurveEditor,
      score: ScorePanel,
      type: TypePanel,
      source: SourceEditor,
      agent: AgentPanel,
      variants: VariantPanel,
    }),
    [],
  );
  if (!doc)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <svg viewBox="0 0 120 110" aria-hidden="true">
            <path
              d="M60 10 109 95H11Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="5.5"
              strokeLinejoin="round"
            />
            <path d="M60 20 79 53H41Z M36 57 55 90H17Z" fill="currentColor" />
            <path d="M84 57 103 90H65Z" fill="var(--orange)" />
            <path d="M60 51 79 84H41Z" fill="var(--paper)" stroke="currentColor" strokeWidth="3.5" />
          </svg>
        </div>
        <h1>MotiFrame</h1>
        <p>{message || "Opening project…"}</p>
      </div>
    );
  const props: PanelProps = {
    document: doc,
    editing,
    selection,
    tick,
    submit: store.submit,
    refresh: store.refresh,
    notify,
    api,
  };
  const Panel = panels[rightTab as keyof typeof panels];
  async function render() {
    const result = await api<{ jobId: string }>("render", {});
    if (result.ok)
      setJob({ jobId: result.value.jobId, state: "queued", progress: { completed: 0, total: 0 } });
    else notify(result.error.message);
  }
  async function download() {
    if (!job) return;
    const token = document.querySelector<HTMLMetaElement>('meta[name="motiframe-session"]')?.content ?? "";
    const response = await fetch(`/api/download?job=${job.jobId}`, {
      headers: { "X-MotiFrame-Session": token },
    });
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc?.id}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const add = (kind: "title" | "shape") => {
    const id = `${kind}-${crypto.randomUUID().slice(0, 4)}`;
    const starter = createStarterProject();
    const prototype = kind === "title" ? starter.instances.title : starter.instances.accent;
    void store
      .submit([
        {
          type: "AddInstance",
          instanceId: id,
          instance: {
            ...prototype,
            start: tick,
            duration: doc.settings.duration - tick,
            props: {
              ...prototype.props,
              ...(kind === "title" ? { text: "New motion" } : { width: 180, height: 180 }),
            },
          },
        },
      ])
      .then((success) => {
        if (success) setSelection([id]);
      });
  };
  return (
    <div className="studio">
      <header className="topbar">
        <a className="brand" href="/" aria-label="MotiFrame home">
          <span className="brand-mark">
            <svg viewBox="0 0 120 110" aria-hidden="true">
              <path
                d="M60 10 109 95H11Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="5.5"
                strokeLinejoin="round"
              />
              <path d="M60 20 79 53H41Z M36 57 55 90H17Z" fill="currentColor" />
              <path d="M84 57 103 90H65Z" fill="var(--orange)" />
              <path d="M60 51 79 84H41Z" fill="var(--paper)" stroke="currentColor" strokeWidth="3.5" />
            </svg>
          </span>
          <span className="brand-word">MOTIFRAME</span>
          <em>BY DEXA</em>
        </a>
        <div className="project-name">
          <span className="project-glyph">◈</span>
          {doc.id}
          <span className="badge">{browser ? "BROWSER" : "LOCAL"}</span>
        </div>
        <div className="save-status">
          <span className="status-dot" />
          Saved <span>rev {doc.revision}</span>
        </div>
        <button disabled={!store.counts?.undo} onClick={() => void store.history("undo")} aria-label="Undo">
          ↶
        </button>
        <button disabled={!store.counts?.redo} onClick={() => void store.history("redo")} aria-label="Redo">
          ↷
        </button>
        {browser && (
          <>
            <button onClick={() => importInput.current?.click()}>Open project</button>
            <input
              ref={importInput}
              type="file"
              hidden
              accept=".json,.motionproj"
              aria-label="Open project"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file)
                  void (async () => {
                    const opened = await offlineStore();
                    if (!opened.ok) {
                      notify(opened.error.message);
                      return;
                    }
                    const result = file.name.endsWith(".motionproj")
                      ? await opened.value.importBundle(file)
                      : await opened.value.importProjectJson(await file.text());
                    if (result.ok) {
                      await store.refresh();
                      notify("Project opened.");
                    } else notify(result.error.message);
                  })();
                event.currentTarget.value = "";
              }}
            />
          </>
        )}
        <button
          onClick={() =>
            void (async () => {
              if (browser) {
                const opened = await offlineStore();
                if (!opened.ok) {
                  notify(opened.error.message);
                  return;
                }
                const packed = await opened.value.exportBundle();
                if (!packed.ok) {
                  notify(packed.error.message);
                  return;
                }
                const url = URL.createObjectURL(packed.value),
                  a = document.createElement("a");
                a.href = url;
                a.download = `${doc.id}.motionproj`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              } else {
                const r = await api<{ path: string }>("pack", {});
                notify(r.ok ? "Portable project saved in the exports folder." : r.error.message);
              }
            })()
          }
        >
          Package project
        </button>
        <button className="primary export-button" onClick={() => void render()}>
          Export <span>↗</span>
        </button>
      </header>
      <div className="workspace">
        <aside className="left-sidebar">
          <nav className="panel-tabs">
            <button className={leftTab === "layers" ? "active" : ""} onClick={() => setLeftTab("layers")}>
              Layers
            </button>
            <button className={leftTab === "assets" ? "active" : ""} onClick={() => setLeftTab("assets")}>
              Assets
            </button>
          </nav>
          <div className="sidebar-content">
            {leftTab === "layers" ? (
              <>
                <div className="section-label">
                  COMPOSITION <span>{Object.keys(doc.instances).length} layers</span>
                </div>
                {editing && (
                  <div className="add-layer">
                    <button onClick={() => add("title")}>＋ Text</button>
                    <button onClick={() => add("shape")}>＋ Shape</button>
                  </div>
                )}
                {[...doc.tracks]
                  .reverse()
                  .flatMap((track) => [...track.instanceIds].reverse())
                  .map((id) => {
                    const instance = doc.instances[id],
                      definition = doc.definitions[instance.definitionId];
                    return (
                      <button
                        key={id}
                        className={`layer-row ${selection.includes(id) ? "active" : ""}`}
                        onClick={(e) => setSelection(e.shiftKey ? [...new Set([...selection, id])] : [id])}
                      >
                        <span className={`layer-icon ${definition.kind}`}>
                          {definition.kind === "react" ? "R" : "H"}
                        </span>
                        <span>
                          {id}
                          <small>
                            {definition.id} · v{definition.revision}
                          </small>
                        </span>
                        <span className="muted">{instance.locked ? "▣" : "◇"}</span>
                      </button>
                    );
                  })}
                <div className="workspace-note">
                  <span className="section-label">ONE TIMELINE. TWO FORMATS.</span>
                  <p>Create with your coding agent. Review the result here.</p>
                  <button onClick={() => setRightTab("agent")}>Connect an agent →</button>
                </div>
              </>
            ) : (
              <AssetPanel {...props} />
            )}
          </div>
          <div className="sidebar-bottom">
            <span className="status-dot" />{" "}
            {browser ? "Browser storage · saved locally" : "Local runner connected"}
          </div>
        </aside>
        <main className="main-workspace">
          <div className="composition-heading">
            <div>
              <span className="eyebrow">MOTION REVIEW</span>
              <h1>{doc.id}</h1>
            </div>
            <button
              className={editing ? "active" : ""}
              aria-pressed={editing}
              onClick={() => {
                setEditing(!editing);
                setRightTab(editing ? "review" : "properties");
              }}
            >
              Adjust
            </button>
          </div>
          <StageViewport {...props} setSelection={setSelection} zoom={zoom} setZoom={setZoom} />
          <Transport
            tick={tick}
            duration={doc.settings.duration}
            fps={doc.settings.fps}
            onTick={setTick}
            toggleSignal={toggleSignal}
            audio={audio}
            onError={notify}
          />
          <Timeline {...props} setSelection={setSelection} onTick={setTick} />
        </main>
        <aside className="right-sidebar">
          <div className="inspector-heading">
            <strong>{editing ? "INSPECTOR" : "REVIEW"}</strong>
            <span className="badge">{selected ? "SELECTED" : "SETTINGS"}</span>
          </div>
          <nav className="tool-tabs">
            {[
              ["review", "Overview"],
              ["variants", "Compare"],
              ["agent", "Agent I/O"],
              ...(editing
                ? [
                    ["properties", "Properties"],
                    ["curves", "Curves"],
                    ["score", "Score"],
                    ["type", "Type"],
                    ["source", "Source"],
                  ]
                : []),
            ].map(([id, label]) => (
              <button key={id} className={rightTab === id ? "active" : ""} onClick={() => setRightTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="inspector-content">
            <Panel {...props} />
          </div>
          {editing && (
            <div className="format-settings">
              <div className="section-label">COMPOSITION SETTINGS</div>
              <div className="field-row">
                <select
                  aria-label="Aspect ratio"
                  value={`${doc.settings.width}:${doc.settings.height}`}
                  onChange={(e) => {
                    const [width, height] = e.target.value.split(":").map(Number);
                    void store.submit([{ type: "UpdateSettings", settings: { width, height } }]);
                  }}
                >
                  <option value="1280:720">16:9 · 1280×720</option>
                  <option value="720:1280">9:16 · 720×1280</option>
                  <option value="1080:1080">1:1 · 1080×1080</option>
                  {!["1280:720", "720:1280", "1080:1080"].includes(
                    `${doc.settings.width}:${doc.settings.height}`,
                  ) && (
                    <option>
                      {doc.settings.width}:{doc.settings.height}
                    </option>
                  )}
                </select>
                <select
                  aria-label="Frame rate"
                  value={doc.settings.fps.num}
                  onChange={(e) =>
                    void store.submit([
                      {
                        type: "UpdateSettings",
                        settings: { fps: { num: Number(e.target.value) as 24 | 30 | 60, den: 1 } },
                      },
                    ])
                  }
                >
                  {[24, 30, 60].map((fps) => (
                    <option key={fps} value={fps}>
                      {fps} fps
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </aside>
      </div>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          <button onClick={() => setMessage("")} aria-label="Dismiss notification">
            ×
          </button>
        </div>
      )}
      {job && (
        <div className="render-panel">
          <div className="field-row">
            <strong>Export video</strong>
            <span className="badge">{job.state}</span>
            <button onClick={() => setJob(undefined)} aria-label="Close export status">
              ×
            </button>
          </div>
          <progress max={Math.max(1, job.progress.total)} value={job.progress.completed} />
          <small>
            {job.progress.completed} / {job.progress.total} frames
          </small>
          {job.error && <p>{job.error.message}</p>}
          {job.state === "completed" ? (
            <button className="primary" onClick={() => void download()}>
              Download MP4
            </button>
          ) : (
            !["failed", "cancelled"].includes(job.state) && (
              <button onClick={() => void api("cancel", { jobId: job.jobId })}>Cancel render</button>
            )
          )}
        </div>
      )}
      {review !== undefined && (
        <div className="modal-backdrop">
          <div className="review-modal">
            <div className="field-row">
              <h2>Review</h2>
              <button onClick={() => setReview(undefined)}>Close</button>
            </div>
            <p className="muted">
              Review technical checks, implementation observations, and perception separately.
            </p>
            <pre>{JSON.stringify(review, null, 2)}</pre>
          </div>
        </div>
      )}
      <RecoveryDialog notify={notify} />
      <footer className="app-footer">
        <span>MOTIFRAME 0.1</span>
        <span>SPACE Play · ← → Frame step{editing ? " · ⌘/Ctrl Z Undo · S Split" : ""}</span>
        <span>SRGB / 48 KHZ</span>
      </footer>
    </div>
  );
}
