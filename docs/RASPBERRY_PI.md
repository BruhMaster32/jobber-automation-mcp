# Raspberry Pi deployment

## Recommended host

- Raspberry Pi 4 or newer
- 64-bit Raspberry Pi OS
- 4 GB RAM minimum; 8 GB is ample
- Reliable Ethernet when available
- Docker Engine and Compose plugin
- Adequate, backed-up storage

A 32 GB USB 3 drive is enough for this service, but it should not be the only copy of the database.

## Prepare the Pi

```bash
sudo apt update
sudo apt full-upgrade -y
docker version
docker compose version
```

Clone the private repository and follow [INSTALL.md](INSTALL.md). Use a Linux path for `TUNNEL_KEY_FILE`, for example:

```text
/home/your-user/.config/tunnel-client/secrets/jobber-mcp-runtime-key
```

The Compose services use `restart: unless-stopped`, so Docker starts them again after a normal reboot. Docker itself must be enabled:

```bash
sudo systemctl enable --now docker
```

## Portainer

Portainer is optional. The stack should be created and updated with Docker Compose so its configuration remains reproducible in Git. Portainer can then inspect containers, logs, health, images, volumes, and resource usage.

Do not paste `.env` values into Portainer screenshots or public issue reports.

## Migrating an existing host

Do not run the same OpenAI tunnel from two hosts simultaneously.

1. Clone and configure the project on the Pi without starting it.
2. Stop the old tunnel and application containers.
3. Back up the old data volume.
4. Copy and restore the archive on the Pi.
5. Start the Pi stack and verify both health endpoints.
6. Test local automation reads, Jobber account access, and a small client query.
7. Keep the old host stopped but intact until the Pi survives a reboot test.

Exact backup and restore commands are in [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
