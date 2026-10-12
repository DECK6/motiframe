import { reviewProject } from "../../../../packages/core/src/review/report";
import type { PanelProps } from "../types";
export default function ReviewPanel({ document, selection }: PanelProps) {
  const report = reviewProject(document);
  return (
    <section className="panel-stack" aria-label="Project review">
      <h2>Review your motion</h2>
      <p className="muted">
        Your coding agent creates and edits the project. Play, inspect, compare, and export the result here.
      </p>
      <div className="card">
        <div className="field-row">
          <strong>Current project</strong>
          <span className="badge">r{document.revision}</span>
        </div>
        <p>
          {(document.settings.duration / 240000).toFixed(2)}s · {document.settings.fps.num} fps ·{" "}
          {Object.keys(document.instances).length} layers
        </p>
        <p className="muted">
          {selection.length ? `${selection.length} selected` : "Select a layer to inspect its timing."}
        </p>
      </div>
      {(["technical", "implementation", "perception"] as const).map((group) => (
        <div className="card" key={group}>
          <h3>
            {
              {
                technical: "Technical checks",
                implementation: "Motion structure",
                perception: "Playback review",
              }[group]
            }
          </h3>
          {report[group].length ? (
            report[group].map((item, i) => (
              <p key={`${item.source}:${i}`}>
                <span className="badge">
                  {item.status === "keep" ? "PASS" : item.status === "revise" ? "CHECK" : "UNVERIFIED"}
                </span>{" "}
                {item.observation}
              </p>
            ))
          ) : (
            <p className="muted">No motion structure issues detected.</p>
          )}
        </div>
      ))}
    </section>
  );
}
