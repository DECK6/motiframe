import type { ProjectDocument } from "../../../document/src/schema";
import { compileProject } from "../compile";
import { lintScore } from "../score/lint";
export type QualityObservation = {
  range: { start: number; end: number };
  observation: string;
  status: "keep" | "revise" | "unverified";
  source: string;
};
export type QualityReport = {
  technical: QualityObservation[];
  implementation: QualityObservation[];
  perception: QualityObservation[];
};
export function reviewProject(doc: ProjectDocument): QualityReport {
  const range = { start: 0, end: doc.settings.duration },
    compiled = compileProject(doc),
    issues = lintScore(doc);
  return {
    technical: [
      {
        range,
        observation: compiled.ok
          ? "Document references, time and channel curves compile."
          : compiled.error.message,
        status: compiled.ok ? "keep" : "revise",
        source: "compileProject",
      },
    ],
    implementation: issues.map((issue) => ({
      range: issue.range,
      observation: issue.message,
      status: "revise",
      source: `lintScore:${issue.code}`,
    })),
    perception: [
      {
        range,
        observation: "Speed: inspect projected screen movement separately from channel derivatives.",
        status: "unverified",
        source: "human playback review",
      },
      {
        range,
        observation: "Tension: inspect preparation, unresolved state and intended release.",
        status: "unverified",
        source: "human playback review",
      },
      {
        range,
        observation: "Rhythm: inspect primary action, responses, reading windows and rests.",
        status: "unverified",
        source: "human playback review",
      },
    ],
  };
}
