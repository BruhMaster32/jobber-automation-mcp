# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned

- Calendar schedules, conditions, retries, and idempotency controls
- Purpose-built Jobber visit and scheduling tools
- Backup and restore commands

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
