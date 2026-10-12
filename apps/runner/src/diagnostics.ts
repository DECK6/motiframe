import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fail, ok, type Result } from "../../../packages/document/src/result";
import { runtime } from "./environment";
export async function doctor(): Promise<Result<Record<string, unknown>>> {
  try {
    const config = await runtime();
    const actual = {
      node: createHash("sha256")
        .update(await readFile(config.node))
        .digest("hex"),
      chrome: createHash("sha256")
        .update(await readFile(config.chrome))
        .digest("hex"),
    };
    if (actual.node !== config.hashes.node || actual.chrome !== config.hashes.chrome)
      return fail("RUNTIME_HASH_MISMATCH", "Pinned runtime changed; rerun setup");
    const ffmpeg = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0],
      ffprobe = execFileSync("ffprobe", ["-version"], { encoding: "utf8" }).split("\n")[0],
      encoders = execFileSync("ffmpeg", ["-v", "quiet", "-encoders"], { encoding: "utf8" });
    return ok({
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      node: execFileSync(config.node, ["--version"], { encoding: "utf8" }).trim(),
      chrome: execFileSync(config.chrome, ["--version"], { encoding: "utf8" }).trim(),
      ffmpeg,
      ffprobe,
      runtimeHashes: actual,
      capabilities: {
        h264: /libx264/.test(encoders),
        aac: /\baac\b/.test(encoders),
        fonts: "project-pinned",
        rendererSandbox: true,
        models: "external-agent-only",
      },
    });
  } catch (error) {
    return fail(
      "DOCTOR_FAILED",
      error instanceof Error ? error.message.replaceAll(process.cwd(), "<project>") : String(error),
    );
  }
}
export async function exportDiagnostics(
  outputPath: string,
  details: Record<string, unknown> = {},
): Promise<Result<{ path: string }>> {
  const report = await doctor();
  const redact = (value: unknown): unknown =>
    typeof value === "string"
      ? value.replace(/(?:\/[\w .-]+){2,}|[A-Z]:\\[^\n]+/g, "<local-path>")
      : Array.isArray(value)
        ? value.map(redact)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([k]) => !/(?:token|secret|password|key|path|url)/i.test(k))
                .map(([k, v]) => [k, redact(v)]),
            )
          : value;
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      JSON.stringify({ version: "0.1.0", environment: report, details: redact(details) }, null, 2),
    );
    return ok({ path: outputPath });
  } catch (error) {
    return fail("DIAGNOSTICS_IO", String(error));
  }
}
