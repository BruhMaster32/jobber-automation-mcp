# Security

## Supported versions

Only the latest tagged release is supported while the project is in private development.

## Secrets that must never enter Git

- `.env`
- Jobber client secrets and OAuth tokens
- OpenAI runtime API keys
- MCP path tokens and setup keys
- SQLite databases, WAL files, and backups

The included `.gitignore` blocks the usual locations and extensions, but review every staged change with `git diff --cached` before pushing.

## Deployment rules

- Keep the MCP server and tunnel health ports bound to `127.0.0.1`.
- Do not forward port 8080 or 8081 through a router.
- Use OpenAI Secure MCP Tunnel for ChatGPT access.
- Store the tunnel runtime key outside the repository with mode `600`.
- Use long, independent random values for `MCP_PATH_TOKEN` and `SETUP_KEY`.
- Keep the host, Docker Engine, Portainer, and container images patched.
- Back up the data volume before upgrades.

## Reporting a vulnerability

Do not open a public issue containing credentials, customer data, or exploit details. Report it privately to the repository owner through GitHub's private vulnerability-reporting feature when enabled.

## Current limitation

Jobber OAuth tokens are stored in the private SQLite data volume. Protect host access and backups accordingly. Operating-system-backed or encrypted secret storage is planned.
