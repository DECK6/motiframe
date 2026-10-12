import type { ElementManifest } from "../../document/src/schema";
import type { HtmlDefinition } from "./types";
export function defineHtmlElement(
  manifest: ElementManifest,
  template: Omit<HtmlDefinition, "manifest" | "kind">,
): HtmlDefinition {
  return { manifest, kind: "html", ...template };
}
