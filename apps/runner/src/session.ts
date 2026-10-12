import { timingSafeEqual } from "node:crypto";
export function validSession(
  actual: string | undefined,
  expected: string,
  origin: string | undefined,
  allowed: string,
): boolean {
  if (!actual || !expected || (origin !== undefined && origin !== allowed)) return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
