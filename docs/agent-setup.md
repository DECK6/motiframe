# External coding agent setup

MotiFrame's local CLI, React/HTML SDK and portable skill kit support external coding agents. MotiFrame does not embed a model provider, an agent chat or API credentials. Your agent host owns model selection and authentication.

Use the repository's pinned Bun/Node setup and documented runtime setup before the commands below. In a checkout, `bun run motiframe -- …` invokes the local CLI; a packaged installation may expose `motiframe` directly.

```sh
bun run motiframe -- inspect project.json --json
bun run motiframe -- context project.json --file context-request.json --json
bun run motiframe -- kit --output agent-kit --json
```

Give your agent the exported `motiframe/SKILL.md` (or `skills/motiframe/SKILL.md` in the repository), its references, the kit schemas and the React/HTML examples. The kit manifest records SDK, CLI protocol, document schema and skill versions. Follow your host's documented local skill-discovery mechanism when installation is needed; exporting the kit does not perform a global skill installation.

The agent workflow is inspect/context → optional knowledge lookup → score/source or ChangeSet → validate → dry-run → patch → capture/render → review. Use the latest document revision, scope and locks. Source structure is revised through element build/register, while timeline edits use transactions. The CLI and GUI share the same writer and undo history.

```sh
bun run motiframe -- knowledge query --file knowledge-query.json --json
bun run motiframe -- validate project.json --json
bun run motiframe -- patch project.json --file changeset.json --dry-run --json
bun run motiframe -- patch project.json --file changeset.json --json
bun run motiframe -- capture project.json --tick 0 --output frame.png --json
bun run motiframe -- render project.json --output video.mp4 --wait --json
bun run motiframe -- review project.json --json
```

A knowledge query file may contain `{"text":"빠른데 단조","limit":3}`. The shipped snapshot preserves 590 stable node IDs, 943 directed relations and 31 image references from source version 1.0, generated 2026-09-29. The 31 source images matched their expected SHA-256 during import. No image binaries or private vault paths are bundled. `referenced` means the file was identified during import; rights and viewing remain distinct, and no current image viewing, continuous playback or audio audition is claimed.

Reimporting is an explicit local operation with an output path and admitted asset root or map:

```sh
bun scripts/import-motion-knowledge.ts --input motion-ontology-source.json --asset-root reference-assets --output snapshot.json
```

Only ontology image nodes are eligible for file resolution. Root mappings reject traversal and escaping symlinks; hashes must match the source. Missing or mismatched files remain unavailable. Importing does not change the source ontology, copy media, execute source instructions or import whole source documents.

Machine responses use protocol version 1 and one JSON object on stdout; logs go to stderr. Exit 3 requires fresh context for a revision/lock/ownership conflict. Keep a request ID when retrying the same uncertain submission; a new plan needs a new request ID. Never bypass the writer by editing a live project file directly.

Automated checks cover import/query behavior and portable kit structure. Successful use by a particular agent host, actual visual perception and discovery on a second host require separate recorded runs; they are not implied by those checks.
