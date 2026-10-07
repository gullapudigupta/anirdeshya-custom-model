# Release Readiness

This checklist records repository-level preparation separately from actions that
need GitHub, distribution credentials, or an authorized release decision.
Creating a CI workflow or checklist is not a release approval.

## Repository gates

- [x] Node.js support is declared as `>=20.0.0`.
- [x] A locked install is available through `npm ci`.
- [x] CI is configured for Node.js 20, 22, and 24 on Ubuntu, Windows, and macOS.
- [x] The test suite has passed locally on Windows with Node.js 24.
- [ ] All hosted CI matrix jobs pass from the release candidate commit.
- [ ] Run and triage the npm audit for the locked dependency tree; resolve
  findings or record explicitly accepted risks.
- [ ] Supported external language-tool integrations have toolchain-specific
  acceptance results; the core CI matrix does not install those toolchains.
- [ ] Final security and performance reviews are complete for the release
  candidate.
- [ ] User acceptance feedback has been collected, triaged, and signed off.

## Authorized release actions

- [ ] Confirm release scope, version, and release date with the maintainer.
- [ ] Update release notes with verified changes and known limitations.
- [ ] Confirm package contents and run installation/smoke checks from a clean
  environment.
- [ ] Obtain explicit approval before creating a release branch or tag.
- [ ] Publish through the authorized distribution account and verify the
  published artifact.
- [ ] Confirm rollback instructions and the operator responsible for rollback.
- [ ] Configure and test monitoring, alert routing, and support channels.
- [ ] Publish the announcement and support documentation.

## Go / no-go

Do not publish while any required hosted CI job is failing, critical UAT issues
remain unresolved, or release approval and publishing credentials are absent.
Record the release candidate commit, test evidence, approver, and final
go/no-go decision with the release record.
