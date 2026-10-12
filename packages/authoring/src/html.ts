import type { ElementManifest } from "../../document/src/schema";
import type { HtmlDefinition } from "./types";
export function defineHtmlElement(
  manifest: ElementManifest,
  template: Omit<HtmlDefinition, "manifest" | "kind">,
): HtmlDefinition {
  for (const binding of template.bindings)
    if (
      binding.kind === "style" &&
      (!binding.name || (!binding.name.startsWith("--") && /[A-Z]/.test(binding.name)))
    )
      throw new Error("HTML style bindings require CSS property names, such as background-color");
  return { manifest, kind: "html", ...template };
}
