# Contributing

This is currently a private, single-owner project. Changes should be made on a branch and merged only after CI passes.

## Development checks

```bash
npm ci
npm run check
docker build -t jobber-automation-mcp:test .
```

## Pull requests

- Describe the user-visible behavior and safety impact.
- Add or update tests for changed behavior.
- Update `CHANGELOG.md` under `Unreleased`.
- Never include `.env`, tokens, databases, backups, customer data, or copied production logs.
- Keep write actions behind explicit confirmation and preserve audit records.

## Releases

1. Move applicable `Unreleased` entries into a dated version section.
2. Update `package.json` and `package-lock.json` to the same version.
3. Run `npm run check` and build the Docker image.
4. Commit the release, create an annotated `vMAJOR.MINOR.PATCH` tag, and publish matching release notes.
