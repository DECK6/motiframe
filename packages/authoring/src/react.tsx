import type { ReactNode } from "react";
import type { ElementManifest } from "../../document/src/schema";
import type { ReactDefinition } from "./types";
export function MotionTarget({ targetKey, children }: { targetKey: string; children: ReactNode }) {
  return (
    <div
      data-motion-target={targetKey}
      style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0" }}
    >
      {children}
    </div>
  );
}
export function MotionSlot({ slotId }: { slotId: string }) {
  return <div data-motion-slot={slotId} style={{ position: "relative" }} />;
}
export function defineReactElement(
  manifest: ElementManifest,
  component: ReactDefinition["component"],
): ReactDefinition {
  return { manifest, kind: "react", component };
}
