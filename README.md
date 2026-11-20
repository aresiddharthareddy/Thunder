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

The first-run catalog lists pinned GGUF models. Free users prepare a hardware-matched Auto pack containing a nano model and a lightweight coder model; Thunder keeps model selection automatic. Pro users can use Model Lab controls in the Workbench. Downloads are resumable and SHA-256 verified before activation.

## Agent safety

Agent mode uses grammar-constrained JSON, retries one malformed proposal, shows an explicit diff review step, and only applies edits after the user selects **Apply safely**. Writes are restricted to the selected workspace, exact replacement matches and syntax checks are required, and failed runs roll back earlier edits. Agent runs are recorded in the local SQLite audit log.

## Packaging

```bash
CI=true pnpm package
CI=true pnpm verify:release
```

For a headless build host that cannot create a macOS disk image, use `CI=true npm run package:dir` to produce and verify the `.app` bundle directly. The normal package command additionally creates DMG installers and requires macOS `hdiutil`.

The release verifier creates `release/SHA256SUMS.txt`. macOS artifacts are currently unsigned unless a valid Apple Developer signing identity is configured. Users may need to right-click the app and choose Open on first launch.

## Workbench demo

Build the VSCodium-based workbench with its local extension and verified model pack using `pnpm build:workbench`. To create the optional local demo profile, run `pnpm provision:demo` and enter the two demo passwords when prompted. Passwords are hashed into the local profile and are not stored in the repository. Run `pnpm verify:workbench` to verify the bundle.

The first Workbench build needs CMake and Apple Command Line Tools to compile the bundled CPU inference fallback from the pinned local source archive. If CMake is outside your PATH, set `THUNDER_CMAKE` to its executable. Run `npm run smoke:workbench-agent` after packaging to exercise a real model response, diff review, and approval against a simulated editor.

Run `npm run package:workbench` to create a macOS ZIP and SHA-256 checksum without the demo account verification key. The bundle is ad-hoc signed for local testing. Public macOS distribution requires Developer ID signing and notarization.

In Workbench, open **Manage Account and License** to activate an offline Pro license. Release builders can set `THUNDER_LICENSE_PUBLIC_KEY_FILE` to the issuer's Ed25519 public PEM before packaging. The issuer can run `node scripts/issue-license.mjs EMAIL PLAN EXPIRY_ISO` with `THUNDER_LICENSE_SIGNING_KEY_FILE` set on a signing machine. Keep the private key out of builds and version control. Demo accounts use a separate verification key, and the Free demo account stays Free even if the profile has a valid Pro license.

Existing standalone-app licenses need to be entered again once. The previous version kept a derived tier flag, and the current version verifies the original signed license on use.

Launch the prepared macOS demo with `pnpm demo`.

## Privacy

Inference, editor context, chat history, model files, and Agent audit records stay local by default. Zero Outbound mode blocks network operations. `creds.txt`, model binaries, build output, and local dependency stores are excluded from Git.

## Scope

Thunder currently focuses on local model inference, secure file editing, hardware-aware model routing, Agent review/apply, offline diagnostics, and explicitly approved workspace-scoped terminal commands. Terminal commands are bounded, output-limited, and reject destructive or pipe-to-shell patterns. The Workbench exposes Pro BYOK cloud reasoning only after an explicit account, network, and per-request approval; telemetry upload and silent auto-update are not enabled.
