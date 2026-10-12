import { type ReactNode, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { builtinDefinition } from "../../authoring/src/builtins";
import type { ElementDefinition } from "../../authoring/src/types";
import { fail, ok, type Result } from "../../document/src/result";
import type { FrameContext, ProjectDocument } from "../../document/src/schema";
export type Rect = { x: number; y: number; width: number; height: number };
export type FrameReceipt = {
  frameToken: string;
  documentRevision: number;
  tick: number;
  ready: true;
  targetBounds: Record<string, Rect>;
  warnings: string[];
};
function Committed({ children, done }: { children: ReactNode; done: () => void }) {
  useLayoutEffect(done, [done]);
  return children;
}
export class StagePort {
  private project: ProjectDocument | undefined;
  private elements = new Map<string, { host: HTMLElement; definition: ElementDefinition; root?: Root }>();
  constructor(private container: HTMLElement) {}
  async load(project: ProjectDocument): Promise<Result<void>> {
    await this.dispose();
    this.project = project;
    Object.assign(this.container.style, {
      position: "relative",
      width: `${project.settings.width}px`,
      height: `${project.settings.height}px`,
      overflow: "hidden",
      background: "#000",
    });
    for (const track of project.tracks) {
      for (const id of track.instanceIds) {
        const instance = project.instances[id];
        if (!instance) return fail("MISSING_INSTANCE", id, [id]);
        const manifest = project.definitions[instance.definitionId];
        if (!manifest) return fail("MISSING_DEFINITION", instance.definitionId);
        const definition = builtinDefinition(manifest);
        const host = document.createElement("div");
        host.dataset.instance = id;
        host.dataset.motionTarget = "root";
        host.dataset.authoring = definition.kind;
        Object.assign(host.style, { position: "absolute", left: "0px", top: "0px", transformOrigin: "0 0" });
        this.container.append(host);
        if (definition.kind === "react") this.elements.set(id, { host, definition, root: createRoot(host) });
        else {
          host.innerHTML = definition.html;
          this.elements.set(id, { host, definition });
        }
      }
    }
    return ok(undefined);
  }
  async renderFrame(context: FrameContext): Promise<Result<FrameReceipt>> {
    const project = this.project;
    if (!project) return fail("NOT_LOADED", "Load a project before rendering");
    for (const [id, element] of this.elements) {
      const instance = project.instances[id];
      const { host, definition, root } = element;
      if (definition.kind === "react" && root) {
        const Component = definition.component;
        await new Promise<void>((resolve) =>
          root.render(
            <Committed done={resolve}>
              <Component props={instance.props} frame={context} />
            </Committed>,
          ),
        );
      } else if (definition.kind === "html") {
        for (const binding of definition.bindings) {
          for (const target of host.querySelectorAll<HTMLElement>(binding.selector)) {
            const value = String(instance.props[binding.prop] ?? "") + (binding.unit ?? "");
            if (binding.kind === "text") target.textContent = value;
            else if (binding.kind === "style" && binding.name) target.style.setProperty(binding.name, value);
            else if (binding.kind === "attribute" && binding.name) target.setAttribute(binding.name, value);
          }
        }
      }
      const values: Record<string, number> = {};
      for (const c of Object.values(project.channels)) {
        if (c.target.instanceId === id && c.target.targetKey === "root")
          values[c.target.channel] = Number(c.keys[0]?.value ?? 0);
      }
      host.style.transform = `translate3d(${values.x ?? 0}px,${values.y ?? 0}px,${values.z ?? 0}px) scale(${values.scaleX ?? 1},${values.scaleY ?? 1})`;
      host.style.opacity = String(values.opacity ?? 1);
    }
    await document.fonts.ready;
    await Promise.all([...this.container.querySelectorAll("img")].map((image) => image.decode()));
    const targetBounds: Record<string, Rect> = {};
    for (const [id, { host }] of this.elements) {
      const r = host.getBoundingClientRect();
      targetBounds[`${id}/root`] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return ok({
      frameToken: context.frameToken,
      documentRevision: context.documentRevision,
      tick: context.tick,
      ready: true,
      targetBounds,
      warnings: [],
    });
  }
  async dispose(): Promise<void> {
    for (const e of this.elements.values()) e.root?.unmount();
    this.elements.clear();
    this.container.replaceChildren();
  }
}
const host = document.getElementById("stage");
if (!host) throw new Error("Stage container is missing");
declare global {
  interface Window {
    motiframe: StagePort;
  }
}
window.motiframe = new StagePort(host);
