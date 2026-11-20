# Thunder release runbook

1. Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build:main`, `pnpm build:renderer`, and `pnpm verify:packaging`.
2. Run `pnpm package` on the target operating system.
3. Run `pnpm verify:release` to create `release/SHA256SUMS.txt`.
4. Complete `scripts/clean-machine-checklist.md` on a clean machine for each target.
5. If signing credentials are unavailable, publish the artifacts as unsigned and state that clearly in the release notes. Do not ship private signing keys.
6. Publish the checksums with the artifacts.

Thunder does not enable auto-update, telemetry upload, or cloud fallback by default.
