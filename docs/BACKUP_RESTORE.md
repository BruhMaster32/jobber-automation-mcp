# Backup and restore

The named Docker volume contains Jobber OAuth tokens, automations, run history, and audit records. Treat every backup as a secret.

## Find the volume name

From the repository directory:

```bash
docker compose ps -q jobber-mcp
```

Use the returned container ID:

```bash
docker inspect CONTAINER_ID --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}'
```

Call the result `VOLUME_NAME` in the commands below.

## Consistent backup

Stop the stack briefly so SQLite and its WAL file are captured consistently:

```bash
docker compose stop tunnel-client jobber-mcp
mkdir -p backups
chmod 700 backups
docker run --rm \
  -v VOLUME_NAME:/source:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.22 \
  sh -c 'cd /source && tar czf /backup/jobber-mcp-data.tgz .'
chmod 600 backups/jobber-mcp-data.tgz
docker compose up -d
```

Verify that the archive is non-empty:

```bash
tar tzf backups/jobber-mcp-data.tgz
```

The `backups/` directory and archive formats are ignored by Git.

## Restore to a new host

Create the destination volume without starting the application:

```bash
docker compose create jobber-mcp
```

Find its `VOLUME_NAME` using the inspection steps above, then restore:

```bash
docker run --rm \
  -v VOLUME_NAME:/destination \
  -v "$PWD/backups:/backup:ro" \
  alpine:3.22 \
  sh -c 'cd /destination && tar xzf /backup/jobber-mcp-data.tgz'
```

Start and verify:

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8081/readyz
```

## Rollback

If the new host fails, stop its stack before restarting the old host. Never allow both tunnel clients to use the same tunnel concurrently.
