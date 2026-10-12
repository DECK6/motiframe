import { useEffect, useRef, useState } from "react";
import { validateChangeSet } from "../../../../packages/automation/src/index";
import { createVariant, type Variant } from "../../../../packages/automation/src/variants";
import {
  type QualityObservation,
  type QualityReport,
  reviewProject,
} from "../../../../packages/core/src/review/report";
import type { EditTransaction } from "../../../../packages/document/src/commands";
import type { FrameReceipt } from "../../../../packages/stage/src/main";
import type { PanelProps } from "../types";

type Frame = { image: string; receipt: FrameReceipt };
type Comparison = {
  variant: Variant;
  transaction: EditTransaction;
  draft: string;
  baseReview: QualityReport;
};
type Axis = "speed" | "tension" | "rhythm";
type Note = { status: QualityObservation["status"]; observation: string };
const axes: [Axis, string][] = [
  ["speed", "Speed"],
  ["tension", "Tension"],
  ["rhythm", "Rhythm"],
];
const statusText = { keep: "Keep", revise: "Revise", unverified: "Unverified" };
const freshNotes = (): Record<Axis, Note> => ({
  speed: { status: "unverified", observation: "" },
  tension: { status: "unverified", observation: "" },
  rhythm: { status: "unverified", observation: "" },
});

export default function VariantPanel(props: PanelProps) {
  const [draft, setDraft] = useState("");
  const [label, setLabel] = useState("Variant B");
  const [comparison, setComparison] = useState<Comparison>();
  const [frames, setFrames] = useState<{ a: Frame; b: Frame; tick: number }>();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [view, setView] = useState<"A" | "B" | "wipe">("wipe");
  const [wipe, setWipe] = useState(50);
  const [notes, setNotes] = useState(freshNotes);
  const [playbackObserved, setPlaybackObserved] = useState(false);
  const [audioObserved, setAudioObserved] = useState(false);
  const request = useRef(0);
  const stale =
    !!comparison &&
    (comparison.variant.baseRevision !== props.document.revision || comparison.draft !== draft);
  const sameGeometry =
    !comparison ||
    (comparison.variant.document.settings.width === props.document.settings.width &&
      comparison.variant.document.settings.height === props.document.settings.height);

  useEffect(() => {
    const id = ++request.current;
    setFrames(undefined);
    setLoading(false);
    if (!comparison || stale) return;
    const tick = props.tick,
      revision = comparison.variant.baseRevision;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void Promise.all([
        props.api<Frame>("frame", { revision, tick }),
        props.api<Frame>("variant-frame", { transaction: comparison.transaction, tick }),
      ])
        .then(([a, b]) => {
          if (cancelled || request.current !== id) return;
          if (!a.ok || !b.ok) {
            props.notify(
              !a.ok ? a.error.message : !b.ok ? b.error.message : "Could not load comparison frames.",
            );
            return;
          }
          if (
            a.value.receipt.tick !== tick ||
            b.value.receipt.tick !== tick ||
            a.value.receipt.documentRevision !== revision ||
            b.value.receipt.documentRevision !== comparison.variant.document.revision
          ) {
            props.notify("Comparison stopped because frame ticks or revisions differ.");
            return;
          }
          setFrames({ a: a.value, b: b.value, tick });
        })
        .catch((error) => {
          if (!cancelled) props.notify(String(error));
        })
        .finally(() => {
          if (!cancelled && request.current === id) setLoading(false);
        });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [comparison, stale, props.tick, props.document.revision, props.api, props.notify]);

  function build() {
    try {
      const input: unknown = JSON.parse(draft);
      let transaction: EditTransaction;
      if (input && typeof input === "object" && "transaction" in input) {
        const valid = validateChangeSet(props.document, input);
        if (!valid.ok) {
          props.notify(`${valid.error.code}: ${valid.error.message}`);
          return;
        }
        transaction = valid.value;
      } else transaction = input as EditTransaction;
      const result = createVariant(props.document, transaction, label.trim() || "Variant B");
      if (!result.ok) {
        props.notify(`${result.error.code}: ${result.error.message}`);
        return;
      }
      setComparison({
        variant: result.value,
        transaction: structuredClone(transaction),
        draft,
        baseReview: reviewProject(props.document),
      });
      setNotes(freshNotes());
      setPlaybackObserved(false);
      setAudioObserved(false);
    } catch (error) {
      props.notify(
        error instanceof SyntaxError ? "Check the transaction or ChangeSet JSON format." : String(error),
      );
    }
  }
  async function apply() {
    if (!comparison || stale) return;
    setApplying(true);
    try {
      const result = await props.api<unknown>("transaction", { transaction: comparison.transaction });
      if (result.ok) {
        setComparison(undefined);
        setFrames(undefined);
        await props.refresh();
        props.notify("Applied variant B. A single undo restores the original.");
      } else props.notify(`${result.error.code}: ${result.error.message}`);
    } catch (error) {
      props.notify(String(error));
    } finally {
      setApplying(false);
    }
  }
  const technicalReport = comparison ? reviewProject(comparison.variant.document) : undefined;
  const report: QualityReport | undefined =
    comparison && technicalReport
      ? {
          ...technicalReport,
          perception: axes.map(([axis, title]) => ({
            range: comparison.transaction.scope.range,
            observation:
              notes[axis].observation.trim() || `${title}: No continuous playback observation recorded`,
            status: playbackObserved && notes[axis].observation.trim() ? notes[axis].status : "unverified",
            source: playbackObserved ? `user continuous-playback observation:${axis}` : `unverified:${axis}`,
          })),
        }
      : undefined;
  function exportReview() {
    if (!comparison || !report) return;
    const payload = {
      variantId: comparison.variant.id,
      baseRevision: comparison.variant.baseRevision,
      candidateRevision: comparison.variant.document.revision,
      label: comparison.variant.label,
      tick: frames?.tick ?? null,
      comparisonMode: "silent-still-frames",
      playbackObserved,
      audioObserved,
      base: comparison.baseReview,
      candidate: report,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = "motiframe-variant-review.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <section className="panel-stack" aria-label="Variant review">
      <h2>A/B comparison</h2>
      <p className="muted">Compare variant B with original A. The project changes only when you apply.</p>
      <label>
        Variant name
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label>
        Transaction or ChangeSet JSON
        <textarea
          rows={9}
          value={draft}
          spellCheck={false}
          placeholder="Paste the proposed changes to review."
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button type="button" disabled={!draft.trim() || applying} onClick={build}>
        Create variant
      </button>
      {stale && (
        <p role="alert">The document or draft changed. Recreate the variant from the latest revision.</p>
      )}
      {comparison && (
        <>
          <div className="field-row">
            <span className="badge">A · r{comparison.variant.baseRevision}</span>
            <span className="badge">B · {comparison.variant.label}</span>
          </div>
          <p className="muted">
            Silent still frame comparison · {(props.tick / 240000).toFixed(3)}s. Playback and listening
            require separate verification.
          </p>
          <div className="field-row" role="group" aria-label="Comparison view">
            <button type="button" aria-pressed={view === "A"} onClick={() => setView("A")}>
              Original A
            </button>
            <button type="button" aria-pressed={view === "B"} onClick={() => setView("B")}>
              Variant B
            </button>
            <button
              type="button"
              disabled={!sameGeometry}
              aria-pressed={view === "wipe"}
              onClick={() => setView("wipe")}
            >
              Overlay
            </button>
          </div>
          {!sameGeometry && (
            <p className="muted">Frame dimensions differ. Use the A/B tabs at the same pixel scale.</p>
          )}
          {loading && (
            <p role="status" className="muted">
              Loading A/B frames at the same tick…
            </p>
          )}
          {frames && !stale && (
            <div
              style={{ position: "relative", overflow: "auto", background: "#111" }}
              aria-label="Comparison frames at the same tick"
            >
              {view === "B" ? (
                <img
                  alt="Variant B frame"
                  src={frames.b.image}
                  style={{
                    display: "block",
                    width: `${(100 * comparison.variant.document.settings.width) / props.document.settings.width}%`,
                    maxWidth: "none",
                  }}
                />
              ) : (
                <img
                  alt="Original A frame"
                  src={frames.a.image}
                  style={{ display: "block", width: "100%" }}
                />
              )}
              {view === "wipe" && sameGeometry && (
                <img
                  alt="Variant B overlay frame"
                  src={frames.b.image}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    clipPath: `inset(0 ${100 - wipe}% 0 0)`,
                  }}
                />
              )}
            </div>
          )}
          {view === "wipe" && sameGeometry && (
            <label>
              Show B {wipe}%
              <input
                type="range"
                min="0"
                max="100"
                value={wipe}
                onChange={(event) => setWipe(Number(event.target.value))}
              />
            </label>
          )}
          {report && (
            <div className="panel-stack">
              {(["technical", "implementation"] as const).map((group) => (
                <details className="card" key={group}>
                  <summary>{group === "technical" ? "Technical checks" : "Motion implementation"}</summary>
                  {report[group].length ? (
                    <ul>
                      {report[group].map((item, index) => (
                        <li key={`${index}:${item.source}`}>
                          <span className="badge">{statusText[item.status]}</span> {item.observation}
                          <small className="muted"> · {item.source}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">
                      No implementation issues detected automatically. Playback review is separate.
                    </p>
                  )}
                </details>
              ))}
              <div className="card panel-stack">
                <h3>Perception observations</h3>
                <label>
                  <input
                    type="checkbox"
                    checked={playbackObserved}
                    onChange={(event) => {
                      setPlaybackObserved(event.target.checked);
                      if (!event.target.checked)
                        setNotes(
                          (current) =>
                            Object.fromEntries(
                              axes.map(([axis]) => [axis, { ...current[axis], status: "unverified" }]),
                            ) as Record<Axis, Note>,
                        );
                    }}
                  />
                  I observed this range in external continuous playback
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={audioObserved}
                    onChange={(event) => setAudioObserved(event.target.checked)}
                  />
                  I also listened to the audio
                </label>
                {axes.map(([axis, title]) => (
                  <div key={axis}>
                    <label>
                      {title} observation
                      <textarea
                        rows={2}
                        value={notes[axis].observation}
                        placeholder="Intent → observed range and behavior"
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [axis]: { ...current[axis], observation: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      {title} status
                      <select
                        value={notes[axis].status}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [axis]: { ...current[axis], status: event.target.value as Note["status"] },
                          }))
                        }
                      >
                        <option value="unverified">Unverified</option>
                        <option value="keep" disabled={!playbackObserved || !notes[axis].observation.trim()}>
                          Keep
                        </option>
                        <option
                          value="revise"
                          disabled={!playbackObserved || !notes[axis].observation.trim()}
                        >
                          Revise
                        </option>
                      </select>
                    </label>
                  </div>
                ))}
                <p className="muted">
                  Observations belong to this variant and range. They do not produce an automatic aesthetic
                  score.
                </p>
              </div>
            </div>
          )}
          <div className="field-row">
            <button type="button" disabled={!report} onClick={exportReview}>
              Save review JSON
            </button>
            <button
              className="primary"
              type="button"
              disabled={stale || applying}
              onClick={() => void apply()}
            >
              Apply variant B
            </button>
          </div>
        </>
      )}
    </section>
  );
}
