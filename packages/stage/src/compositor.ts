export function applyMotion(target: HTMLElement, values: Record<string, number>) {
  const style = target.style;
  style.transform = `translate3d(${values.x ?? 0}px,${values.y ?? 0}px,${values.z ?? 0}px) rotateX(${values.rotateX ?? 0}deg) rotateY(${values.rotateY ?? 0}deg) rotateZ(${values.rotateZ ?? 0}deg) scale(${values.scaleX ?? 1},${values.scaleY ?? 1})`;
  style.opacity = String(Math.min(1, Math.max(0, values.opacity ?? 1)));
  style.perspective = values.perspective ? `${values.perspective}px` : "";
  style.clipPath =
    values.clipProgress === undefined
      ? ""
      : `inset(0 ${100 * (1 - Math.min(1, Math.max(0, values.clipProgress)))}% 0 0)`;
}
