import type { ElementManifest } from "../../document/src/schema";
import { defineHtmlElement } from "./html";
import { defineReactElement, MotionSlot, MotionTarget } from "./react";
import type { ElementDefinition } from "./types";
export function builtinDefinition(manifest: ElementManifest): ElementDefinition {
  if (manifest.moduleHash === "builtin:react-words")
    return defineReactElement(manifest, ({ props }) => (
      <>
        {(Array.isArray(props.words) ? props.words : []).map((word) => (
          <MotionTarget key={String(word)} targetKey={`item-${String(word)}`}>
            <div style={{ width: 32, height: 32, color: "white", fontFamily: "sans-serif" }}>
              {String(word)}
            </div>
          </MotionTarget>
        ))}
      </>
    ));
  if (manifest.moduleHash === "builtin:react-group")
    return defineReactElement(manifest, ({ props }) => (
      <div style={{ width: Number(props.width ?? 0), height: Number(props.height ?? 0) }}>
        <MotionSlot slotId="children" />
      </div>
    ));
  if (manifest.moduleHash === "builtin:react-rect")
    return defineReactElement(manifest, ({ props }) => (
      <div
        style={{ width: Number(props.width), height: Number(props.height), background: String(props.color) }}
      />
    ));
  if (manifest.moduleHash === "builtin:html-rect")
    return defineHtmlElement(manifest, {
      html: '<div class="rectangle"></div>',
      css: ".rectangle{box-sizing:border-box}",
      bindings: [
        { selector: ".rectangle", prop: "color", kind: "style", name: "background" },
        { selector: ".rectangle", prop: "width", kind: "style", name: "width", unit: "px" },
        { selector: ".rectangle", prop: "height", kind: "style", name: "height", unit: "px" },
      ],
    });
  throw new Error(`Unknown definition ${manifest.moduleHash}`);
}
