# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Calendar schedules, conditions, retries, and idempotency controls
- Purpose-built Jobber visit and scheduling tools
- Backup and restore commands

## [0.2.1] - 2026-08-27

### Changed

- Jobber mutations now accept a controlled set of natural explicit confirmations such as `yes`, `do it`, `confirmed`, and `I approve`, while still requiring explicit user approval.
- The `jobber_mutation` MCP schema now exposes confirmation as a non-empty string instead of requiring one exact literal phrase.
- If ChatGPT treats a user's explicit approval as valid but the server rejects the exact wording because it is not in the local confirmation allow-list (for example, `go`), ChatGPT can retry the same approved mutation using a server-accepted canonical confirmation phrase. The user's original approval still has to be explicit; this does not allow unapproved mutations.
- Updated GraphQL safety tests for the revised confirmation behavior.

## [0.2.0] - 2026-08-26

First versioned repository release.

### Added

- Jobber OAuth authorization and refresh-token rotation
- Read-only account, client, job, and GraphQL tools
- Confirmed GraphQL mutation tool
- Draft, preview, activation, pause, run-now, history, and deletion lifecycle
- Interval-triggered automation worker with SQLite persistence and auditing
- Docker packaging for macOS, Linux AMD64, and Raspberry Pi ARM64
- OpenAI Secure MCP Tunnel service in Docker Compose
- Installation, Raspberry Pi, backup, recovery, and security documentation

### Security

- Exact confirmation phrases guard mutations and automation activation
- MCP endpoint uses a random path token
- Local service ports bind only to loopback
- Credentials, databases, backups, and runtime keys are excluded from Git
