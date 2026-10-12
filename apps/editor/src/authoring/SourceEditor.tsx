import { useEffect, useState } from "react";
import type { DefinitionSource } from "../../../../packages/authoring/src/build";
import { resolveDefinitionKey } from "../../../../packages/authoring/src/revisions";
import type { ElementManifest } from "../../../../packages/document/src/schema";
import type { SourceCandidate } from "../../../runner/src/source-watcher";
import type { PanelProps } from "../types";

function example(manifest: ElementManifest, kind: "react" | "html"): DefinitionSource {
  const next: ElementManifest = {
    ...manifest,
    revision: manifest.revision + 1,
    kind,
    moduleHash: "",
    targets: [
      { key: "root", channels: ["x", "y", "opacity"], coordinateSpace: "local" },
      { key: "title", channels: ["x", "y", "opacity"], coordinateSpace: "local" },
    ],
    slots: [],
    assets: [],
  };
  const header = `import { ${kind === "react" ? "defineReactElement, MotionTarget" : "defineHtmlElement"} } from '@motiframe/authoring';\nconst manifest = ${JSON.stringify(next, null, 2)};\n`;
  const code =
    kind === "react"
      ? `${header}export default defineReactElement(manifest, ({props}) => (\n  <MotionTarget targetKey="title">\n    <div style={{color: String(props.color ?? '#ffffff'), fontSize: Number(props.fontSize ?? 64), whiteSpace: 'pre'}}>{String(props.text ?? 'Editable motion')}</div>\n  </MotionTarget>\n));\n`
      : `${header}export default defineHtmlElement(manifest, {\n  html: '<div data-motion-target="title"><span class="label"></span></div>',\n  css: '.label { color: white; font-size: 64px; white-space: pre; }',\n  bindings: [{selector: '.label', prop: 'text', kind: 'text'}]\n});\n`;
  return {
    manifest: next,
    entry: kind === "react" ? "index.tsx" : "index.ts",
    files: { [kind === "react" ? "index.tsx" : "index.ts"]: code },
  };
}

export default function SourceEditor(props: PanelProps) {
  const [draft, setDraft] = useState("");
  const [remap, setRemap] = useState("{}");
  const [base, setBase] = useState<{
    documentRevision: number;
    definitionId: string;
    revision: number;
    instanceIds: string[];
  }>();
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<SourceCandidate[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const result = await props.api<SourceCandidate[]>("source-candidates");
        if (!cancelled && result.ok) setCandidates(result.value);
      } catch {
        /* A disconnected runner will be retried by the next poll. */
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [props.api]);
  const selected = props.selection.map((id) => props.document.instances[id]).filter(Boolean);
  const first = selected[0];
  const key = first && resolveDefinitionKey(props.document, first.definitionId, first.definitionRevision);
  const manifest = key ? props.document.definitions[key] : undefined;
  const shared =
    !!manifest &&
    selected.every(
      (item) =>
        item.definitionId === first.definitionId && item.definitionRevision === first.definitionRevision,
    );
  const stale = !!base && base.documentRevision !== props.document.revision;
  const selectionChanged = !!base && base.instanceIds.join("\n") !== props.selection.join("\n");
  function canLoad(candidate: SourceCandidate) {
    return (
      !!candidate.source &&
      shared &&
      candidate.baseRevision === props.document.revision &&
      candidate.oldRef.definitionId === manifest?.id &&
      candidate.oldRef.revision === manifest.revision &&
      props.selection.every((id) => candidate.instanceIds.includes(id))
    );
  }
  function loadCandidate(candidate: SourceCandidate) {
    if (!canLoad(candidate)) return;
    setBase({
      documentRevision: candidate.baseRevision,
      definitionId: candidate.oldRef.definitionId,
      revision: candidate.oldRef.revision,
      instanceIds: [...props.selection],
    });
    setDraft(JSON.stringify(candidate.source, null, 2));
    setRemap("{}");
    props.notify(
      "Loaded the external candidate as a draft. Review it before applying to the selected elements.",
    );
  }
  function loadExample(kind: "react" | "html") {
    if (!manifest || !shared) return;
    setBase({
      documentRevision: props.document.revision,
      definitionId: manifest.id,
      revision: manifest.revision,
      instanceIds: [...props.selection],
    });
    setDraft(JSON.stringify(example(manifest, kind), null, 2));
    setRemap("{}");
  }
  function anchor() {
    if (!manifest || !shared) return;
    setBase({
      documentRevision: props.document.revision,
      definitionId: manifest.id,
      revision: manifest.revision,
      instanceIds: [...props.selection],
    });
    props.notify("Anchored the source draft to the current document and selection.");
  }
  async function register() {
    if (!base || stale || selectionChanged) return;
    setBusy(true);
    try {
      const source: unknown = JSON.parse(draft),
        targetRemap: unknown = JSON.parse(remap);
      if (
        !targetRemap ||
        typeof targetRemap !== "object" ||
        Array.isArray(targetRemap) ||
        Object.values(targetRemap).some((value) => typeof value !== "string")
      )
        throw new SyntaxError("targetRemap");
      const result = await props.api<unknown>("source", {
        source,
        oldRef: { definitionId: base.definitionId, revision: base.revision },
        instanceIds: base.instanceIds,
        baseRevision: base.documentRevision,
        targetRemap,
      });
      if (result.ok) {
        await props.refresh();
        setBase(undefined);
        props.notify("Validated the source and applied the new revision.");
      } else props.notify(`${result.error.code}: ${result.error.message}`);
    } catch (error) {
      props.notify(
        error instanceof SyntaxError ? "Check the source and target mapping JSON formats." : String(error),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel-stack" aria-label="Element source editor">
      <h2>Element source</h2>
      {manifest ? (
        <p className="muted">
          Selection: {manifest.id} · r{manifest.revision} · {manifest.kind}
        </p>
      ) : (
        <p className="muted">Select an element to edit in the timeline.</p>
      )}
      {!shared && selected.length > 1 && (
        <p className="muted">Select elements using the same definition and revision.</p>
      )}
      <div className="field-row">
        <button type="button" disabled={!shared || busy} onClick={() => loadExample("react")}>
          React example
        </button>
        <button type="button" disabled={!shared || busy} onClick={() => loadExample("html")}>
          HTML example
        </button>
        <button type="button" disabled={!shared || busy} onClick={anchor}>
          Use current selection
        </button>
      </div>
      <p className="muted">
        Examples update the draft. If target keys change, map old keys to new keys below.
      </p>
      {candidates.length > 0 && (
        <div className="panel-stack" aria-label="External source candidates">
          <h3>External source candidates</h3>
          <p className="muted">
            Select the affected elements and load a candidate. The document changes only when you apply.
          </p>
          {candidates.map((candidate) => (
            <article className="card" key={candidate.id}>
              <strong>
                {candidate.oldRef.definitionId} · r{candidate.oldRef.revision} → r
                {candidate.source?.manifest.revision ?? "?"}
              </strong>
              <span className="badge">
                {candidate.status === "ready"
                  ? "Validated"
                  : candidate.status === "migration-required"
                    ? "Migration required"
                    : "Validation failed"}
              </span>
              <p className="muted">
                Targets: {candidate.instanceIds.join(", ")} · Base document r{candidate.baseRevision}
              </p>
              {candidate.diagnostics.map((diagnostic) => (
                <p key={diagnostic}>{diagnostic}</p>
              ))}
              <button
                type="button"
                disabled={busy || !canLoad(candidate)}
                onClick={() => loadCandidate(candidate)}
              >
                Load candidate for selection
              </button>
            </article>
          ))}
        </div>
      )}
      <label>
        Definition and files JSON
        <textarea
          rows={20}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder='{"manifest": {...}, "files": {"index.tsx": "..."}}'
          spellCheck={false}
        />
      </label>
      <label>
        Target key mapping
        <textarea
          rows={3}
          value={remap}
          onChange={(event) => setRemap(event.target.value)}
          placeholder='{"old-title":"title"}'
          spellCheck={false}
        />
      </label>
      {base && (
        <p className="muted">
          Base document r{base.documentRevision} · Targets {base.instanceIds.join(", ")}
        </p>
      )}
      {selectionChanged && (
        <p role="alert">Selection changed. Confirm the intended targets and anchor the draft again.</p>
      )}
      {stale && (
        <p role="alert">
          The document changed. Compare the current selection and source before anchoring again.
        </p>
      )}
      <button
        className="primary"
        type="button"
        disabled={!draft.trim() || !base || stale || selectionChanged || busy}
        onClick={() => void register()}
      >
        {busy ? "Building and validating…" : "Validate and apply revision"}
      </button>
    </section>
  );
}
