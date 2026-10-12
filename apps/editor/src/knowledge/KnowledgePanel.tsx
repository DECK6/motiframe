import { useRef, useState } from "react";
import type { JsonValue } from "../../../../packages/document/src/schema";
import type {
  EvidenceCandidate,
  EvidenceLimit,
  EvidencePacket,
} from "../../../../packages/knowledge/src/schema";
import type { PanelProps } from "../types";

const limitLabels: Record<EvidenceLimit, string> = {
  audio_unverified: "Audio unverified",
  continuous_playback_unverified: "Continuous playback unverified",
  sampled_frames_only: "Sampled frame evidence",
  speed_unmeasured: "Speed unmeasured",
  interpretation_not_observation: "Includes interpretation",
  no_representative_image: "No representative image",
  image_unavailable: "Image unavailable",
  rights_unverified: "Image rights unverified",
  hangul_reading_unverified: "Hangul reading unverified",
  catalog_not_viewing: "Catalog entry is not viewing",
};
const classLabels = {
  observation: "Observation",
  measurement: "Measurement",
  creator_statement: "Creator statement",
  interpretation: "Interpretation",
};
type Phrase = { id: string; primaryActor: string; range: { start: number; end: number } };
function phrase(value: JsonValue): value is Phrase {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    typeof value.primaryActor === "string" &&
    !!value.range &&
    typeof value.range === "object" &&
    !Array.isArray(value.range) &&
    typeof value.range.start === "number" &&
    typeof value.range.end === "number"
  );
}

export default function KnowledgePanel(props: PanelProps) {
  const [text, setText] = useState("Slow tension");
  const [packet, setPacket] = useState<EvidencePacket>();
  const [busy, setBusy] = useState(false);
  const [chosenPhrase, setChosenPhrase] = useState("");
  const request = useRef(0);
  const phrases = props.document.score.phrases.filter(phrase);
  const selectedPhrase =
    phrases.find((item) => item.id === chosenPhrase) ??
    phrases.find(
      (item) =>
        item.range.start <= props.tick &&
        item.range.end > props.tick &&
        props.selection.includes(item.primaryActor),
    );
  async function search(query = text) {
    const current = ++request.current;
    setText(query);
    setBusy(true);
    try {
      const result = await props.api<EvidencePacket>("knowledge", { text: query });
      if (current !== request.current) return;
      if (result.ok) setPacket(result.value);
      else props.notify(result.error.message);
    } catch (error) {
      props.notify(String(error));
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  async function pin(candidate: EvidenceCandidate) {
    if (!packet || !selectedPhrase) return;
    const reference = {
      id: `reference:${selectedPhrase.id}:${candidate.conceptId}`,
      snapshotHash: packet.snapshotHash,
      conceptIds: [candidate.conceptId],
      caseIds: candidate.caseIds,
      sceneIds: candidate.sceneIds,
      phraseId: selectedPhrase.id,
      appliedRange: selectedPhrase.range,
      targetIds: [selectedPhrase.primaryActor],
      limits: candidate.limits,
    };
    const saved = await props.submit([{ type: "SetReference", reference }]);
    if (saved) props.notify(`Linked ${candidate.conceptId} evidence to ${selectedPhrase.id}.`);
  }
  return (
    <section className="panel-stack" aria-label="Motion knowledge">
      <h2>Motion knowledge</h2>
      <form
        className="field-row"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label>
          Concept or question
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Slow tension, Rhythm contrast, Hangul type"
          />
        </label>
        <button type="submit" disabled={busy || !text.trim()}>
          {busy ? "Searching…" : "Find evidence"}
        </button>
      </form>
      <div className="field-row">
        {["Slow tension", "Rhythm contrast", "Hangul type"].map((query) => (
          <button key={query} type="button" disabled={busy} onClick={() => void search(query)}>
            {query}
          </button>
        ))}
      </div>
      <label>
        Target phrase
        <select value={selectedPhrase?.id ?? ""} onChange={(event) => setChosenPhrase(event.target.value)}>
          <option value="">Select a phrase</option>
          {phrases.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} · {(item.range.start / 240000).toFixed(2)}–{(item.range.end / 240000).toFixed(2)}s
            </option>
          ))}
        </select>
      </label>
      {!phrases.length && <p className="muted">Create a score phrase to attach evidence to its range.</p>}
      {packet?.candidates.length === 0 && (
        <p role="status" className="muted">
          No matching concepts. Try a concept ID or a different phrase.
        </p>
      )}
      {packet?.candidates.map((candidate) => (
        <article className="card" key={candidate.conceptId}>
          <div className="field-row">
            <strong>{candidate.label}</strong>
            <span className="badge">{candidate.conceptId}</span>
          </div>
          <p>{candidate.definition}</p>
          <div className="field-row">
            {candidate.evidenceClasses.map((kind) => (
              <span className="badge" key={kind}>
                {classLabels[kind]}
              </span>
            ))}
          </div>
          <details open>
            <summary>Application conditions</summary>
            <ul>
              {candidate.applyWhen.map((condition, index) => (
                <li key={`${index}:${condition}`}>{condition}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Counterexamples and exclusions</summary>
            <ul>
              {candidate.counterexamples.map((example, index) => (
                <li key={`${index}:${example}`}>{example}</li>
              ))}
            </ul>
          </details>
          <p className="muted">{candidate.limits.map((limit) => limitLabels[limit]).join(" · ")}</p>
          {candidate.images.length ? (
            <details>
              <summary>
                Scenes: {candidate.sceneIds.length} · Image references: {candidate.images.length}
              </summary>
              <p className="muted">
                Image files are not included in this distribution. A reference entry does not establish
                viewing.
              </p>
              <ul>
                {candidate.images.map((item) => (
                  <li key={item.id}>
                    {item.sceneId ?? item.id} · {item.status === "unavailable" ? "Unavailable" : "Referenced"}{" "}
                    · Not viewed
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="muted">This concept has no representative image.</p>
          )}
          <details>
            <summary>Evidence scope and source limits</summary>
            <ul>
              {[...candidate.scopes, ...candidate.sourceLimits].map((scope, index) => (
                <li key={`${index}:${scope}`}>{scope}</li>
              ))}
            </ul>
          </details>
          <button
            className="primary"
            type="button"
            disabled={!selectedPhrase}
            onClick={() => void pin(candidate)}
          >
            Attach evidence to phrase
          </button>
        </article>
      ))}
      {props.document.references.length > 0 && (
        <p className="muted">Attached references: {props.document.references.length}</p>
      )}
    </section>
  );
}
