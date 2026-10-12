# Troubleshooting and recovery

Start with `motiframe doctor --json`. In a source checkout, replace `motiframe` with `bun run motiframe --`; in the standalone RC, use `./launch.sh`. Keep the complete JSON error code when reporting a failure.

| Symptom or code | Next action |
| --- | --- |
| `REVISION_CONFLICT` | Read fresh inspect/context output, compare the current changes, and prepare a new scoped proposal. |
| `SCOPE_CONFLICT` | Include the authorized instances and affected time interval. A keyframe affects its neighboring interpolation segments, not only its own tick. |
| `LOCKED` / `OWNERSHIP_CONFLICT` | Preserve the lock or manual channel. Change ownership only through an authorized user edit. |
| `WRITER_ACTIVE` | Use the existing Studio runner or close it normally. Do not launch another writer or overwrite the project JSON. |
| `HOST_DENIED` / `SESSION_DENIED` | Open the exact loopback URL printed by the current runner. An old tab or another hostname does not identify the current session. |
| `OUTPUT_EXISTS` | Choose a new capture, render or bundle output path. |
| Missing or changed asset | In Assets, use **Relink original file** and select bytes matching the registered SHA-256. |
| `RUNNER_REQUIRED` in browser-only mode | Open the project with the local runner for custom source, media preview or final rendering. |
| `CAPABILITY_DENIED` during source build | Use admitted SDK/vendor imports and relative files supplied in the source envelope. |
| `TARGET_MIGRATION_REQUIRED` | Restore stable targets or provide an explicit target remap before applying the source revision. |
| `UNSUPPORTED_AUDIO_RATE` | Use audio at rate 1; non-unit audio time stretching is not implemented. |
| Media or audio budget error | Reduce the decoded range or media dimensions and retry as a new operation. |
| Chromium sandbox or runtime failure | Check the pinned runtime and normal-user sandbox support; disabling the sandbox is not a supported fix. |

## Recover a project

Save failures leave the in-memory document uncommitted. Project saves preserve valid earlier documents in a sibling snapshot directory. Inspect recovery candidates before choosing one:

```sh
motiframe recover projects/demo/project.json --json
```

To restore an inspected candidate, write `snapshot-selection.json` with `{"snapshot":"<candidate filename>"}` and run:

```sh
motiframe recover projects/demo/project.json --file snapshot-selection.json --json
```

Close the active Studio writer first. Recovery preserves the existing project under a generated `.preserved-…` name before publishing the chosen snapshot. Keep original media, snapshots and recovery records until the result has been checked. Do not delete lock/state files to bypass a live writer.

The durable journal can recover a committed document's matching undo history and request receipt. Retry the same uncertain ChangeSet with its original request ID; reusing that ID for different content is rejected. Independent project files use separate state records even when they share a directory.

Interrupted render jobs are reported as interrupted, not silently resumed. A new render captures a fresh immutable document snapshot. Temporary render folders are diagnostic evidence, not completed exports; use the completed receipt and its output path.

## Diagnostics

```sh
motiframe diagnostics --output diagnostics.json --json
```

Studio's recovery view also exposes interrupted-job information. Diagnostic export omits secrets and personal absolute paths. The local RC remains unsigned by a public publisher/notarization service; use the package integrity check and the installation guide's supported platform boundary.
