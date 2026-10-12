import type { ElementManifest } from "../../document/src/schema";
import type { ReactDefinition } from "./types";
export function defineReactElement(
  manifest: ElementManifest,
  component: ReactDefinition["component"],
): ReactDefinition {
  return { manifest, kind: "react", component };
}
