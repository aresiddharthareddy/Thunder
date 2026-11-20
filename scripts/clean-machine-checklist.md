# Thunder clean-machine checklist

Run these checks on a fresh machine before publishing an artifact.

- [ ] Launch Thunder without developer tools or a source checkout.
- [ ] Hardware detection completes without a network request.
- [ ] The bundled catalog loads and model hashes are shown.
- [ ] Ask mode streams a response from a verified local model.
- [ ] Plan mode returns a numbered plan without changing files.
- [ ] Agent mode refuses writes without explicit authorization.
- [ ] Agent writes remain inside the selected workspace.
- [ ] Agent rollback restores files after a failed step.
- [ ] Thunder Doctor exports a diagnostic report locally.
- [ ] No credentials, `.env` files, or private keys are present in the artifact.
- [ ] Verify the artifact against `release/SHA256SUMS.txt`.

Record the operating system, architecture, artifact filename, and SHA-256 beside this checklist for each release candidate.
