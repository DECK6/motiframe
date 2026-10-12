import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { captureProject } from "./capture";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { tick: { type: "string", default: "0" }, output: { type: "string" }, json: { type: "boolean" } },
});
try {
  if (positionals[0] !== "capture" || !positionals[1] || !values.output)
    throw new Error("Usage: motiframe capture <project.json> --tick 0 --output <frame.png> [--json]");
  const project = JSON.parse(await readFile(positionals[1], "utf8"));
  const captured = await captureProject(project, { tick: Number(values.tick) });
  if (!captured.ok) {
    console.log(JSON.stringify(captured));
    process.exitCode = 2;
  } else {
    await mkdir(path.dirname(values.output), { recursive: true });
    await writeFile(values.output, captured.value.png);
    console.log(
      JSON.stringify({
        ok: true,
        value: {
          output: values.output,
          receipt: captured.value.receipt,
          inspection: captured.value.inspection,
        },
      }),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
