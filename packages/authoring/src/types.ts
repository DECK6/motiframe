import type { ComponentType } from "react";
import type { ElementManifest, FrameContext, JsonValue } from "../../document/src/schema";
export type ElementProps = { props: Record<string, JsonValue>; frame: FrameContext };
export type HtmlBinding = {
  selector: string;
  prop: string;
  kind: "text" | "style" | "attribute";
  name?: string;
  unit?: string;
};
export type ReactDefinition = {
  manifest: ElementManifest;
  kind: "react";
  component: ComponentType<ElementProps>;
};
export type HtmlDefinition = {
  manifest: ElementManifest;
  kind: "html";
  html: string;
  css: string;
  bindings: HtmlBinding[];
};
export type ElementDefinition = ReactDefinition | HtmlDefinition;
