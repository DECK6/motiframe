import { assert } from "vitest";
import type { Result } from "../../packages/document/src/result";
export function expectOk<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
  return result.value;
}
