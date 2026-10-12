import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function tar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const name = "package/" + entry.name,
      header = Buffer.alloc(512);
    if (Buffer.byteLength(name) > 100) throw new Error("SDK archive path is too long: " + entry.name);
    header.write(name, 0, 100);
    header.write("0000644\0", 100, 8);
    header.write("0000000\0", 108, 8);
    header.write("0000000\0", 116, 8);
    header.write(entry.bytes.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    header.write("00000000000\0", 136, 12);
    header.fill(32, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257, 6);
    header.write("00", 263, 2);
    header.write(
      header
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
      8,
    );
    chunks.push(header, entry.bytes, Buffer.alloc((512 - (entry.bytes.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function declarations(directory, base = directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await declarations(file, base)));
    else if (entry.name.endsWith(".d.ts")) {
      // NodeNext consumers need explicit .js specifiers; TypeScript resolves the matching declarations.
      const source = (await readFile(file, "utf8")).replace(
        /(from\s+["']|import\(["'])(\.[^"']+)(["'])/g,
        (match, before, specifier, after) =>
          /\.[cm]?[jt]sx?$/.test(specifier) ? match : before + specifier + ".js" + after,
      );
      if (source.includes(root)) throw new Error("SDK declaration contains a workspace path");
      result.push({
        name: "types/" + path.relative(base, file).split(path.sep).join("/"),
        bytes: Buffer.from(source),
      });
    }
  }
  return result;
}

/** Build a local installable tarball. Never publishes or installs packages. */
export async function packageSdk(options = {}) {
  const destination = path.resolve(options.outputDir ?? path.join(root, "dist/sdk"));
  await mkdir(destination, { recursive: true });
  const staging = await mkdtemp(path.join(destination, ".sdk-build-"));
  const metadata = JSON.parse(await readFile(path.join(root, "packages/authoring/package.json"), "utf8"));
  const runtime = await build({
    absWorkingDir: root,
    entryPoints: {
      index: path.join(root, "packages/authoring/src/index.ts"),
      three: path.join(root, "packages/authoring/src/three.tsx"),
      tone: path.join(root, "packages/authoring/src/tone.ts"),
    },
    outdir: path.join(staging, "dist"),
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "zod", "three", "tone"],
  });
  const compiled = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "--ignoreConfig",
      "--declaration",
      "--emitDeclarationOnly",
      "--outDir",
      path.join(staging, "types"),
      "--rootDir",
      root,
      "--moduleResolution",
      "bundler",
      "--module",
      "ESNext",
      "--target",
      "ES2023",
      "--jsx",
      "react-jsx",
      "--strict",
      "--skipLibCheck",
      "--types",
      "react",
      path.join(root, "packages/authoring/src/index.ts"),
      path.join(root, "packages/authoring/src/tone.ts"),
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (compiled.error || compiled.status !== 0)
    throw new Error(
      "SDK declarations failed: " + (compiled.error?.message ?? compiled.stdout + compiled.stderr),
    );
  const entries = [
    { name: "package.json", bytes: Buffer.from(JSON.stringify(metadata, null, 2) + "\n") },
    ...runtime.outputFiles.map((file) => ({
      name: "dist/" + path.basename(file.path),
      bytes: file.contents,
    })),
    ...(await declarations(path.join(staging, "types"))),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const bytes = gzipSync(tar(entries), { level: 9 }),
    filename = "motiframe-authoring-" + metadata.version + ".tgz";
  const archivePath = path.join(destination, filename);
  await writeFile(archivePath, bytes);
  const manifest = {
    name: metadata.name,
    version: metadata.version,
    filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    files: entries.map((entry) => entry.name),
    exports: metadata.exports,
    dependencies: metadata.dependencies,
    peerDependencies: metadata.peerDependencies,
  };
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { path: archivePath, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex !== -1 && !process.argv[outputIndex + 1]) throw new Error("--output requires a directory");
  console.log(
    JSON.stringify(
      await packageSdk({ outputDir: outputIndex === -1 ? undefined : process.argv[outputIndex + 1] }),
    ),
  );
}
