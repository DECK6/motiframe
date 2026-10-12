import type { HistoryState } from "./history";
import { fail, ok, type Result } from "./result";
import { type ProjectDocument, parseProject } from "./schema";
export type BrowserAsset = {
  projectId: string;
  assetId: string;
  name: string;
  mimeType: string;
  sha256: string;
  dataUrl: string;
};
export type BrowserStorage = {
  load: () => Promise<Result<HistoryState | undefined>>;
  save: (state: HistoryState, assets?: BrowserAsset[]) => Promise<Result<void>>;
  assets: (projectId: string) => Promise<Result<BrowserAsset[]>>;
};
const storageError = (error: unknown) =>
  fail(
    error instanceof DOMException && error.name === "QuotaExceededError"
      ? "QUOTA_EXCEEDED"
      : "BROWSER_STORAGE_FAILED",
    error instanceof Error ? error.message : String(error),
  );
export function createMemoryBrowserStorage(): BrowserStorage {
  let state: HistoryState | undefined;
  const assets = new Map<string, BrowserAsset>();
  return {
    load: async () => ok(state ? structuredClone(state) : undefined),
    save: async (next, files = []) => {
      state = structuredClone(next);
      for (const asset of files) assets.set(`${asset.projectId}:${asset.assetId}`, structuredClone(asset));
      return ok(undefined);
    },
    assets: async (projectId) =>
      ok([...assets.values()].filter((a) => a.projectId === projectId).map((a) => structuredClone(a))),
  };
}
export function createBrowserStorage(
  options: { databaseName?: string; indexedDB?: IDBFactory } = {},
): BrowserStorage {
  let connection: Promise<IDBDatabase> | undefined;
  const open = () =>
    (connection ??= new Promise((resolve, reject) => {
      const factory = options.indexedDB ?? globalThis.indexedDB;
      if (!factory) {
        reject(new Error("IndexedDB is unavailable in this browser"));
        return;
      }
      const request = factory.open(options.databaseName ?? "motiframe-offline", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("history")) db.createObjectStore("history");
        if (!db.objectStoreNames.contains("assets"))
          db.createObjectStore("assets", { keyPath: ["projectId", "assetId"] });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close the other tab using an older offline database"));
      request.onsuccess = () => resolve(request.result);
    }));
  return {
    load: async () => {
      try {
        const db = await open();
        return await new Promise<Result<HistoryState | undefined>>((resolve) => {
          const request = db.transaction("history", "readonly").objectStore("history").get("active");
          request.onsuccess = () => resolve(ok(request.result));
          request.onerror = () => resolve(storageError(request.error));
        });
      } catch (error) {
        return storageError(error);
      }
    },
    save: async (state, assets = []) => {
      try {
        const db = await open();
        return await new Promise<Result<void>>((resolve) => {
          const tx = db.transaction(["history", "assets"], "readwrite");
          tx.objectStore("history").put(structuredClone(state), "active");
          for (const asset of assets) tx.objectStore("assets").put(structuredClone(asset));
          tx.oncomplete = () => resolve(ok(undefined));
          tx.onabort = () => resolve(storageError(tx.error));
          tx.onerror = () => resolve(storageError(tx.error));
        });
      } catch (error) {
        return storageError(error);
      }
    },
    assets: async (projectId) => {
      try {
        const db = await open();
        return await new Promise<Result<BrowserAsset[]>>((resolve) => {
          const request = db.transaction("assets", "readonly").objectStore("assets").getAll();
          request.onsuccess = () =>
            resolve(ok((request.result as BrowserAsset[]).filter((a) => a.projectId === projectId)));
          request.onerror = () => resolve(storageError(request.error));
        });
      } catch (error) {
        return storageError(error);
      }
    },
  };
}
const safePath = (name: string) =>
  typeof name === "string" &&
  name.length > 0 &&
  !name.startsWith("/") &&
  !/[\\:\x00-\x1f\x7f]/.test(name) &&
  !name
    .split("/")
    .some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[ .]$/.test(p) ||
        /^(\.env(?:\..*)?|\.git|\.ssh|\.runtime|node_modules|\.cache)$/i.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    );
function portableValue(value: unknown): boolean {
  if (typeof value === "string")
    return !/(?:\/(?:Users|Volumes|home|private|tmp)\/|file:\/\/|[A-Za-z]:\\)/.test(value);
  if (Array.isArray(value)) return value.every(portableValue);
  if (value && typeof value === "object")
    return Object.entries(value).every(
      ([key, child]) =>
        !(/^(api[_-]?key|authorization|password|secret|access[_-]?token)$/i.test(key) && child) &&
        portableValue(child),
    );
  return true;
}
export function serializeBrowserProject(input: ProjectDocument): Result<string> {
  const parsed = parseProject(input);
  if (!parsed.ok) return parsed;
  const paths = new Set(["project.json", "manifest.json", "dependency-lock.json"]);
  for (const [id, value] of Object.entries(parsed.value.assets)) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.logicalPath !== "string" ||
      !safePath(value.logicalPath) ||
      typeof value.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.sha256)
    )
      return fail("ASSET_PATH_DENIED", "Assets need safe project-relative paths and a SHA-256", [id]);
    const folded = value.logicalPath.normalize("NFC").toLowerCase();
    if (paths.has(folded)) return fail("BUNDLE_PATH_COLLISION", "Asset paths collide", [id]);
    paths.add(folded);
  }
  for (const name of paths) {
    const segments = name.split("/");
    for (let end = 1; end < segments.length; end++)
      if (paths.has(segments.slice(0, end).join("/")))
        return fail("BUNDLE_PATH_COLLISION", "A project file also serves as a directory");
  }
  if (!portableValue(parsed.value))
    return fail("NON_PORTABLE_PROJECT", "Remove private filesystem paths and credentials before exporting");
  return ok(JSON.stringify(parsed.value, null, 2) + "\n");
}
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(hash), (v) => v.toString(16).padStart(2, "0")).join("");
}
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${/^[\w.+-]+\/[\w.+-]+$/.test(mimeType) ? mimeType : "application/octet-stream"};base64,${btoa(binary)}`;
}
export function dataUrlToBytes(url: string): Result<Uint8Array> {
  try {
    const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]*)$/.exec(url);
    if (!match) return fail("INVALID_ASSET", "Expected a base64 data URL");
    return ok(Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)));
  } catch {
    return fail("INVALID_ASSET", "Invalid asset encoding");
  }
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder("utf-8", { fatal: true });
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
};
function zipStore(entries: { name: string; bytes: Uint8Array }[]): Blob {
  const local: Uint8Array[] = [],
    central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name),
      crc = crc32(entry.bytes),
      head = new Uint8Array(30),
      v = new DataView(head.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, entry.bytes.length, true);
    v.setUint32(22, entry.bytes.length, true);
    v.setUint16(26, name.length, true);
    local.push(head, name, entry.bytes);
    const c = new Uint8Array(46),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.bytes.length, true);
    cv.setUint32(24, entry.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.push(c, name);
    offset += head.length + name.length + entry.bytes.length;
  }
  const directory = join(central),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory.length, true);
  ev.setUint32(16, offset, true);
  return new Blob([join([...local, directory, end])], { type: "application/zip" });
}
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
export async function exportBrowserBundle(
  document: ProjectDocument,
  assets: BrowserAsset[],
): Promise<Result<Blob>> {
  try {
    const serialized = serializeBrowserProject(document);
    if (!serialized.ok) return serialized;
    if (Object.values(document.definitions).some((d) => !d.moduleHash.startsWith("builtin:")))
      return fail("RUNNER_REQUIRED", "Custom definition bundles require the local runner");
    const entries: { name: string; bytes: Uint8Array; role: string }[] = [
      { name: "project.json", bytes: encoder.encode(serialized.value), role: "project" },
    ];
    for (const [id, value] of Object.entries(document.assets)) {
      const metadata = value as { logicalPath: string; sha256: string };
      const asset = assets.find((a) => a.assetId === id && a.projectId === document.id);
      if (!asset) return fail("ASSET_UNAVAILABLE", "Asset bytes are missing from browser storage", [id]);
      const decoded = dataUrlToBytes(asset.dataUrl);
      if (!decoded.ok) return decoded;
      if ((await sha256Bytes(decoded.value)) !== metadata.sha256)
        return fail("BUNDLE_HASH_MISMATCH", "Asset content does not match the project", [id]);
      const existing = entries.find((e) => e.name === metadata.logicalPath);
      if (existing) {
        if ((await sha256Bytes(existing.bytes)) !== metadata.sha256)
          return fail("DUPLICATE_BUNDLE_PATH", "Asset paths disagree");
      } else entries.push({ name: metadata.logicalPath, bytes: decoded.value, role: "asset" });
    }
    const dependencies = { runtime: document.provenance.runtime, sdk: document.provenance.sdk, modules: [] };
    entries.push({
      name: "dependency-lock.json",
      bytes: encoder.encode(JSON.stringify(dependencies)),
      role: "lock",
    });
    if (entries.reduce((n, e) => n + e.bytes.length, 0) > MAX_BUNDLE_BYTES)
      return fail("BUNDLE_EXPANSION_LIMIT", "Browser bundle exceeds 256 MiB");
    const files = await Promise.all(
      entries.map(async (e) => ({
        path: e.name,
        size: e.bytes.length,
        sha256: await sha256Bytes(e.bytes),
        role: e.role,
      })),
    );
    entries.push({
      name: "manifest.json",
      bytes: encoder.encode(
        JSON.stringify({ schemaVersion: 1, mode: "embedded", files, externalReferences: [], dependencies }),
      ),
      role: "manifest",
    });
    return ok(zipStore(entries));
  } catch (error) {
    return fail("BUNDLE_IO", String(error));
  }
}
async function unzip(blob: Blob): Promise<Result<Map<string, Uint8Array>>> {
  try {
    if (blob.size > MAX_BUNDLE_BYTES) return fail("BUNDLE_EXPANSION_LIMIT", "Archive is too large");
    const bytes = new Uint8Array(await blob.arrayBuffer()),
      view = new DataView(bytes.buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
        eocd = i;
        break;
      }
    if (eocd < 0) return fail("INVALID_BUNDLE", "Missing ZIP directory");
    if (view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true))
      return fail("INVALID_BUNDLE", "Multipart ZIP is unsupported");
    const count = view.getUint16(eocd + 10, true),
      size = view.getUint32(eocd + 12, true);
    const directoryStart = view.getUint32(eocd + 16, true);
    let cursor = directoryStart,
      expanded = 0;
    if (count > 4096 || count !== view.getUint16(eocd + 8, true) || cursor + size !== eocd)
      return fail("INVALID_BUNDLE", "Invalid ZIP directory");
    const files = new Map<string, Uint8Array>(),
      names = new Set<string>(),
      ranges: [number, number][] = [];
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > eocd || view.getUint32(cursor, true) !== 0x02014b50)
        return fail("INVALID_BUNDLE", "Invalid ZIP entry");
      const flags = view.getUint16(cursor + 8, true),
        method = view.getUint16(cursor + 10, true),
        crc = view.getUint32(cursor + 16, true),
        compressed = view.getUint32(cursor + 20, true),
        length = view.getUint32(cursor + 24, true),
        nameLength = view.getUint16(cursor + 28, true),
        extra = view.getUint16(cursor + 30, true),
        comment = view.getUint16(cursor + 32, true),
        attributes = view.getUint32(cursor + 38, true),
        local = view.getUint32(cursor + 42, true);
      if (cursor + 46 + nameLength + extra + comment > eocd)
        return fail("INVALID_BUNDLE", "Truncated ZIP entry");
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength)),
        folded = name.normalize("NFC").toLowerCase();
      if (
        !safePath(name) ||
        names.has(folded) ||
        ((attributes >>> 16) & 0xf000) === 0xa000 ||
        (flags & ~0x808) !== 0 ||
        view.getUint16(cursor + 34, true) !== 0 ||
        ![0, 8].includes(method)
      )
        return fail("INVALID_BUNDLE_PATH", "Unsafe or unsupported archive entry", [name]);
      expanded += length;
      if (expanded > MAX_BUNDLE_BYTES)
        return fail("BUNDLE_EXPANSION_LIMIT", "Archive expansion exceeds 256 MiB");
      if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50)
        return fail("INVALID_BUNDLE", "Invalid local entry");
      const localNameLength = view.getUint16(local + 26, true),
        localExtra = view.getUint16(local + 28, true),
        start = local + 30 + localNameLength + localExtra;
      if (
        decoder.decode(bytes.slice(local + 30, local + 30 + localNameLength)) !== name ||
        start + compressed > directoryStart ||
        view.getUint16(local + 6, true) !== flags ||
        view.getUint16(local + 8, true) !== method
      )
        return fail("INVALID_BUNDLE", "Local and central entries disagree");
      if (
        !(flags & 8) &&
        (view.getUint32(local + 14, true) !== crc ||
          view.getUint32(local + 18, true) !== compressed ||
          view.getUint32(local + 22, true) !== length)
      )
        return fail("INVALID_BUNDLE", "Local size or CRC disagrees with the directory");
      if (ranges.some(([begin, end]) => local < end && start + compressed > begin))
        return fail("INVALID_BUNDLE", "Archive entries overlap");
      ranges.push([local, start + compressed]);
      let data = bytes.slice(start, start + compressed);
      if (method === 8) {
        if (typeof DecompressionStream === "undefined")
          return fail("UNSUPPORTED_COMPRESSION", "This browser cannot decompress this ZIP");
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const reader = stream.getReader(),
          chunks: Uint8Array[] = [];
        let read = 0;
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          read += part.value.length;
          if (read > length || read > MAX_BUNDLE_BYTES) {
            await reader.cancel();
            return fail("BUNDLE_EXPANSION_LIMIT", "Decompressed size exceeds its declaration");
          }
          chunks.push(part.value);
        }
        data = join(chunks);
      }
      if (data.length !== length || crc32(data) !== crc)
        return fail("BUNDLE_HASH_MISMATCH", "ZIP content verification failed", [name]);
      files.set(name, data);
      names.add(folded);
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== eocd) return fail("INVALID_BUNDLE", "ZIP directory boundary mismatch");
    for (const name of names) {
      const segments = name.split("/");
      for (let end = 1; end < segments.length; end++)
        if (names.has(segments.slice(0, end).join("/")))
          return fail("INVALID_BUNDLE_PATH", "A bundle file also serves as a directory");
    }
    return ok(files);
  } catch (error) {
    return fail("INVALID_BUNDLE", String(error));
  }
}
const mimeFor = (name: string) => {
  const ext = name.split(".").at(-1)?.toLowerCase();
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        ttf: "font/ttf",
        otf: "font/otf",
        wav: "audio/wav",
        mp3: "audio/mpeg",
        mp4: "video/mp4",
        webm: "video/webm",
      } as Record<string, string>
    )[ext ?? ""] ?? "application/octet-stream"
  );
};
export async function importBrowserBundle(
  blob: Blob,
): Promise<Result<{ document: ProjectDocument; assets: BrowserAsset[] }>> {
  try {
    const unzipped = await unzip(blob);
    if (!unzipped.ok) return unzipped;
    const files = unzipped.value,
      manifest = JSON.parse(decoder.decode(files.get("manifest.json")));
    if (
      manifest.schemaVersion !== 1 ||
      manifest.mode !== "embedded" ||
      !Array.isArray(manifest.files) ||
      manifest.files.length + 1 !== files.size ||
      !portableValue(manifest) ||
      !Array.isArray(manifest.externalReferences) ||
      manifest.externalReferences.length
    )
      return fail("INVALID_BUNDLE", "Expected an embedded version 1 bundle");
    const declared = new Set<string>();
    for (const item of manifest.files) {
      const bytes = files.get(item.path);
      if (
        !safePath(item.path) ||
        !["project", "asset", "lock"].includes(item.role) ||
        declared.has(item.path) ||
        !bytes ||
        bytes.length !== item.size ||
        (await sha256Bytes(bytes)) !== item.sha256
      )
        return fail("BUNDLE_HASH_MISMATCH", "Manifest verification failed");
      declared.add(item.path);
    }
    if (
      !files.has("project.json") ||
      !files.has("dependency-lock.json") ||
      [...files.keys()].some((name) => name !== "manifest.json" && !declared.has(name))
    )
      return fail("INVALID_BUNDLE", "Archive manifest is incomplete");
    const parsed = parseProject(JSON.parse(decoder.decode(files.get("project.json"))));
    if (!parsed.ok) return parsed;
    const document = parsed.value,
      serialized = serializeBrowserProject(document);
    if (!serialized.ok) return serialized;
    if (Object.values(document.definitions).some((d) => !d.moduleHash.startsWith("builtin:")))
      return fail("RUNNER_REQUIRED", "Open custom element bundles with the local runner");
    const lock = JSON.parse(decoder.decode(files.get("dependency-lock.json")));
    if (!portableValue(lock)) return fail("NON_PORTABLE_PROJECT", "Dependency lock contains private data");
    const assets: BrowserAsset[] = [],
      allowed = new Map([
        ["project.json", "project"],
        ["dependency-lock.json", "lock"],
        ["manifest.json", "manifest"],
      ]);
    for (const [assetId, value] of Object.entries(document.assets)) {
      const metadata = value as { logicalPath: string; sha256: string },
        bytes = files.get(metadata.logicalPath);
      if (!bytes || (await sha256Bytes(bytes)) !== metadata.sha256)
        return fail("BUNDLE_HASH_MISMATCH", "Document asset verification failed", [assetId]);
      allowed.set(metadata.logicalPath, "asset");
      const mimeType = mimeFor(metadata.logicalPath);
      assets.push({
        projectId: document.id,
        assetId,
        name: metadata.logicalPath.split("/").at(-1)!,
        mimeType,
        sha256: metadata.sha256,
        dataUrl: bytesToDataUrl(bytes, mimeType),
      });
    }
    if (
      [...files.keys()].some((name) => !allowed.has(name)) ||
      manifest.files.some((item: { path: string; role: string }) => allowed.get(item.path) !== item.role)
    )
      return fail("INVALID_BUNDLE_PATH", "Archive contains files outside the document scope");
    return ok({ document, assets });
  } catch (error) {
    return fail("INVALID_BUNDLE", String(error));
  }
}
