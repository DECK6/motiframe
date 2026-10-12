import { useState } from "react";
import { compileScore, recipeChannels } from "../../../../packages/core/src/score/compile";
import { resolveHandoff } from "../../../../packages/core/src/score/handoff";
import { lintScore } from "../../../../packages/core/src/score/lint";
import { recipes } from "../../../../packages/core/src/score/recipes";
import {
  type Event,
  type Handoff,
  type RoleWindow,
  scoreSchema,
} from "../../../../packages/core/src/score/schema";
import type { EditCommand } from "../../../../packages/document/src/commands";
import { fail, ok, type Result } from "../../../../packages/document/src/result";
import type { ProjectDocument } from "../../../../packages/document/src/schema";
import type { PanelProps } from "../types";
export function commandsForEventChange(
  document: ProjectDocument,
  eventId: string,
  patch: Partial<Event>,
): Result<EditCommand[]> {
  const parsed = scoreSchema.safeParse(document.score);
  if (!parsed.success) return fail("INVALID_SCORE", "Score data is invalid.");
  if (!parsed.data.events.some((e) => e.id === eventId)) return fail("MISSING_EVENT", "Event not found.");
  const candidate = structuredClone(document);
  candidate.score.events = parsed.data.events.map((e) => (e.id === eventId ? { ...e, ...patch } : e));
  const compiled = compileScore(candidate);
  return compiled.ok ? ok(compiled.value.commands) : compiled;
}
export function recipeOwnershipCommands(
  document: ProjectDocument,
  actorIds: string[],
  grammar: string,
): EditCommand[] {
  return Object.entries(document.channels)
    .filter(([, channel]) => {
      if (
        !actorIds.includes(channel.target.instanceId) ||
        channel.owner !== "manual" ||
        !recipeChannels(grammar).includes(channel.target.channel)
      )
        return false;
      const instance = document.instances[channel.target.instanceId],
        definition = document.definitions[instance.definitionId],
        target = definition.targets.find((t) => t.key === "root") ?? definition.targets[0];
      return channel.target.targetKey === target?.key;
    })
    .map(([channelId]) => ({ type: "SetChannelOwner", channelId, owner: "recipe" }));
}
const recipeNames: Record<string, string> = {
  "phrase-exchange": "Phrase exchange",
  "anticipation-release": "Anticipation → release",
  "stagger-response": "Stagger and response",
  "anchor-wipe": "Anchor wipe",
  "match-cut": "Match cut",
  "hold-variation": "Hold and variation",
};
const eventNames: Record<Event["kind"], string> = {
  onset: "Onset",
  arrival: "Arrival",
  response: "Response",
  accent: "Accent",
  rest: "Rest",
  prepare: "Prepare",
  release: "Release",
};
const roleNames: Record<RoleWindow["role"], string> = {
  reading: "Reading",
  transform: "Transform",
  texture: "Texture",
  tension: "Tension",
  closure: "Closure",
};
export default function ScorePanel({ document, selection, tick, submit, refresh, notify, api }: PanelProps) {
  const [grammar, setGrammar] = useState("phrase-exchange"),
    [start, setStart] = useState(0),
    [end, setEnd] = useState(Math.min(3, document.settings.duration / 240000)),
    [role, setRole] = useState<RoleWindow["role"]>("reading"),
    [cue, setCue] = useState(""),
    [release, setRelease] = useState(""),
    [unresolved, setUnresolved] = useState(""),
    [intentional, setIntentional] = useState(true),
    [to, setTo] = useState(""),
    [mode, setMode] = useState<Handoff["mode"]>("match-cut"),
    [busy, setBusy] = useState(false);
  const parsed = scoreSchema.safeParse(document.score),
    score = parsed.success
      ? parsed.data
      : { phrases: [], events: [], windows: [], tensions: [], handoffs: [] },
    selected = selection.filter((id) => document.instances[id]),
    range = { start: Math.round(start * 240000), end: Math.round(end * 240000) },
    issues = lintScore(document),
    manual = recipeOwnershipCommands(document, selected, grammar);
  const invoke = async () => {
    if (!selected.length) {
      notify("Select the actors for this phrase.");
      return;
    }
    setBusy(true);
    try {
      const result = await api("recipe", {
        request: {
          id: `phrase:${document.revision}:${selected.join("-")}`,
          range,
          grammar,
          actorIds: selected,
          events: [],
          windows: [],
          handoffs: [],
        },
      });
      if (!result.ok) {
        notify(result.error.message);
        return;
      }
      await refresh();
      notify(`Applied ${recipeNames[grammar]}.`);
    } finally {
      setBusy(false);
    }
  };
  const changeEvent = (id: string, patch: Partial<Event>) => {
    const commands = commandsForEventChange(document, id, patch);
    if (!commands.ok) {
      notify(commands.error.message);
      return;
    }
    void submit(commands.value);
  };
  const addRole = () =>
    void submit([
      {
        type: "UpdateScore",
        score: {
          windows: [
            ...document.score.windows,
            { id: `role:${document.revision}`, range, targetIds: selected, role },
          ],
        },
      },
    ]);
  const addTension = () => {
    const cueEvent = cue || score.events[0]?.id;
    if (!cueEvent || !unresolved.trim()) {
      notify("Choose a cue event and describe the unresolved state.");
      return;
    }
    void submit([
      {
        type: "UpdateScore",
        score: {
          tensions: [
            ...document.score.tensions,
            {
              id: `tension:${document.revision}`,
              cueEvent,
              unresolvedState: unresolved,
              ...(release ? { releaseEvent: release } : {}),
              intentionalUnresolvedEnd: intentional,
            },
          ],
        },
      },
    ]);
  };
  const handoff = () => {
    const from = selected[0],
      target = to || selected[1] || Object.keys(document.instances).find((id) => id !== from);
    if (!from || !target) {
      notify("Select two layers for the handoff.");
      return;
    }
    const result = resolveHandoff(document, {
      id: `handoff:${document.revision}`,
      fromTarget: from,
      toTarget: target,
      at: tick,
      mode,
      preserve: ["position"],
    });
    if (!result.ok) {
      notify(result.error.message);
      return;
    }
    void submit(result.value.commands);
  };
  return (
    <div className="panel-stack">
      <div className="field-row">
        <span className="badge">Speed · channel curves</span>
        <span className="badge">Tension · {score.tensions.length} intents</span>
        <span className="badge">Rhythm · {score.events.length} events</span>
      </div>
      <div className="card">
        <strong>Create phrase</strong>
        <p className="muted">The first selected layer is the primary actor. Text and shapes are preserved.</p>
        <div className="field-row">
          <label htmlFor="score-recipe">Recipe</label>
          <select id="score-recipe" value={grammar} onChange={(e) => setGrammar(e.target.value)}>
            {recipes.map((r) => (
              <option value={r.id} key={r.id}>
                {recipeNames[r.id]}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label>
            Start (s)
            <input
              aria-label="Phrase start"
              type="number"
              min="0"
              max={document.settings.duration / 240000}
              step=".1"
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </label>
          <label>
            End (s)
            <input
              aria-label="Phrase end"
              type="number"
              min="0"
              max={document.settings.duration / 240000}
              step=".1"
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="muted">
          Primary {selected[0] ?? "No selection"}
          {selected.length > 1 ? ` · Supporting ${selected.slice(1).join(", ")}` : ""}
        </p>
        {manual.length > 0 && (
          <div>
            <p className="muted">
              {manual.length} required channels are manually owned. Transfer ownership before applying the
              recipe.
            </p>
            <button type="button" onClick={() => void submit(manual)}>
              Transfer channels to recipe
            </button>
          </div>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || !selected.length || manual.length > 0}
          onClick={() => void invoke()}
        >
          {busy ? "Applying…" : "Apply phrase"}
        </button>
      </div>
      <details open>
        <summary>Events · arrival timing</summary>
        <div className="panel-stack">
          {score.events.length === 0 ? (
            <p className="muted">Apply a phrase to create events linked to keyframes.</p>
          ) : (
            score.events.map((event) => (
              <div className="field-row" key={event.id}>
                <span className="badge" title={event.targetIds.join(", ")}>
                  {eventNames[event.kind]}
                </span>
                <label style={{ flex: 1 }}>
                  <span className="muted">{event.targetIds.join(", ")}</span>
                  <input
                    aria-label={`${event.id} event time`}
                    key={`${event.id}:${document.revision}`}
                    type="number"
                    min="0"
                    max={document.settings.duration / 240000}
                    step={1 / document.settings.fps.num}
                    defaultValue={event.tick / 240000}
                    onBlur={(e) => {
                      const next = Math.round(Number(e.target.value) * 240000);
                      if (next !== event.tick) changeEvent(event.id, { tick: next });
                    }}
                  />
                </label>
                <select
                  aria-label={`${event.id} event role`}
                  value={event.kind}
                  onChange={(e) => changeEvent(event.id, { kind: e.target.value as Event["kind"] })}
                >
                  {Object.entries(eventNames).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
        </div>
      </details>
      <details>
        <summary>Reading · transformation · holds</summary>
        <div className="panel-stack">
          <p className="muted">
            Apply the start and end range above to the selected layers. Meaningful long holds are preserved.
          </p>
          <div className="field-row">
            <select
              aria-label="Time window role"
              value={role}
              onChange={(e) => setRole(e.target.value as RoleWindow["role"])}
            >
              {Object.entries(roleNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" disabled={!selected.length} onClick={addRole}>
              Add window
            </button>
          </div>
          {score.windows.map((window) => (
            <div className="field-row" key={window.id}>
              <span className="badge">{roleNames[window.role]}</span>
              <span>
                {(window.range.start / 240000).toFixed(2)}–{(window.range.end / 240000).toFixed(2)}s
              </span>
              <button
                type="button"
                aria-label={`${window.id} remove window`}
                onClick={() =>
                  void submit([
                    {
                      type: "UpdateScore",
                      score: { windows: score.windows.filter((w) => w.id !== window.id) },
                    },
                  ])
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </details>
      <details>
        <summary>Tension and release</summary>
        <div className="panel-stack">
          <label>
            Cue event
            <select
              aria-label="Tension cue event"
              value={cue || score.events[0]?.id || ""}
              onChange={(e) => setCue(e.target.value)}
            >
              {score.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {eventNames[e.kind]} · {(e.tick / 240000).toFixed(2)}s
                </option>
              ))}
            </select>
          </label>
          <textarea
            rows={2}
            aria-label="Unresolved state"
            placeholder="Describe the unresolved state"
            value={unresolved}
            onChange={(e) => setUnresolved(e.target.value)}
          />
          <label>
            Release event
            <select
              aria-label="Tension release event"
              value={release}
              onChange={(e) => setRelease(e.target.value)}
            >
              <option value="">No release event</option>
              {score.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {eventNames[e.kind]} · {(e.tick / 240000).toFixed(2)}s
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={intentional} onChange={(e) => setIntentional(e.target.checked)} />{" "}
            The unresolved ending is intentional
          </label>
          <button type="button" onClick={addTension}>
            Add tension intent
          </button>
          {score.tensions.map((t) => (
            <p className="muted" key={t.id}>
              {t.unresolvedState} ·{" "}
              {t.releaseEvent
                ? "Release linked"
                : t.intentionalUnresolvedEnd
                  ? "Intentionally unresolved"
                  : "No release specified"}
            </p>
          ))}
        </div>
      </details>
      <details>
        <summary>Handoff to the next layer</summary>
        <div className="panel-stack">
          <p className="muted">
            Align layer positions at the playhead. Continuous handoffs require motion states before and after
            the transfer.
          </p>
          <div className="field-row">
            <span>{selected[0] ?? "Select a source layer"}</span>
            <span aria-hidden="true">→</span>
            <select
              aria-label="Handoff destination layer"
              value={
                to || selected[1] || Object.keys(document.instances).find((id) => id !== selected[0]) || ""
              }
              onChange={(e) => setTo(e.target.value)}
            >
              {Object.keys(document.instances)
                .filter((id) => id !== selected[0])
                .map((id) => (
                  <option value={id} key={id}>
                    {id}
                  </option>
                ))}
            </select>
          </div>
          <select
            aria-label="Handoff mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as Handoff["mode"])}
          >
            <option value="match-cut">Match cut · instant handoff</option>
            <option value="continuous">Continuous · preserve intermediate states</option>
          </select>
          <button type="button" disabled={!selected.length} onClick={handoff}>
            Handoff at playhead
          </button>
          {score.handoffs.map((h) => (
            <p className="muted" key={h.id}>
              {h.fromTarget} → {h.toTarget} · {(h.at / 240000).toFixed(2)}s
            </p>
          ))}
        </div>
      </details>
      {issues.length > 0 && (
        <details>
          <summary>Structural review · {issues.length} observations</summary>
          {issues.map((issue) => (
            <p className="muted" key={issue.id}>
              <span className="badge">{issue.severity === "warning" ? "Review" : "Info"}</span>{" "}
              {issue.message}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
