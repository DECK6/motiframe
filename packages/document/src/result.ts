export type Problem = { code: string; message: string; ids: string[] };
export type Result<T> = { ok: true; value: T } | { ok: false; error: Problem };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: string, message: string, ids: string[] = []): Result<never> => ({
  ok: false,
  error: { code, message, ids },
});
