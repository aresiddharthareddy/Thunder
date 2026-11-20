# Thunder

Thunder is a local-first AI coding IDE built on Electron, Monaco, and `node-llama-cpp`. It routes Ask, Plan, and Agent requests to verified local models based on hardware tier and model availability.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm dev
```

The first-run catalog lists pinned GGUF models. Download a model from the onboarding screen, then open the coding workspace. Model downloads are resumable and SHA-256 verified before activation.

## Agent safety

Agent mode produces a structured plan, shows an explicit review step, and only applies edits after the user selects **Apply safely**. Writes are restricted to the selected workspace, exact replacement matches are required, and failed runs roll back earlier edits. Agent runs are recorded in the local SQLite audit log.

## Packaging

```bash
CI=true pnpm package
CI=true pnpm verify:release
```

The release verifier creates `release/SHA256SUMS.txt`. macOS artifacts are currently unsigned unless a valid Apple Developer signing identity is configured. Users may need to right-click the app and choose Open on first launch.

## Workbench demo

Build the VSCodium-based workbench with its local extension and verified model pack using `pnpm build:workbench`. To create the optional local demo profile, run `pnpm provision:demo` and enter the two demo passwords when prompted. Passwords are hashed into the local profile and are not stored in the repository. Run `pnpm verify:workbench` to verify the bundle.

## Privacy

Inference, editor context, chat history, model files, and Agent audit records stay local by default. Zero Outbound mode blocks network operations. `creds.txt`, model binaries, build output, and local dependency stores are excluded from Git.

## Scope

Thunder currently focuses on local model inference, secure file editing, model routing, Agent review/apply, offline diagnostics, and explicitly approved workspace-scoped terminal commands. Terminal commands are bounded, output-limited, and reject destructive or pipe-to-shell patterns. Auto-update, cloud fallback, and telemetry upload are intentionally not enabled.
