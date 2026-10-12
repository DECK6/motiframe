import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { fail, ok, type Result } from "./result";
import { type ProjectDocument, parseProject } from "./schema";

export const DEFAULT_BUNDLE_EXPANSION_LIMIT = 4 * 1024 ** 3;
export type BundleFile = {
  path: string;
  size: number;
  sha256: string;
  role: "project" | "asset" | "definition" | "lock";
};
export type ExternalReference = {
  id: string;
  logicalPath: string;
  sha256: string;
  kind: string;
  status: "relink_required";
};
export type BundleManifest = {
  schemaVersion: 1;
  mode: "embedded" | "references";
  files: BundleFile[];
  externalReferences: ExternalReference[];
  dependencies?: unknown;
};
export type BundleArtifact = { path: string; manifest: BundleManifest };
export type BundleSelection = {
  projectDir: string;
  outputPath: string;
  mode?: "embedded" | "references";
  maxExpandedBytes?: number;
};
type Entry = { name: string; data: Buffer };
class BundleFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function reject(code: string, message: string): never {
  throw new BundleFailure(code, message);
}
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const failure = (error: unknown): Result<never> =>
  fail(
    error instanceof BundleFailure ? error.code : "BUNDLE_IO",
    error instanceof Error ? error.message : "Bundle operation failed",
  );

/** ZIP names are portable forward-slash paths; refuse aliases on common desktop filesystems. */
function safeName(name: string): string {
  if (
    typeof name !== "string" ||
    !name ||
    name.includes("\\") ||
    name.includes(":") ||
    name.startsWith("/") ||
    /[\x00-\x1f\x7f]/.test(name) ||
    name
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /^(\.env(?:\..*)?|\.git|\.ssh|\.runtime|node_modules|\.cache)$/i.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    reject("INVALID_BUNDLE_PATH", "Invalid portable bundle path");
  return name;
}
function checkNames(names: string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    const folded = safeName(name).normalize("NFC").toLowerCase();
    if (seen.has(folded))
      reject("BUNDLE_PATH_COLLISION", "Bundle paths collide after case or Unicode normalization");
    seen.add(folded);
  }
  for (const name of seen) {
    const segments = name.split("/");
    for (let end = 1; end < segments.length; end++)
      if (seen.has(segments.slice(0, end).join("/")))
        reject("BUNDLE_PATH_COLLISION", "Bundle file also serves as a directory");
  }
}
function budget(value = DEFAULT_BUNDLE_EXPANSION_LIMIT): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_BUNDLE_EXPANSION_LIMIT)
    reject("BUNDLE_EXPANSION_LIMIT", "Expansion budget must be between 1 byte and 4 GiB");
  return value;
}
function portableContent(value: unknown): void {
  const visit = (item: unknown) => {
    if (
      typeof item === "string" &&
      /(?:\/(?:Users|Volumes|home|private|tmp)\/|file:\/\/|[A-Za-z]:\\)/.test(item)
    )
      reject("NON_PORTABLE_PROJECT", "Private absolute paths cannot be exported");
    if (Array.isArray(item)) item.forEach(visit);
    else if (plain(item))
      for (const [key, child] of Object.entries(item)) {
        if (/^(api[_-]?key|authorization|password|secret|access[_-]?token)$/i.test(key) && child)
          reject("NON_PORTABLE_PROJECT", "Credentials cannot be exported");
        visit(child);
      }
  };
  visit(value);
}
async function admittedFile(
  root: string,
  relativeName: string,
  maxBytes = DEFAULT_BUNDLE_EXPANSION_LIMIT,
): Promise<Buffer> {
  safeName(relativeName);
  let cursor = root;
  for (const segment of relativeName.split("/")) {
    cursor = path.join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink())
      reject("INVALID_BUNDLE_PATH", "Symlinks cannot enter bundles");
  }
  const resolved = await realpath(cursor),
    relative = path.relative(root, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !(await stat(resolved)).isFile()
  )
    reject("INVALID_BUNDLE_PATH", "Bundle input is outside the project");
  if ((await stat(resolved)).size > maxBytes)
    reject("BUNDLE_EXPANSION_LIMIT", "Bundle input exceeds the remaining size budget");
  return readFile(resolved);
}
function assetReferences(document: ProjectDocument): ExternalReference[] {
  return Object.entries(document.assets).map(([id, value]) => {
    if (
      !plain(value) ||
      typeof value.logicalPath !== "string" ||
      typeof value.sha256 !== "string" ||
      !digestPattern.test(value.sha256)
    )
      return reject("INVALID_ASSET_REFERENCE", "Assets need a logicalPath and SHA-256");
    safeName(value.logicalPath);
    return {
      id,
      logicalPath: value.logicalPath,
      sha256: value.sha256,
      kind: typeof value.kind === "string" ? value.kind : "unknown",
      status: "relink_required",
    };
  });
}

// Standard ZIP CRC-32. CRC detects container corruption; the manifest SHA-256 binds file content.
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries: Entry[], maxBytes: number): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0,
    expanded = 0;
  if (entries.length > 10000) reject("INVALID_BUNDLE", "Too many bundle entries");
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"),
      size = entry.data.length,
      crc = crc32(entry.data);
    expanded += size;
    if (expanded > maxBytes || size >= 0xffffffff || name.length > 65535)
      reject("BUNDLE_EXPANSION_LIMIT", "Bundle exceeds expansion budget");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(size, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(size, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((0o100600 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, entry.data);
    central.push(directory, name);
    offset += header.length + name.length + size;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  if (offset + directory.length >= 0xffffffff)
    reject("BUNDLE_EXPANSION_LIMIT", "ZIP64 archives are not supported");
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function unzip(bytes: Buffer, maxBytes: number): Entry[] {
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--)
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) {
      eocd = at;
      break;
    }
  if (eocd < 0 || bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0)
    reject("INVALID_BUNDLE", "Invalid or multi-disk ZIP");
  const count = bytes.readUInt16LE(eocd + 10),
    start = bytes.readUInt32LE(eocd + 16),
    size = bytes.readUInt32LE(eocd + 12);
  if (count > 10000 || count !== bytes.readUInt16LE(eocd + 8) || start + size !== eocd)
    reject("INVALID_BUNDLE", "Invalid central directory");
  let cursor = start,
    expanded = 0;
  const descriptors: {
    name: string;
    size: number;
    compressedSize: number;
    offset: number;
    method: number;
    crc: number;
    flags: number;
  }[] = [];
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > eocd || bytes.readUInt32LE(cursor) !== 0x02014b50)
      reject("INVALID_BUNDLE", "Invalid ZIP entry");
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      crc = bytes.readUInt32LE(cursor + 16),
      compressedSize = bytes.readUInt32LE(cursor + 20),
      length = bytes.readUInt32LE(cursor + 24),
      nameLength = bytes.readUInt16LE(cursor + 28),
      extraLength = bytes.readUInt16LE(cursor + 30),
      commentLength = bytes.readUInt16LE(cursor + 32),
      offset = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLength + extraLength + commentLength > eocd)
      reject("INVALID_BUNDLE", "Truncated central entry");
    const unixMode = bytes.readUInt32LE(cursor + 38) >>> 16;
    if ((unixMode & 0xf000) === 0xa000) reject("INVALID_BUNDLE_PATH", "Archive symlinks are forbidden");
    if (
      (flags & ~0x808) !== 0 ||
      ![0, 8].includes(method) ||
      bytes.readUInt16LE(cursor + 34) !== 0 ||
      compressedSize === 0xffffffff ||
      length === 0xffffffff
    )
      reject("INVALID_BUNDLE", "Unsupported ZIP encryption, method or ZIP64");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      name = nameBytes.toString("utf8");
    if (!Buffer.from(name).equals(nameBytes)) reject("INVALID_BUNDLE_PATH", "Invalid UTF-8 path");
    safeName(name);
    expanded += length;
    if (expanded > maxBytes) reject("BUNDLE_EXPANSION_LIMIT", "Archive expands beyond the configured budget");
    descriptors.push({ name, size: length, compressedSize, offset, method, crc, flags });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== eocd) reject("INVALID_BUNDLE", "Central directory boundary mismatch");
  checkNames(descriptors.map((item) => item.name));
  const ranges: [number, number][] = [];
  return descriptors.map((item) => {
    const at = item.offset;
    if (at + 30 > start || bytes.readUInt32LE(at) !== 0x04034b50)
      reject("INVALID_BUNDLE", "Invalid local header");
    const nameLength = bytes.readUInt16LE(at + 26),
      extraLength = bytes.readUInt16LE(at + 28),
      dataStart = at + 30 + nameLength + extraLength,
      end = dataStart + item.compressedSize;
    if (
      end > start ||
      bytes.subarray(at + 30, at + 30 + nameLength).toString("utf8") !== item.name ||
      bytes.readUInt16LE(at + 6) !== item.flags ||
      bytes.readUInt16LE(at + 8) !== item.method
    )
      reject("INVALID_BUNDLE", "Local/central header mismatch");
    if (
      !(item.flags & 8) &&
      (bytes.readUInt32LE(at + 14) !== item.crc ||
        bytes.readUInt32LE(at + 18) !== item.compressedSize ||
        bytes.readUInt32LE(at + 22) !== item.size)
    )
      reject("INVALID_BUNDLE", "Local size or CRC mismatch");
    if (ranges.some(([begin, previousEnd]) => at < previousEnd && end > begin))
      reject("INVALID_BUNDLE", "Overlapping archive entries");
    ranges.push([at, end]);
    const compressed = bytes.subarray(dataStart, end);
    let data: Buffer;
    try {
      data =
        item.method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: Math.max(1, item.size) });
    } catch {
      return reject("INVALID_BUNDLE", "Invalid or oversized compressed entry");
    }
    if (data.length !== item.size || crc32(data) !== item.crc)
      reject("INVALID_BUNDLE", "Entry size or CRC mismatch");
    return { name: item.name, data };
  });
}

export async function packProject(
  document: ProjectDocument,
  selection: BundleSelection,
): Promise<Result<BundleArtifact>> {
  try {
    const parsed = parseProject(document);
    if (!parsed.ok) return parsed;
    portableContent(parsed.value);
    const maxBytes = budget(selection.maxExpandedBytes),
      root = await realpath(selection.projectDir),
      mode = selection.mode ?? "embedded";
    if (!["embedded", "references"].includes(mode)) return fail("INVALID_BUNDLE", "Unknown bundle mode");
    const assets = assetReferences(parsed.value),
      entries: Entry[] = [],
      files: BundleFile[] = [];
    const moduleHashes = [
      ...new Set(
        Object.values(parsed.value.definitions)
          .map((definition) => definition.moduleHash)
          .filter((value) => !value.startsWith("builtin:")),
      ),
    ];
    for (const hash of moduleHashes)
      if (!digestPattern.test(hash))
        reject("MISSING_DEFINITION", "Custom definition needs a SHA-256 module hash");
    checkNames([
      "project.json",
      "manifest.json",
      "dependency-lock.json",
      ...assets.map((asset) => asset.logicalPath),
      ...moduleHashes.flatMap((hash) => [`definitions/${hash}.js`, `definitions/${hash}.source.json`]),
    ]);
    let expanded = 0;
    const add = (name: string, data: Buffer, role: BundleFile["role"]) => {
      expanded += data.length;
      if (expanded > maxBytes) reject("BUNDLE_EXPANSION_LIMIT", "Bundle exceeds expansion budget");
      entries.push({ name, data });
      files.push({ path: name, size: data.length, sha256: sha(data), role });
    };
    add("project.json", Buffer.from(`${JSON.stringify(parsed.value, null, 2)}\n`), "project");
    if (mode === "embedded")
      for (const asset of assets) {
        let data: Buffer;
        try {
          data = await admittedFile(root, asset.logicalPath, maxBytes - expanded);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return fail("MISSING_ASSET", "Referenced asset is missing", [asset.id]);
          throw error;
        }
        if (sha(data) !== asset.sha256)
          return fail("BUNDLE_HASH_MISMATCH", "Asset bytes differ from the document hash", [asset.id]);
        add(asset.logicalPath, data, "asset");
      }
    for (const hash of moduleHashes) {
      let data: Buffer;
      try {
        data = await admittedFile(root, `definitions/${hash}.js`, maxBytes - expanded);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return fail("MISSING_DEFINITION", "Definition module is missing", [hash]);
        throw error;
      }
      if (sha(data) !== hash) return fail("BUNDLE_HASH_MISMATCH", "Definition module hash mismatch", [hash]);
      portableContent(data.toString("utf8"));
      add(`definitions/${hash}.js`, data, "definition");
      try {
        const source = await admittedFile(root, `definitions/${hash}.source.json`, maxBytes - expanded);
        portableContent(JSON.parse(source.toString("utf8")));
        add(`definitions/${hash}.source.json`, source, "definition");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    let dependencies: unknown = {
      runtime: parsed.value.provenance.runtime,
      sdk: parsed.value.provenance.sdk,
      modules: moduleHashes,
    };
    try {
      dependencies = JSON.parse(
        (await admittedFile(root, "runtime-lock.json", maxBytes - expanded)).toString("utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    portableContent(dependencies);
    add("dependency-lock.json", Buffer.from(`${JSON.stringify(dependencies, null, 2)}\n`), "lock");
    const manifest: BundleManifest = {
      schemaVersion: 1,
      mode,
      files,
      externalReferences: mode === "references" ? assets : [],
      dependencies,
    };
    const output = path.resolve(selection.outputPath),
      data = zip(
        [...entries, { name: "manifest.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }],
        maxBytes,
      );
    await mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.${randomUUID()}.tmp`,
      handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return fail("OUTPUT_EXISTS", "Choose a new bundle output path; existing files are preserved");
      throw error;
    }
    return ok({ path: output, manifest });
  } catch (error) {
    return failure(error);
  }
}

export async function unpackProject(
  bundle: string,
  destination: string,
  options: { maxExpandedBytes?: number } = {},
): Promise<Result<ProjectDocument>> {
  try {
    const maxBytes = budget(options.maxExpandedBytes);
    if ((await stat(bundle)).size > maxBytes + 16 * 1024 ** 2)
      reject("BUNDLE_EXPANSION_LIMIT", "Archive exceeds size budget");
    const entries = unzip(await readFile(bundle), maxBytes),
      lookup = new Map(entries.map((entry) => [entry.name, entry.data]));
    const rawManifest = lookup.get("manifest.json");
    if (!rawManifest) reject("BUNDLE_MANIFEST_MISMATCH", "Bundle manifest is missing");
    const manifest: unknown = JSON.parse(rawManifest.toString("utf8"));
    if (
      !plain(manifest) ||
      manifest.schemaVersion !== 1 ||
      !["embedded", "references"].includes(String(manifest.mode)) ||
      !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.externalReferences)
    )
      reject("BUNDLE_MANIFEST_MISMATCH", "Invalid manifest schema");
    const declarations = manifest.files as unknown[];
    const declaredNames: string[] = [];
    for (const file of declarations) {
      if (
        !plain(file) ||
        typeof file.path !== "string" ||
        typeof file.size !== "number" ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        typeof file.sha256 !== "string" ||
        !digestPattern.test(file.sha256) ||
        !["project", "asset", "definition", "lock"].includes(String(file.role))
      )
        reject("BUNDLE_MANIFEST_MISMATCH", "Invalid manifest file entry");
      declaredNames.push(file.path);
      const data = lookup.get(file.path);
      if (!data) reject("BUNDLE_MANIFEST_MISMATCH", "Declared file is missing");
      if (file.size !== data.length || file.sha256 !== sha(data))
        reject("BUNDLE_HASH_MISMATCH", "Manifest size/hash mismatch");
    }
    checkNames(["manifest.json", ...declaredNames]);
    if (
      declaredNames.length + 1 !== entries.length ||
      entries.some((entry) => entry.name !== "manifest.json" && !declaredNames.includes(entry.name))
    )
      reject("BUNDLE_MANIFEST_MISMATCH", "Archive contains an undeclared entry");
    const project = lookup.get("project.json");
    if (!project) reject("BUNDLE_MANIFEST_MISMATCH", "Project document is missing");
    const parsed = parseProject(JSON.parse(project.toString("utf8")));
    if (!parsed.ok) return parsed;
    portableContent(parsed.value);
    portableContent(manifest);
    const references = assetReferences(parsed.value);
    const allowed = new Map<string, BundleFile["role"]>([
      ["project.json", "project"],
      ["dependency-lock.json", "lock"],
    ]);
    if (manifest.mode === "embedded") for (const asset of references) allowed.set(asset.logicalPath, "asset");
    for (const definition of Object.values(parsed.value.definitions))
      if (!definition.moduleHash.startsWith("builtin:")) {
        if (!digestPattern.test(definition.moduleHash))
          reject("BUNDLE_MANIFEST_MISMATCH", "Invalid definition module hash");
        allowed.set(`definitions/${definition.moduleHash}.js`, "definition");
        allowed.set(`definitions/${definition.moduleHash}.source.json`, "definition");
      }
    for (const declared of declarations as BundleFile[]) {
      if (allowed.get(declared.path) !== declared.role)
        reject("BUNDLE_MANIFEST_MISMATCH", "File is outside the document asset/definition scope");
      if (declared.role === "definition") {
        const contents = lookup.get(declared.path)!;
        portableContent(
          declared.path.endsWith(".json") ? JSON.parse(contents.toString("utf8")) : contents.toString("utf8"),
        );
      }
    }
    const lock = lookup.get("dependency-lock.json");
    if (!lock) reject("BUNDLE_MANIFEST_MISMATCH", "Dependency lock is missing");
    portableContent(JSON.parse(lock.toString("utf8")));
    checkNames([
      "project.json",
      "manifest.json",
      "dependency-lock.json",
      ...references.map((asset) => asset.logicalPath),
    ]);
    if (manifest.mode === "embedded") {
      if (manifest.externalReferences.length)
        reject("BUNDLE_MANIFEST_MISMATCH", "Embedded bundle cannot carry external references");
      for (const asset of references)
        if (!lookup.has(asset.logicalPath) || sha(lookup.get(asset.logicalPath)!) !== asset.sha256)
          reject("BUNDLE_HASH_MISMATCH", "Document asset does not match the bundle");
    } else if (JSON.stringify(manifest.externalReferences) !== JSON.stringify(references))
      reject("BUNDLE_MANIFEST_MISMATCH", "External reference manifest does not match the document");
    for (const definition of Object.values(parsed.value.definitions))
      if (!definition.moduleHash.startsWith("builtin:")) {
        const module = lookup.get(`definitions/${definition.moduleHash}.js`);
        if (!module || sha(module) !== definition.moduleHash)
          reject("BUNDLE_HASH_MISMATCH", "Definition module does not match the document");
      }
    const target = path.resolve(destination),
      parent = path.dirname(target);
    try {
      await lstat(target);
      return fail("DESTINATION_EXISTS", "Choose a new destination directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(parent, { recursive: true });
    const staging = path.join(parent, `.${path.basename(target)}.${randomUUID()}.staging`);
    await mkdir(staging, { mode: 0o700 });
    for (const entry of entries) {
      const output = path.join(staging, entry.name);
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, entry.data, { mode: 0o600, flag: "wx" });
    }
    await rename(staging, target);
    return ok(parsed.value);
  } catch (error) {
    return failure(error);
  }
}
