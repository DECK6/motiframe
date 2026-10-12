import * as React from "react";
import { type ReactNode, useLayoutEffect } from "react";
import * as JSX from "react/jsx-runtime";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { builtinDefinition } from "../../authoring/src/builtins";
import { defineHtmlElement } from "../../authoring/src/html";
import { defineReactElement, MotionSlot, MotionTarget } from "../../authoring/src/react";
import { ThreeCanvas } from "../../authoring/src/three";
import * as ToneTools from "../../authoring/src/tone";
import type { ElementDefinition } from "../../authoring/src/types";
import { compileProject, type MotionIR } from "../../core/src/compile";
import { evaluateFrame, type FramePlan } from "../../core/src/evaluate";
import { fail, ok, type Result } from "../../document/src/result";
import type { FrameContext, ProjectDocument } from "../../document/src/schema";
import { applyMotion } from "./compositor";
import { FrameBarrier, untilReady } from "./frame-barrier";
import { collectTargets } from "./targets";
export type Rect = { x: number; y: number; width: number; height: number };
export type StageAssets = { fonts: { family: string; url: string }[] };
export type FrameReceipt = {
  frameToken: string;
  documentRevision: number;
  tick: number;
  ready: true;
  targetBounds: Record<string, Rect>;
  warnings: string[];
};
type Mounted = { host: HTMLElement; content: ShadowRoot; definition: ElementDefinition; root?: Root };
function Committed({ children, done }: { children: ReactNode; done: () => void }) {
  useLayoutEffect(done, [done]);
  return children;
}
export class StagePort {
  private ir: MotionIR | undefined;
  private elements = new Map<string, Mounted>();
  private barrier = new FrameBarrier();
  private renderError: Error | undefined;
  private fonts: FontFace[] = [];
  private definitions: Record<string, ElementDefinition> = {};
  registerDefinition(id: string, definition: ElementDefinition) {
    this.definitions[id] = definition;
  }
  constructor(private container: HTMLElement) {}
  async load(
    input: ProjectDocument | MotionIR,
    definitions?: Record<string, ElementDefinition>,
    assets?: StageAssets,
  ): Promise<Result<void>> {
    await this.dispose();
    const compiled = "document" in input ? ok(input) : compileProject(input);
    if (!compiled.ok) return compiled;
    this.ir = compiled.value;
    const project = this.ir.document;
    Object.assign(this.container.style, {
      position: "relative",
      width: `${project.settings.width}px`,
      height: `${project.settings.height}px`,
      overflow: "hidden",
      background: "#000",
    });
    try {
      for (const font of assets?.fonts ?? []) {
        const face = new FontFace(font.family, `url(${JSON.stringify(font.url)})`);
        await face.load();
        document.fonts.add(face);
        this.fonts.push(face);
      }
      for (const id of this.ir.order) {
        const instance = project.instances[id];
        const manifest = project.definitions[instance.definitionId];
        const definition =
          definitions?.[instance.definitionId] ??
          this.definitions[`${manifest.id}@${manifest.revision}`] ??
          builtinDefinition(manifest);
        const host = document.createElement("div");
        host.dataset.instance = id;
        host.dataset.motionTarget = "root";
        host.dataset.authoring = definition.kind;
        Object.assign(host.style, { position: "absolute", left: "0px", top: "0px", transformOrigin: "0 0" });
        const content = host.attachShadow({ mode: "open" });
        this.container.append(host);
        if (definition.kind === "react")
          this.elements.set(id, {
            host,
            content,
            definition,
            root: createRoot(content, {
              onUncaughtError: (error) => {
                this.renderError = error instanceof Error ? error : new Error(String(error));
                this.barrier.cancel("ELEMENT_ERROR");
              },
            }),
          });
        else {
          const style = document.createElement("style");
          style.textContent = definition.css;
          content.append(style);
          const template = document.createElement("template");
          template.innerHTML = definition.html;
          content.append(template.content.cloneNode(true));
          this.elements.set(id, { host, content, definition });
        }
      }
      return ok(undefined);
    } catch (error) {
      return fail("LOAD_FAILED", String(error));
    }
  }
  async renderFrame(input: FrameContext | FramePlan): Promise<Result<FrameReceipt>> {
    if (!this.ir) return fail("NOT_LOADED", "Load a project before rendering");
    const evaluation = "instances" in input ? ok(input) : evaluateFrame(this.ir, input);
    if (!evaluation.ok) return evaluation;
    const plan = evaluation.value;
    if (plan.documentRevision !== this.ir.documentRevision)
      return fail("REVISION_CONFLICT", "Frame revision does not match loaded project");
    const signal = this.barrier.begin();
    this.renderError = undefined;
    try {
      for (const instance of plan.instances) {
        signal.throwIfAborted();
        const element = this.elements.get(instance.id);
        if (!element) throw new Error("UNKNOWN_INSTANCE");
        const { host, content, definition, root } = element;
        host.style.display = instance.visible ? "" : "none";
        const props = { ...instance.props };
        for (const channel of plan.channelValues) {
          if (
            channel.target.instanceId === instance.id &&
            channel.target.targetKey === "root" &&
            channel.target.channel.startsWith("props.")
          )
            props[channel.target.channel.slice(6)] = channel.value;
        }
        const frame = {
          ...plan,
          tick: instance.localTick,
          frame: Math.floor((instance.localTick * this.ir.document.settings.fps.num) / 240000),
        };
        if (definition.kind === "react" && root) {
          const Component = definition.component;
          await untilReady(
            new Promise<void>((resolve) =>
              root.render(
                <Committed done={resolve}>
                  <Component props={props} frame={frame} />
                </Committed>,
              ),
            ),
            signal,
          );
        } else if (definition.kind === "html") {
          for (const binding of definition.bindings) {
            for (const target of content.querySelectorAll<HTMLElement>(binding.selector)) {
              const value = String(props[binding.prop] ?? "") + (binding.unit ?? "");
              if (binding.kind === "text") target.textContent = value;
              else if (binding.kind === "style" && binding.name)
                target.style.setProperty(binding.name, value);
              else if (binding.kind === "attribute" && binding.name) target.setAttribute(binding.name, value);
            }
          }
        }
        signal.throwIfAborted();
      }
      // Both authoring kinds share one ownerDocument; ShadowRoot confines author CSS.
      for (const instance of plan.instances) {
        const element = this.elements.get(instance.id);
        if (!element) continue;
        if (instance.parentId) {
          const parent = this.elements.get(instance.parentId);
          const slot = [...(parent?.content.querySelectorAll<HTMLElement>("[data-motion-slot]") ?? [])].find(
            (s) => s.dataset.motionSlot === instance.slotId,
          );
          if (!slot) throw new Error("MISSING_SLOT");
          if (element.host.parentNode !== slot) slot.append(element.host);
        }
        const targets = collectTargets(element.host, element.content);
        for (const target of element.definition.manifest.targets)
          if (!targets.has(target.key)) throw new Error(`MISSING_TARGET:${instance.id}/${target.key}`);
        for (const [key, target] of targets) {
          const values: Record<string, number> = {};
          for (const c of plan.channelValues)
            if (
              c.target.instanceId === instance.id &&
              c.target.targetKey === key &&
              typeof c.value === "number"
            )
              values[c.target.channel] = c.value;
          applyMotion(target, values);
        }
        await untilReady(
          Promise.all(
            [...element.content.querySelectorAll("img")]
              .filter((i) => instance.visible && i.getAttribute("src"))
              .map((i) => i.decode()),
          ),
          signal,
        );
      }
      await untilReady(document.fonts.ready, signal);
      signal.throwIfAborted();
      if (this.renderError) throw this.renderError;
      const targetBounds: Record<string, Rect> = {};
      const origin = this.container.getBoundingClientRect();
      for (const [id, element] of this.elements) {
        for (const [key, target] of collectTargets(element.host, element.content)) {
          const r = target.getBoundingClientRect();
          targetBounds[`${id}/${key}`] = {
            x: r.x - origin.x,
            y: r.y - origin.y,
            width: r.width,
            height: r.height,
          };
        }
      }
      return ok({
        frameToken: plan.frameToken,
        documentRevision: plan.documentRevision,
        tick: plan.tick,
        ready: true,
        targetBounds,
        warnings: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fail(message.split(":")[0], message);
    }
  }
  async dispose(): Promise<void> {
    this.barrier.cancel();
    for (const e of this.elements.values()) e.root?.unmount();
    this.elements.clear();
    for (const font of this.fonts) document.fonts.delete(font);
    this.fonts = [];
    this.container.replaceChildren();
    this.ir = undefined;
  }
}
const host = document.getElementById("stage");
if (!host) throw new Error("Stage container is missing");
declare global {
  interface Window {
    motiframe: StagePort;
    MotiFrameSDK: {
      ThreeCanvas: typeof ThreeCanvas;
      defineReactElement: typeof defineReactElement;
      defineHtmlElement: typeof defineHtmlElement;
      MotionTarget: typeof MotionTarget;
      MotionSlot: typeof MotionSlot;
    };
    MotiFrameReact: typeof React;
    MotiFrameJSX: typeof JSX;
    MotiFrameThree: typeof THREE;
    MotiFrameTone: typeof ToneTools;
  }
}
window.motiframe = new StagePort(host);
window.MotiFrameSDK = { defineReactElement, defineHtmlElement, MotionTarget, MotionSlot, ThreeCanvas };
window.MotiFrameThree = THREE;
window.MotiFrameTone = ToneTools;
window.MotiFrameReact = React;
window.MotiFrameJSX = JSX;
