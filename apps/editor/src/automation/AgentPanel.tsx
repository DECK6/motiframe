import { useEffect, useMemo, useState } from "react";
import type { ChangeSet } from "../../../../packages/automation/src/index";
import type { EditScope, EditTransaction } from "../../../../packages/document/src/commands";
import type { ProjectDocument } from "../../../../packages/document/src/schema";
import type { PanelProps } from "../types";

function globalStart(document: ProjectDocument, id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const instance = document.instances[id];
  if (!instance) return 0;
  return (
    instance.start +
    (instance.parentId
      ? globalStart(document, instance.parentId, seen)
      : (Object.values(document.scenes).find((scene) => scene.rootIds.includes(id))?.start ?? 0))
  );
}
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function AgentPanel(props: PanelProps) {
  const selectionKey = props.selection.join("\n");
  const selectionRange = useMemo(() => {
    const ids = props.selection.filter((id) => props.document.instances[id]);
    return ids.length
      ? {
          start: Math.min(...ids.map((id) => globalStart(props.document, id))),
          end: Math.max(
            ...ids.map((id) => globalStart(props.document, id) + props.document.instances[id].duration),
          ),
        }
      : { start: 0, end: props.document.settings.duration };
  }, [props.document, selectionKey]);
  const [start, setStart] = useState(selectionRange.start / 240000);
  const [end, setEnd] = useState(selectionRange.end / 240000);
  const [text, setText] = useState("");
  const [context, setContext] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    draft: string;
    baseRevision: number;
    transaction: EditTransaction;
  }>();
  useEffect(() => {
    setStart(selectionRange.start / 240000);
    setEnd(selectionRange.end / 240000);
    setPreview(undefined);
  }, [selectionRange.start, selectionRange.end, selectionKey]);
  useEffect(() => {
    setPreview(undefined);
  }, [props.document.revision]);
  const scope: EditScope = {
    instanceIds: props.selection,
    range: { start: Math.round(start * 240000), end: Math.round(end * 240000) },
    preserveDuration: true,
    ripple: false,
  };
  const validScope =
    props.selection.length > 0 &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start &&
    scope.range.end <= props.document.settings.duration;
  async function getContext() {
    if (!validScope) return;
    setBusy(true);
    try {
      const result = await props.api<unknown>("context", { scope, text });
      if (result.ok) setContext(JSON.stringify(result.value, null, 2));
      else props.notify(result.error.message);
    } catch (error) {
      props.notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  function template() {
    const requestId = crypto.randomUUID();
    const change: ChangeSet = {
      protocolVersion: 1,
      requestId,
      baseRevision: props.document.revision,
      transaction: {
        id: requestId,
        baseRevision: props.document.revision,
        author: "agent",
        scope,
        commands: [],
      },
      explanation: "",
      evidenceRefs: [],
    };
    setDraft(JSON.stringify(change, null, 2));
    setPreview(undefined);
  }
  async function validate() {
    setPreview(undefined);
    setBusy(true);
    try {
      const change: unknown = JSON.parse(draft);
      const result = await props.api<{ baseRevision: number; transaction: EditTransaction }>("patch", {
        change,
        dryRun: true,
      });
      if (result.ok) setPreview({ draft, ...result.value });
      else props.notify(`${result.error.code}: ${result.error.message}`);
    } catch (error) {
      props.notify(error instanceof SyntaxError ? "Check the ChangeSet JSON format." : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview || preview.draft !== draft || preview.baseRevision !== props.document.revision) return;
    setBusy(true);
    try {
      const result = await props.api<unknown>("patch", { change: JSON.parse(draft), dryRun: false });
      if (result.ok) {
        setPreview(undefined);
        await props.refresh();
        props.notify("Applied the changes. Undo is available.");
      } else {
        setPreview(undefined);
        props.notify(`${result.error.code}: ${result.error.message}`);
      }
    } catch (error) {
      props.notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel-stack" aria-label="External agent">
      <h2>External agent</h2>
      <p className="muted">Share context for the selected range and review changes from an external agent.</p>
      <div className="field-row">
        <span className="badge">Document r{props.document.revision}</span>
        <span className="muted">Selected: {props.selection.length}</span>
      </div>
      {!props.selection.length && <p className="muted">Select targets in the timeline.</p>}
      <div className="field-row">
        <label>
          Start (seconds)
          <input
            type="number"
            step="0.01"
            min="0"
            value={start}
            onChange={(event) => {
              setStart(Number(event.target.value));
              setPreview(undefined);
            }}
          />
        </label>
        <label>
          End (seconds)
          <input
            type="number"
            step="0.01"
            value={end}
            onChange={(event) => {
              setEnd(Number(event.target.value));
              setPreview(undefined);
            }}
          />
        </label>
      </div>
      <label>
        Related motion question
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Optional: rhythm contrast"
        />
      </label>
      <button type="button" disabled={busy || !validScope} onClick={() => void getContext()}>
        Get selection context
      </button>
      {context && (
        <div className="card panel-stack">
          <label>
            JSON for the agent
            <textarea rows={10} value={context} readOnly />
          </label>
          <div className="field-row">
            <button
              type="button"
              onClick={() => {
                if (!navigator.clipboard) {
                  props.notify("Select and copy the JSON text manually.");
                  return;
                }
                void navigator.clipboard
                  .writeText(context)
                  .then(() => props.notify("Context JSON copied."))
                  .catch(() => props.notify("Select and copy the JSON text manually."));
              }}
            >
              Copy context
            </button>
            <button type="button" onClick={() => download(context, "motiframe-context.json")}>
              Save JSON
            </button>
          </div>
        </div>
      )}
      <div className="field-row">
        <h3>Change proposal</h3>
        <button type="button" disabled={!validScope || busy} onClick={template}>
          Create empty ChangeSet
        </button>
      </div>
      <label>
        ChangeSet JSON
        <textarea
          rows={14}
          value={draft}
          placeholder="Paste a ChangeSet JSON from your external agent."
          onChange={(event) => {
            setDraft(event.target.value);
            setPreview(undefined);
          }}
        />
      </label>
      <button type="button" disabled={!draft.trim() || busy} onClick={() => void validate()}>
        Validate changes
      </button>
      {preview && (
        <div className="card">
          <strong>Validated changes · r{preview.baseRevision}</strong>
          <p className="muted">The document has not changed yet.</p>
          <pre>{JSON.stringify(preview.transaction.commands, null, 2)}</pre>
          <button
            className="primary"
            type="button"
            disabled={busy || preview.draft !== draft || preview.baseRevision !== props.document.revision}
            onClick={() => void apply()}
          >
            Apply validated changes
          </button>
        </div>
      )}
    </section>
  );
}
