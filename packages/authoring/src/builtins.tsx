import { Fragment } from "react";
import type { TextUnit } from "../../core/src/type/segment";
import { evaluateSelector, type TextSelector } from "../../core/src/type/selector";
import type { ElementManifest } from "../../document/src/schema";
import { defineHtmlElement } from "./html";
import { defineReactElement, MotionSlot, MotionTarget } from "./react";
import type { ElementDefinition } from "./types";
export function builtinDefinition(manifest: ElementManifest): ElementDefinition {
  if (manifest.moduleHash === "builtin:react-text")
    return defineReactElement(manifest, ({ props, frame }) => (
      <div
        style={{
          width: Number(props.width ?? 500),
          height: Number(props.height ?? 100),
          fontSize: Number(props.fontSize ?? 48),
          fontFamily: String(props.fontFamily ?? "sans-serif"),
          fontWeight: Number(props.fontWeight ?? 700),
          color: String(props.color ?? "white"),
          whiteSpace: "pre-wrap",
          lineHeight: 1.2,
        }}
      >
        {Array.isArray(props.textUnits) && props.textSelector && typeof props.textSelector === "object"
          ? evaluateSelector(
              props.textUnits as TextUnit[],
              props.textSelector as TextSelector,
              frame.tick,
            ).map((unit) => (
              <Fragment key={unit.id}>
                <span
                  key={unit.id}
                  data-motion-text-unit={unit.id}
                  style={{
                    opacity: unit.weight,
                    display: "inline-block",
                    whiteSpace: "pre",
                    transform: `translateY(${(1 - unit.weight) * 16}px)`,
                  }}
                >
                  {unit.original.replace(/(?:\r\n|\r|\n)$/, "")}
                </span>
                {/(?:\r\n|\r|\n)$/.test(unit.original) && <br />}
              </Fragment>
            ))
          : String(props.text ?? "")}
      </div>
    ));
  if (manifest.moduleHash === "builtin:audio")
    return defineHtmlElement(manifest, { html: "<span></span>", css: "", bindings: [] });
  if (manifest.moduleHash === "builtin:media")
    return defineHtmlElement(manifest, {
      html: '<img class="media">',
      css: ".media{display:block;object-fit:cover}",
      bindings: [
        { selector: ".media", prop: "src", kind: "attribute", name: "src" },
        { selector: ".media", prop: "width", kind: "style", name: "width", unit: "px" },
        { selector: ".media", prop: "height", kind: "style", name: "height", unit: "px" },
      ],
    });
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
