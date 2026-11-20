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

## Privacy

Inference, editor context, chat history, model files, and Agent audit records stay local by default. Zero Outbound mode blocks network operations. `creds.txt`, model binaries, build output, and local dependency stores are excluded from Git.

## Scope

Thunder currently focuses on local model inference, secure file editing, model routing, Agent review/apply, and offline diagnostics. Terminal sandboxing, auto-update, cloud fallback, and telemetry upload are intentionally not enabled.
