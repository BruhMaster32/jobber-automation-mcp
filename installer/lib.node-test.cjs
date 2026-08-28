"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildEnvironment, defaultInstallRoot, dockerHelpUrl, formatEnvValue, validateFields } = require("./lib.cjs");

const config = {
  fields: [{ name: "CLIENT_ID", label: "Client ID", required: true, pattern: "^[a-z0-9-]+$" }],
  environmentDefaults: { PORT: "8080" },
  controlDirectoryEnv: "CONTROL_DIR",
  secretFiles: [{ field: "RUNTIME_KEY", env: "KEY_FILE" }],
};

test("keeps runtime secrets out of the environment file", () => {
  assert.equal(buildEnvironment(config, { CLIENT_ID: "abc-123", RUNTIME_KEY: "not-written" }, { TOKEN: "secret" }, {
    controlDirectory: "/tmp/control",
    secretFiles: { RUNTIME_KEY: "/tmp/secrets/runtime-key" },
  }), 'PORT="8080"\nCLIENT_ID="abc-123"\nTOKEN="secret"\nCONTROL_DIR="/tmp/control"\nKEY_FILE="/tmp/secrets/runtime-key"\n');
});

test("rejects invalid or multiline configuration", () => {
  assert.throws(() => validateFields(config, { CLIENT_ID: "ABC!" }), /not valid/);
  assert.throws(() => formatEnvValue("one\ntwo"), /line breaks/);
});

test("selects platform-native install and Docker help locations", () => {
  assert.equal(defaultInstallRoot("jobber-automation-mcp", "linux", "/home/gavin", {}), "/home/gavin/.local/share/jobber-automation-mcp");
  assert.match(dockerHelpUrl("darwin"), /mac-install/);
});
