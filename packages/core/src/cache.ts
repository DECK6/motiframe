import type { ProjectDocument } from "../../document/src/schema";

export type FrameCacheInput = {
  projectId: string;
  documentHash: string;
  documentRevision: number;
  definitionRevisions: Record<string, number>;
  sourceHashes: Record<string, string>;
  assetHashes: Record<string, string>;
  fontHashes: Record<string, string>;
  runtimeHash: string;
  width: number;
  height: number;
  seed: number;
  tick: number;
};
export type InvalidationSet = {
  all: boolean;
  ranges: { start: number; end: number }[];
  instanceIds: string[];
  assetIds: string[];
  fontIds: string[];
  definitionIds: string[];
};
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}
/** Canonical complete keys avoid digest collisions and work in browser and runner runtimes. */
export function getFrameCacheKey(input: FrameCacheInput): string {
  return `motiframe-frame-v1:${canonical(input)}`;
}
function changedIds(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((id) => canonical(before[id]) !== canonical(after[id]))
    .sort();
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function absoluteStart(doc: ProjectDocument, id: string): number {
  let current = id,
    start = 0;
  const seen = new Set<string>();
  while (doc.instances[current]) {
    if (seen.has(current)) return NaN;
    seen.add(current);
    const instance = doc.instances[current];
    start += instance.start;
    if (!instance.parentId) {
      const scenes = Object.values(doc.scenes).filter((s) => s.rootIds.includes(current));
      return scenes.length === 1 ? start + scenes[0].start : NaN;
    }
    current = instance.parentId;
  }
  return NaN;
}
export function invalidateChanges(before: ProjectDocument, after: ProjectDocument): InvalidationSet {
  const definitionIds = changedIds(before.definitions, after.definitions),
    assetIds = changedIds(before.assets, after.assets),
    fontIds = assetIds.filter(
      (id) => record(before.assets[id]).kind === "font" || record(after.assets[id]).kind === "font",
    );
  let all =
    before.id !== after.id ||
    canonical(before.settings) !== canonical(after.settings) ||
    canonical(before.scenes) !== canonical(after.scenes) ||
    canonical(before.tracks) !== canonical(after.tracks) ||
    canonical(before.provenance) !== canonical(after.provenance) ||
    canonical(before.score) !== canonical(after.score) ||
    fontIds.length > 0;
  const instances = new Set([
    ...changedIds(before.instances, after.instances),
    ...changedIds(before.mediaClips, after.mediaClips),
  ]);
  for (const id of changedIds(before.channels, after.channels)) {
    const a = before.channels[id]?.target.instanceId,
      b = after.channels[id]?.target.instanceId;
    if (a) instances.add(a);
    if (b) instances.add(b);
  }
  for (const doc of [before, after])
    for (const [id, instance] of Object.entries(doc.instances)) {
      const assets = [
        ...(doc.definitions[instance.definitionId]?.assets ?? []),
        record(doc.mediaClips[id]).assetId,
        instance.props.assetId,
      ];
      if (definitionIds.includes(instance.definitionId) || assetIds.some((asset) => assets.includes(asset)))
        instances.add(id);
    }
  // Parent transforms, visibility and layout affect every child occupying its slots.
  for (const doc of [before, after])
    for (let n = 0; n < Object.keys(doc.instances).length; n++) {
      let grew = false;
      for (const [id, instance] of Object.entries(doc.instances))
        if (instance.parentId && instances.has(instance.parentId) && !instances.has(id)) {
          instances.add(id);
          grew = true;
        }
      if (!grew) break;
    }
  const ranges: { start: number; end: number }[] = [];
  for (const doc of [before, after])
    for (const id of instances) {
      const instance = doc.instances[id];
      if (!instance) continue;
      const start = absoluteStart(doc, id);
      if (!Number.isSafeInteger(start)) {
        all = true;
        continue;
      }
      const end = Math.min(doc.settings.duration, start + instance.duration);
      if (end > start) ranges.push({ start, end });
    }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const prior = merged.at(-1);
    if (prior && range.start <= prior.end) prior.end = Math.max(prior.end, range.end);
    else merged.push({ ...range });
  }
  return {
    all,
    ranges: all ? [{ start: 0, end: Math.max(before.settings.duration, after.settings.duration) }] : merged,
    instanceIds: [...instances].sort(),
    assetIds,
    fontIds,
    definitionIds,
  };
}
type Entry<T> = { input: FrameCacheInput; value: T; bytes: number };
/** Values are caller-owned immutable data; keys and dependency metadata are copied on admission. */
export class LruFrameCache<T> {
  private entries = new Map<string, Entry<T>>();
  private usedBytes = 0;
  private hits = 0;
  private misses = 0;
  private maxEntries: number;
  private maxBytes: number;
  constructor(options: { maxEntries?: number; maxBytes?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 128;
    this.maxBytes = options.maxBytes ?? 128 * 1024 ** 2;
    if (
      !Number.isSafeInteger(this.maxEntries) ||
      this.maxEntries < 1 ||
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1
    )
      throw new RangeError("Cache budgets must be positive integers");
  }
  get(input: FrameCacheInput): T | undefined {
    const key = getFrameCacheKey(input),
      entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(input: FrameCacheInput, value: T, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new RangeError("Cache byte size must be a nonnegative integer");
    const key = getFrameCacheKey(input),
      previous = this.entries.get(key);
    if (previous) {
      this.usedBytes -= previous.bytes;
      this.entries.delete(key);
    }
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { input: structuredClone(input), value, bytes });
    this.usedBytes += bytes;
    while (this.entries.size > this.maxEntries || this.usedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.usedBytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }
  invalidate(predicate: (input: FrameCacheInput) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.entries)
      if (predicate(structuredClone(entry.input))) {
        this.entries.delete(key);
        this.usedBytes -= entry.bytes;
        removed++;
      }
    return removed;
  }
  rebase(
    previous: { documentHash: string; documentRevision: number },
    next: Omit<FrameCacheInput, "tick">,
    changes: InvalidationSet,
  ): void {
    const retained: Entry<T>[] = [];
    for (const [key, entry] of this.entries) {
      if (
        entry.input.projectId !== next.projectId ||
        entry.input.documentHash !== previous.documentHash ||
        entry.input.documentRevision !== previous.documentRevision
      )
        continue;
      this.entries.delete(key);
      this.usedBytes -= entry.bytes;
      const globalSame =
        entry.input.runtimeHash === next.runtimeHash &&
        entry.input.width === next.width &&
        entry.input.height === next.height &&
        entry.input.seed === next.seed &&
        canonical(entry.input.fontHashes) === canonical(next.fontHashes);
      if (
        globalSame &&
        !changes.all &&
        !changes.ranges.some((range) => entry.input.tick >= range.start && entry.input.tick < range.end)
      )
        retained.push({ ...entry, input: { ...next, tick: entry.input.tick } });
    }
    for (const entry of retained) this.set(entry.input, entry.value, entry.bytes);
  }
  get stats() {
    return { entries: this.entries.size, bytes: this.usedBytes, hits: this.hits, misses: this.misses };
  }
}

export type BenchmarkReport = {
  environment: Record<string, string | number>;
  samples: number;
  cold: { p50Ms: number; p95Ms: number; failedFrames: number; durationsMs: number[] };
  warm: { p50Ms: number; p95Ms: number; failedFrames: number; durationsMs: number[] };
};
/** The caller supplies the real operation; the report never infers stage/GUI performance from evaluator timing. */
export async function benchmarkFrameWorkload(
  ticks: number[],
  render: (tick: number) => Promise<{ ok: boolean }>,
  environment: Record<string, string | number>,
): Promise<BenchmarkReport> {
  if (!ticks.length || ticks.length > 10000 || ticks.some((t) => !Number.isSafeInteger(t) || t < 0))
    throw new RangeError("Benchmark requires 1–10000 nonnegative integer frame ticks");
  const measure = async () => {
    const durationsMs: number[] = [];
    let failedFrames = 0;
    for (const tick of ticks) {
      const started = performance.now();
      try {
        if (!(await render(tick)).ok) failedFrames++;
      } catch {
        failedFrames++;
      }
      durationsMs.push(performance.now() - started);
    }
    const sorted = [...durationsMs].sort((a, b) => a - b),
      percentile = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    return { p50Ms: percentile(0.5), p95Ms: percentile(0.95), failedFrames, durationsMs };
  };
  return {
    environment: { ...environment },
    samples: ticks.length,
    cold: await measure(),
    warm: await measure(),
  };
}
