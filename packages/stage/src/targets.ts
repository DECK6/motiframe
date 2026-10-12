export function collectTargets(host: HTMLElement, content: ShadowRoot): Map<string, HTMLElement> {
  const targets = new Map<string, HTMLElement>([["root", host]]);
  for (const target of content.querySelectorAll<HTMLElement>("[data-motion-target]")) {
    if (target.hasAttribute("data-instance")) continue;
    const key = target.dataset.motionTarget;
    if (!key) continue;
    if (targets.has(key)) throw new Error(`DUPLICATE_TARGET:${key}`);
    targets.set(key, target);
  }
  return targets;
}
