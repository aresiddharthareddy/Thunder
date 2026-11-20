# Thunder clean-machine checklist

Run these checks on a fresh machine before publishing an artifact.

- [ ] Launch Thunder without developer tools or a source checkout.
- [ ] Hardware detection completes without a network request.
- [ ] Zero Outbound Mode can be enabled and remains enabled after restart.
- [ ] The bundled catalog loads and model hashes are shown.
- [ ] A model download can be paused and resumed without losing partial progress.
- [ ] Ask mode streams a response from a verified local model.
- [ ] Plan mode returns a numbered plan without changing files.
- [ ] Agent mode refuses writes without explicit authorization.
- [ ] Agent review shows files and supports Reject before Apply safely.
- [ ] Agent writes remain inside the selected workspace.
- [ ] Open folder skips hidden, ignored, and symbolic-link entries.
- [ ] Protected-file Save requires one-shot confirmation.
- [ ] Agent rollback restores files after a failed step.
- [ ] Terminal commands require one-shot approval and are locally audited without raw command text.
- [ ] Previous chat sessions can be selected and restored.
- [ ] Thunder Doctor exports a diagnostic report locally.
- [ ] No credentials, `.env` files, or private keys are present in the artifact.
- [ ] Verify the artifact against `release/SHA256SUMS.txt`.

Record the operating system, architecture, artifact filename, and SHA-256 beside this checklist for each release candidate.
