# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Calendar schedules, conditions, retries, and idempotency controls
- Purpose-built Jobber visit and scheduling tools
- Backup and restore commands

## [0.3.0] - 2026-08-28

### Added

- Local browser-based initial-install wizard for Windows, macOS, Linux, and Raspberry Pi
- Downloadable bundles with an included Node runtime and checksums
- GUI fields for Jobber credentials, API date, OpenAI tunnel ID, and runtime key
- Automatic generation of the MCP path token and private setup key
- Release workflow for Windows x64, macOS Intel/Apple Silicon, Linux x64, and Linux ARM64 artifacts

### Security

- OpenAI runtime key is written to a protected file outside the source payload and is never placed in `.env`
- Setup server is loopback-only and every API request requires a random per-launch token
- Installer uses official Docker guidance instead of silently running a privileged installation script

## [0.2.1] - 2026-08-27

### Changed

- Jobber mutations now accept clear natural confirmations such as `yes`, `do it`, and `approved`
- Mutation confirmation input now uses a non-empty string schema so clients can pass natural approval text
- The MCP server can retry with the canonical confirmation phrase if a client rejects other wording
- Updated GraphQL safety tests for accepted and rejected confirmation language

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
