import { fail, ok, type Result } from "./result";
import type { JsonValue, ProjectDocument } from "./schema";
export function updateReference(
  references: ProjectDocument["references"],
  reference: JsonValue,
  id?: string,
  remove = false,
): Result<ProjectDocument["references"]> {
  const ref = reference && typeof reference === "object" && !Array.isArray(reference) ? reference : undefined;
  const key = id ?? (typeof ref?.id === "string" ? ref.id : undefined);
  if (!key) return fail("INVALID_REFERENCE", "A stable reference ID is required");
  if (!remove && (typeof ref?.snapshotHash !== "string" || !ref.snapshotHash))
    return fail("INVALID_REFERENCE", "A snapshot hash is required", [key]);
  const remaining = references.filter(
    (r) => !(r && typeof r === "object" && !Array.isArray(r) && r.id === key),
  );
  return ok(remove ? remaining : [...remaining, { ...ref, id: key }]);
}
