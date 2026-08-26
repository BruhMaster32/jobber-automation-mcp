# Installation

## Requirements

- Docker Engine with the Compose plugin
- A Jobber developer application
- An OpenAI Secure MCP Tunnel ID and runtime API key
- A private machine that remains online while tools and automations are needed

The images support Linux AMD64, Linux ARM64, and Apple Silicon through Docker's multi-architecture support.

## 1. Clone and configure

```bash
git clone REPOSITORY_URL
cd jobber-automation-mcp
cp .env.example .env
```

Generate independent secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Edit `.env` locally and set:

- `MCP_PATH_TOKEN`: first generated value
- `SETUP_KEY`: second generated value
- `JOBBER_CLIENT_ID` and `JOBBER_CLIENT_SECRET`
- `PUBLIC_BASE_URL`: origin used by the Jobber OAuth callback
- `OPENAI_TUNNEL_ID`
- `TUNNEL_KEY_FILE`: absolute host path to the runtime-key file

Never commit `.env`.

## 2. Store the tunnel runtime key

```bash
mkdir -p "$HOME/.config/tunnel-client/secrets"
chmod 700 "$HOME/.config/tunnel-client/secrets"
umask 077
read -rsp "Runtime API key: " RUNTIME_KEY
printf '\n'
printf '%s\n' "$RUNTIME_KEY" > "$HOME/.config/tunnel-client/secrets/jobber-mcp-runtime-key"
unset RUNTIME_KEY
chmod 600 "$HOME/.config/tunnel-client/secrets/jobber-mcp-runtime-key"
```

Set `TUNNEL_KEY_FILE` in `.env` to that file's absolute path.

## 3. Validate and start

```bash
docker compose config --quiet
docker compose pull tunnel-client
docker compose up -d --build
docker compose ps
```

Local checks:

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8081/readyz
```

Both services should become healthy.

## 4. Authorize Jobber

Configure the Jobber developer application's callback URL to match:

```text
PUBLIC_BASE_URL/oauth/jobber/callback
```

Open the following URL on the host, replacing the placeholder with the local `SETUP_KEY` value:

```text
http://127.0.0.1:8080/admin/connect?key=YOUR_SETUP_KEY
```

Approve access and wait for `Jobber connected`.

## 5. Verify from ChatGPT

Add or select the private Jobber MCP connection and run a read-only request first:

```text
Verify the connected Jobber account. Make no changes.
```

Do not test mutations until account and read-only calls succeed.

## Updating

Back up the data volume first, then:

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
```

See [BACKUP_RESTORE.md](BACKUP_RESTORE.md) before upgrades or migrations.
