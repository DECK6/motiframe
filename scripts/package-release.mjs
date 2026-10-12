import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = [
  "packages",
  "apps",
  "scripts",
  "skills",
  "assets/fonts",
  "dist",
  "tests/fixtures/fonts",
  "tests/fixtures/mixed-static",
  "tests/fixtures/mixed-phrase",
  "examples/showcase",
];
const files = [
  "package.json",
  "bun.lock",
  "runtime-lock.json",
  "tsconfig.json",
  "biome.json",
  "vitest.config.ts",
  "vite.config.ts",
  "README.md",
  "docs/install.md",
  "docs/authoring-sdk.md",
  "docs/motion-rhythm-audit.md",
  "docs/dexa-design.md",
  "docs/performance.md",
  "docs/troubleshooting.md",
  "docs/release-acceptance.md",
  "docs/third-party-notices.md",
  "docs/agent-setup.md",
  "docs/agent-quickstart.md",
];
const blocked = /(^|\/)(?:\.[^/]+|node_modules|artifacts|cache|caches|exports|coverage)(\/|$)/i;
const privateContent =
  /(?:\/(?:Users|Volumes|home)\/[\p{L}\p{N}_.-]+|[a-zA-Z]:\\Users\\[\p{L}\p{N}_.-]+|qmd:\/\/vault|(?:sk-proj-|sk-ant-)[A-Za-z0-9_-]{16,})/u;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function collect(relative, entries) {
  if (blocked.test(relative)) return;
  const location = path.join(root, relative),
    info = await lstat(location);
  if (info.isSymbolicLink()) throw new Error(`Release refuses symlink: ${relative}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(location)).sort()) await collect(`${relative}/${name}`, entries);
    return;
  }
  if (!info.isFile()) throw new Error(`Release refuses non-regular input: ${relative}`);
  if (info.size > 256 * 1024 ** 2) throw new Error(`Release input exceeds 256 MiB: ${relative}`);
  const data = await readFile(location);
  if (
    /\.(?:[cm]?[jt]sx?|json|md|ya?ml|css|html|txt|lock)$/.test(relative) &&
    privateContent.test(data.toString("utf8"))
  )
    throw new Error(`Private path or credential-shaped content in release input: ${relative}`);
  entries.push({ path: relative, data });
}
function tar(entries, prefix) {
  const parts = [];
  for (const entry of entries) {
    const name = `${prefix}/${entry.path}`,
      header = Buffer.alloc(512);
    let basename = name,
      parent = "";
    if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf("/");
      basename = name.slice(split + 1);
      parent = name.slice(0, split);
    }
    if (Buffer.byteLength(basename) > 100 || Buffer.byteLength(parent) > 155)
      throw new Error(`Release path exceeds USTAR limits: ${entry.path}`);
    header.write(basename, 0, 100);
    header.write("0000644\0", 100, 8);
    header.write("0000000\0", 108, 8);
    header.write("0000000\0", 116, 8);
    header.write(entry.data.length.toString(8).padStart(11, "0") + "\0", 124, 12);
    header.write("00000000000\0", 136, 12);
    header.fill(32, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257, 6);
    header.write("00", 263, 2);
    header.write(parent, 345, 155);
    const checksum = header.reduce((total, byte) => total + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    parts.push(header, entry.data, Buffer.alloc((512 - (entry.data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const installer = `import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'release-manifest.json'),'utf8'));
for(const file of manifest.files){
 const digest=createHash('sha256').update(await readFile(path.join(root,file.path))).digest('hex');
 if(digest!==file.sha256)throw new Error('Release integrity check failed: '+file.path);
}
for(const args of [['install','--frozen-lockfile'],['run','setup']]){
 const child=spawnSync('bun',args,{cwd:root,stdio:'inherit',shell:false});
 if(child.error)throw child.error;
 if(child.status!==0)process.exit(child.status??1);
}
console.log('MotiFrame installed locally. Read docs/install.md to launch the studio.');
`;
export async function packageRelease(options = {}) {
  const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+.][a-zA-Z0-9.-]+)?$/.test(metadata.version))
    throw new Error("Invalid release version");
  for (const required of ["dist/runner/cli.mjs", "dist/stage/stage.js", "dist/editor/index.html"])
    if (!(await lstat(path.join(root, required)).catch(() => null))?.isFile())
      throw new Error(`Run bun run build before packaging: ${required} is missing`);
  const entries = [];
  for (const directory of directories) await collect(directory, entries);
  for (const file of files) await collect(file, entries);
  entries.push({ path: "install.mjs", data: Buffer.from(installer) });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const names = new Set();
  for (const entry of entries) {
    const folded = entry.path.normalize("NFC").toLowerCase();
    if (names.has(folded)) throw new Error(`Release path collision: ${entry.path}`);
    names.add(folded);
  }
  const manifest = {
    schemaVersion: 1,
    name: metadata.name,
    version: metadata.version,
    runtime: JSON.parse(await readFile(path.join(root, "runtime-lock.json"), "utf8")),
    files: entries.map((entry) => ({ path: entry.path, size: entry.data.length, sha256: sha(entry.data) })),
    excluded: [
      "local runtime binaries",
      "node_modules",
      "caches",
      "outputs",
      "private planning/context",
      "credentials",
      "absolute local paths",
    ],
  };
  entries.push({
    path: "release-manifest.json",
    data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  });
  const prefix = `motiframe-${metadata.version}`,
    archive = gzipSync(tar(entries, prefix), { level: 9 }),
    digest = sha(archive),
    destination = path.resolve(options.outputDir ?? path.join(root, "artifacts/releases"));
  await mkdir(destination, { recursive: true });
  const archivePath = path.join(destination, `${prefix}-${digest.slice(0, 12)}.tar.gz`),
    staging = path.join(destination, `${prefix}-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  for (const entry of entries) {
    const target = path.join(staging, entry.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data, { flag: "wx" });
  }
  await writeFile(archivePath, archive);
  await writeFile(`${archivePath}.sha256`, `${digest}  ${path.basename(archivePath)}\n`);
  return { archivePath, staging, sha256: digest, files: entries.length, bytes: archive.length };
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 ** 2,
    shell: false,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${path.basename(program)} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest("hex");
}
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}
async function inventory(folder) {
  const entries = [];
  async function visit(relative) {
    const file = path.join(folder, relative),
      info = await lstat(file);
    if (info.isSymbolicLink()) {
      const target = await readlink(file);
      if (path.isAbsolute(target) || !inside(folder, await realpath(file)))
        throw new Error(`Standalone dependency link escapes release: ${relative}`);
      entries.push({ path: relative.split(path.sep).join("/"), link: target });
    } else if (info.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(relative, name));
    } else if (info.isFile()) {
      entries.push({
        path: relative.split(path.sep).join("/"),
        size: info.size,
        mode: info.mode & 0o777,
        sha256: await hashFile(file),
      });
    } else throw new Error(`Standalone refuses non-regular file: ${relative}`);
  }
  await visit("");
  return entries;
}
function dylibs(file) {
  return command("/usr/bin/otool", ["-L", file])
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/ \(compatibility version.*$/, ""))
    .filter(Boolean);
}
const isSystemLibrary = (file) => file.startsWith("/usr/lib/") || file.startsWith("/System/Library/");
function minimumMacOS(file) {
  const output = command("/usr/bin/otool", ["-l", file]);
  return (
    output.match(/\bminos\s+([0-9.]+)/)?.[1] ??
    output.match(/LC_VERSION_MIN_MACOSX[\s\S]*?\bversion\s+([0-9.]+)/)?.[1] ??
    "0"
  );
}
function compareVersions(a, b) {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
  }
  return 0;
}
async function bundleFfmpeg(staging, locked) {
  const bin = path.join(staging, ".runtime/ffmpeg/bin"),
    lib = path.join(staging, ".runtime/ffmpeg/lib"),
    licenses = path.join(staging, ".runtime/ffmpeg/licenses");
  await mkdir(bin, { recursive: true });
  await mkdir(lib, { recursive: true });
  await mkdir(licenses, { recursive: true });
  const nodes = new Map(),
    names = new Map(),
    queue = [];
  async function add(source, executable = false) {
    const resolved = await realpath(source);
    if (nodes.has(resolved)) return nodes.get(resolved);
    const name = path.basename(resolved);
    if (names.has(name) && names.get(name) !== resolved)
      throw new Error(`Native dependency name collision: ${name}`);
    names.set(name, resolved);
    const node = {
      source: resolved,
      target: path.join(executable ? bin : lib, name),
      executable,
      dependencies: [],
    };
    nodes.set(resolved, node);
    queue.push(node);
    return node;
  }
  for (const name of ["ffmpeg", "ffprobe"]) {
    const source = command("/usr/bin/which", [name]).trim();
    if (!command(source, ["-version"]).split("\n")[0].includes(`version ${locked.ffmpeg} `))
      throw new Error(`${name} must match runtime-lock.json`);
    await add(source, true);
  }
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const dependency of dylibs(node.source)) {
      if (isSystemLibrary(dependency)) continue;
      const source = dependency.startsWith("@loader_path/")
        ? path.resolve(path.dirname(node.source), dependency.slice(13))
        : dependency;
      if (!path.isAbsolute(source)) throw new Error(`Unsupported native dependency reference: ${dependency}`);
      if ((await realpath(source)) === node.source) continue;
      const target = await add(source);
      node.dependencies.push({ reference: dependency, target });
    }
  }
  const formulaRoots = new Map();
  for (const node of queue) {
    await copyFile(node.source, node.target);
    await chmod(node.target, 0o755);
    const match = node.source.match(/^(.*\/Cellar\/([^/]+)\/([^/]+))\//);
    if (match) formulaRoots.set(match[1], `${match[2]}-${match[3]}`);
  }
  for (const node of queue) {
    const args = [];
    if (!node.executable) args.push("-id", `@loader_path/${path.basename(node.target)}`);
    for (const dependency of node.dependencies)
      args.push(
        "-change",
        dependency.reference,
        `@loader_path/${node.executable ? "../lib/" : ""}${path.basename(dependency.target.target)}`,
      );
    if (args.length) command("/usr/bin/install_name_tool", [...args, node.target]);
    command("/usr/bin/codesign", ["--force", "--sign", "-", node.target]);
    if (
      dylibs(node.target).some(
        (dependency) => !isSystemLibrary(dependency) && !dependency.startsWith("@loader_path/"),
      )
    )
      throw new Error(`Unrelocated native dependency: ${path.basename(node.target)}`);
    command("/usr/bin/codesign", ["--verify", "--strict", node.target]);
  }
  const components = [];
  for (const [source, name] of formulaRoots) {
    const target = path.join(licenses, name);
    await mkdir(target, { recursive: true });
    const admitted = (await readdir(source)).filter((file) =>
      /^(?:LICEN[CS]E|COPYING|COPYRIGHT|NOTICE)/i.test(file),
    );
    for (const file of admitted)
      await cp(path.join(source, file), path.join(target, file), { recursive: true, dereference: true });
    if (!admitted.length) throw new Error(`Native dependency license missing: ${name}`);
    components.push({ name, licenseFiles: admitted });
  }
  await writeFile(
    path.join(licenses, "components.json"),
    JSON.stringify(
      {
        version: locked.ffmpeg,
        components,
        ffmpegConfiguration: command(path.join(bin, "ffmpeg"), ["-version"])
          .split("\n")
          .find((line) => line.startsWith("configuration:")),
        source: "https://github.com/Homebrew/homebrew-core/tree/HEAD/Formula",
        distribution:
          "Local release candidate; native binaries copied from the installed Homebrew build and ad-hoc signed after relocation.",
      },
      null,
      2,
    ) + "\n",
  );
  command(path.join(bin, "ffmpeg"), ["-version"], {
    env: { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  return {
    binaries: queue.map((node) => path.relative(staging, node.target)),
    components,
    minimumMacOS: queue
      .map((node) => minimumMacOS(node.target))
      .sort(compareVersions)
      .at(-1),
  };
}
const standaloneLauncher = `import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access,readFile,readlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'standalone-manifest.json'),'utf8'));
if(process.platform!==manifest.platform||process.arch!==manifest.arch)throw new Error('This RC requires '+manifest.platform+' '+manifest.arch);
const currentMacOS=spawnSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).stdout?.trim().split('.').map(Number);
const minimumMacOS=manifest.minimumMacOS.split('.').map(Number);
if(!currentMacOS)throw new Error('Unable to determine macOS version');
for(let i=0;i<3;i++){if((currentMacOS[i]??0)>(minimumMacOS[i]??0))break;if((currentMacOS[i]??0)<(minimumMacOS[i]??0))throw new Error('This native RC requires macOS '+manifest.minimumMacOS+' or newer');}
const runtime=JSON.parse(await readFile(path.join(root,'.runtime/manifest.json'),'utf8'));
const node=path.join(root,runtime.node);
process.env.MOTIFRAME_ROOT=root;
process.env.PATH=[path.join(root,'.runtime/ffmpeg/bin'),path.dirname(node),'/usr/bin','/bin','/usr/sbin','/sbin'].join(path.delimiter);
process.chdir(root);
let args=process.argv.slice(2);
if(args[0]==='--verify'){
 for(const file of manifest.files){
  const location=path.join(root,file.path);
  if(file.link){if(await readlink(location)!==file.link)throw new Error('Integrity mismatch: '+file.path);continue;}
  const hash=createHash('sha256');for await(const chunk of createReadStream(location))hash.update(chunk);
  if(hash.digest('hex')!==file.sha256)throw new Error('Integrity mismatch: '+file.path);
 }
 console.log(JSON.stringify({ok:true,files:manifest.files.length,platform:process.platform,arch:process.arch}));
}else{
 if(args.length===0){
  const project=path.join(root,'projects/untitled/project.json');
  if(!await access(project).then(()=>true,()=>false)){
   const init=spawnSync(node,[path.join(root,'dist/runner/cli.mjs'),'init',path.dirname(project)],{stdio:'inherit',env:process.env});
   if(init.error||init.status!==0)process.exit(init.status??1);
  }
  args=['studio',project,'--port','0'];
 }
 const child=spawn(node,[path.join(root,'dist/runner/cli.mjs'),...args],{stdio:'inherit',env:process.env});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});
 child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}
`;
export async function packageStandaloneRelease(options = {}) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "Standalone RC packaging is currently verified only on darwin arm64; other OS builds require their native CI jobs",
    );
  const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")),
    locked = JSON.parse(await readFile(path.join(root, "runtime-lock.json"), "utf8")),
    runtime = JSON.parse(await readFile(path.join(root, ".runtime/manifest.json"), "utf8"));
  if (runtime.platform !== process.platform || runtime.arch !== process.arch)
    throw new Error("Local runtime platform mismatch");
  for (const name of ["node", "chrome"])
    if ((await hashFile(path.join(root, runtime[name]))) !== runtime[`${name}Sha256`])
      throw new Error(`Pinned runtime hash mismatch: ${name}`);
  const destination = path.resolve(options.outputDir ?? path.join(root, "artifacts/releases")),
    source = await packageRelease({ outputDir: destination }),
    prefix = `motiframe-${metadata.version}-${process.platform}-${process.arch}-rc`,
    container = path.join(destination, `standalone-${randomUUID()}`),
    staging = path.join(container, prefix);
  await mkdir(container, { recursive: true });
  await cp(source.staging, staging, { recursive: true });
  const nodeFolder = path.dirname(path.dirname(runtime.node)),
    chromeFolder = path.dirname(runtime.chrome);
  await mkdir(path.join(staging, nodeFolder, "bin"), { recursive: true });
  await copyFile(path.join(root, runtime.node), path.join(staging, runtime.node));
  await chmod(path.join(staging, runtime.node), 0o755);
  await copyFile(path.join(root, nodeFolder, "LICENSE"), path.join(staging, nodeFolder, "LICENSE"));
  await cp(path.join(root, chromeFolder), path.join(staging, chromeFolder), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await copyFile(path.join(root, ".runtime/manifest.json"), path.join(staging, ".runtime/manifest.json"));
  await cp(path.join(root, "node_modules"), path.join(staging, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (sourcePath) =>
      !path
        .relative(path.join(root, "node_modules"), sourcePath)
        .split(path.sep)
        .some((name) => name.startsWith(".old_") || [".cache", ".vite", ".vite-temp"].includes(name)),
  });
  const ffmpeg = await bundleFfmpeg(staging, locked);
  await writeFile(path.join(staging, "launch.mjs"), standaloneLauncher);
  const shell = `#!/bin/sh\nset -eu\nMOTIFRAME_BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$MOTIFRAME_BUNDLE_DIR/${runtime.node}" "$MOTIFRAME_BUNDLE_DIR/launch.mjs" "$@"\n`;
  for (const name of ["launch.sh", "launch.command"]) {
    await writeFile(path.join(staging, name), shell, { mode: 0o755 });
  }
  await writeFile(
    path.join(staging, "launch.cmd"),
    "@echo off\r\necho This package contains macOS ARM64 binaries. A Windows native release candidate is not yet available.\r\nexit /b 1\r\n",
  );
  const entries = await inventory(staging),
    manifest = {
      schemaVersion: 1,
      version: metadata.version,
      platform: process.platform,
      arch: process.arch,
      minimumMacOS: [
        ffmpeg.minimumMacOS,
        minimumMacOS(path.join(staging, runtime.node)),
        minimumMacOS(path.join(staging, runtime.chrome)),
      ]
        .sort(compareVersions)
        .at(-1),
      runtime: locked,
      nativeDependencyFiles: ffmpeg.binaries,
      files: entries,
      excluded: [
        "user projects",
        "render outputs",
        "caches",
        "private planning/context",
        "credentials",
        "obsolete dependency trees",
      ],
    };
  await writeFile(path.join(staging, "standalone-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const pending = path.join(destination, `${prefix}-${randomUUID()}.tar.gz`);
  command(
    "/usr/bin/tar",
    [
      "-czf",
      pending,
      "--uid",
      "0",
      "--gid",
      "0",
      "--uname",
      "root",
      "--gname",
      "root",
      "--no-xattrs",
      "--no-acls",
      "--no-fflags",
      "-C",
      container,
      prefix,
    ],
    {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      timeout: 300000,
    },
  );
  const digest = await hashFile(pending),
    archivePath = path.join(destination, `${prefix}-${digest.slice(0, 12)}.tar.gz`);
  await rename(pending, archivePath);
  await writeFile(`${archivePath}.sha256`, `${digest}  ${path.basename(archivePath)}\n`);
  return {
    archivePath,
    staging,
    sha256: digest,
    files: entries.length + 1,
    bytes: (await lstat(archivePath)).size,
    nativeBinaries: ffmpeg.binaries.length,
  };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await (process.argv.includes("--standalone")
      ? packageStandaloneRelease()
      : packageRelease());
    console.log(
      JSON.stringify({
        ...result,
        archivePath: path.relative(root, result.archivePath),
        staging: path.relative(root, result.staging),
      }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
