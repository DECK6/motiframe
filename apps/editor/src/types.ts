import type { EditCommand } from "../../../packages/document/src/commands";
import type { Result } from "../../../packages/document/src/result";
import type { ProjectDocument } from "../../../packages/document/src/schema";
export type PanelProps = {
  document: ProjectDocument;
  selection: string[];
  tick: number;
  editing?: boolean;
  submit: (
    commands: EditCommand[],
    options?: { preserveDuration?: boolean; gestureId?: string },
  ) => Promise<boolean>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  api: <T>(route: string, body?: unknown) => Promise<Result<T>>;
};
