import { useCallback, useEffect, useRef, useState } from "react";
import type { EditCommand, EditTransaction } from "../../../../packages/document/src/commands";
import { projectContentHash } from "../../../../packages/document/src/history";
import { fail, type Result } from "../../../../packages/document/src/result";
import type { ProjectDocument } from "../../../../packages/document/src/schema";
import { createOfflineDocumentStore, type OfflineDocumentStore } from "./offline";

const token = () => document.querySelector<HTMLMetaElement>('meta[name="motiframe-session"]')?.content ?? "";
export const isBrowserMode = () => !token() || token() === "__MOTIFRAME_SESSION__";
let offline: Promise<Result<OfflineDocumentStore>> | undefined;
export function offlineStore() {
  return (offline ??= createOfflineDocumentStore());
}
export async function api<T>(route: string, body?: unknown): Promise<Result<T>> {
  try {
    if (isBrowserMode()) {
      const store = await offlineStore();
      return store.ok ? store.value.api<T>(route, body) : store;
    }
    const response = await fetch(`/api/${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-MotiFrame-Session": token() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return await response.json();
  } catch (error) {
    return fail("CONNECTION_LOST", String(error));
  }
}
type ProjectResponse = { document: ProjectDocument; history: { undo: number; redo: number } };
export function useProjectStore(notify: (s: string) => void) {
  const [state, setState] = useState<ProjectResponse>();
  const current = useRef(state);
  current.current = state;
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    const result = await api<ProjectResponse>("project");
    if (result.ok)
      setState((previous) =>
        previous?.document.id === result.value.document.id &&
        previous?.document.revision === result.value.document.revision &&
        projectContentHash(previous.document) === projectContentHash(result.value.document)
          ? previous
          : result.value,
      );
    else notify(result.error.message);
  }, [notify]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!busy.current) void refresh();
    }, 800);
    return () => clearInterval(timer);
  }, [refresh]);
  const submit = useCallback(
    async (commands: EditCommand[], options: { preserveDuration?: boolean; gestureId?: string } = {}) => {
      const doc = current.current?.document;
      if (!doc) return false;
      busy.current = true;
      try {
        const transaction: EditTransaction = {
          id: crypto.randomUUID(),
          baseRevision: doc.revision,
          author: "user",
          scope: {
            instanceIds: [
              ...Object.keys(doc.instances),
              ...commands.flatMap((command) =>
                command.type === "AddInstance"
                  ? [command.instanceId]
                  : command.type === "DuplicateInstance" || command.type === "SplitClip"
                    ? [command.newInstanceId]
                    : [],
              ),
            ],
            range: { start: 0, end: doc.settings.duration },
            preserveDuration: options.preserveDuration ?? true,
            ripple: false,
          },
          commands,
        };
        const result = await api("transaction", { transaction, gestureId: options.gestureId });
        if (!result.ok) {
          notify(`${result.error.code}: ${result.error.message}`);
          return false;
        }
        await refresh();
        return true;
      } finally {
        busy.current = false;
      }
    },
    [notify, refresh],
  );
  const history = useCallback(
    async (direction: "undo" | "redo") => {
      const result = await api(direction, {});
      if (!result.ok) notify(result.error.message);
      await refresh();
    },
    [notify, refresh],
  );
  return { document: state?.document, counts: state?.history, refresh, submit, history };
}
