"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const libraryPath = fs.existsSync(path.join(path.dirname(process.execPath), "lib.cjs"))
  ? path.join(path.dirname(process.execPath), "lib.cjs")
  : path.join(__dirname, "lib.cjs");
const { buildEnvironment, defaultInstallRoot, dockerHelpUrl, validateFields } = require(libraryPath);

const execFileAsync = promisify(execFile);
const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
const launcherRoot = path.dirname(process.execPath);
const configPath = path.resolve(args.config || path.join(launcherRoot, "launcher-config.json"));
const uiPath = path.resolve(args.ui || path.join(launcherRoot, "ui.html"));
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const payloadRoot = path.resolve(args.payload || path.join(launcherRoot, config.payloadDirectory || "payload"));
const token = crypto.randomBytes(24).toString("base64url");
const state = { stage: "checking", message: "Checking this computer…", logs: [], postInstallUrl: null, installedAt: null };
let busy = false;

function log(value) {
  const clean = String(value).replace(/[\r\n]+$/g, "");
  if (!clean) return;
  state.logs.push(clean.slice(0, 2000));
  state.logs = state.logs.slice(-40);
}

async function run(file, commandArgs, cwd) {
  log(`Running ${file} ${commandArgs.join(" ")}`);
  const result = await execFileAsync(file, commandArgs, { cwd, timeout: 20 * 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  log(result.stdout);
  log(result.stderr);
  return result.stdout.trim();
}

async function dockerStatus() {
  try {
    const versionResult = await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 15_000, windowsHide: true });
    const composeResult = await execFileAsync("docker", ["compose", "version", "--short"], { timeout: 15_000, windowsHide: true });
    const version = versionResult.stdout.trim();
    const compose = composeResult.stdout.trim();
    return { installed: true, running: true, version, compose };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { installed: !/ENOENT|not recognized|not found/i.test(message), running: false, version: null, compose: null };
  }
}

function installPaths() {
  const root = path.resolve(args.destination || defaultInstallRoot(config.appId));
  const secretFiles = {};
  for (const secret of config.secretFiles || []) secretFiles[secret.field] = path.join(root, "secrets", secret.fileName);
  return { root, appDirectory: path.join(root, "app"), controlDirectory: path.join(root, "control"), secretFiles };
}

function copyPayload(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Application payload was not found at ${source}`);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (entry) => !["node_modules", ".git", "data", "secrets", ".env"].includes(path.basename(entry)),
  });
}

function resolvedPostInstallUrl(generated) {
  let value = config.postInstallUrl || config.appUrl;
  for (const [name, secret] of Object.entries(generated)) value = value.replaceAll(`\${${name}}`, encodeURIComponent(secret));
  return value;
}

async function install(input) {
  if (busy) throw new Error("Setup is already running");
  busy = true;
  state.stage = "installing";
  state.message = `Installing ${config.appName}…`;
  state.logs = [];
  try {
    const docker = await dockerStatus();
    if (!docker.running) throw new Error("Docker is not running yet. Install or start Docker, then press Check again.");
    validateFields(config, input);
    const paths = installPaths();
    fs.mkdirSync(paths.controlDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(paths.root, "secrets"), { recursive: true, mode: 0o700 });
    copyPayload(payloadRoot, paths.appDirectory);

    for (const secret of config.secretFiles || []) {
      const value = String(input[secret.field] || "").trim();
      fs.writeFileSync(paths.secretFiles[secret.field], `${value}\n`, { mode: 0o600 });
      try { fs.chmodSync(paths.secretFiles[secret.field], 0o600); } catch { /* Windows ACLs are managed by the user profile. */ }
    }
    const generated = Object.fromEntries((config.generatedSecrets || []).map((item) => [item.name, crypto.randomBytes(item.bytes || 32).toString("hex")]));
    fs.writeFileSync(path.join(paths.appDirectory, ".env"), buildEnvironment(config, input, generated, paths), { mode: 0o600 });
    try { fs.chmodSync(path.join(paths.appDirectory, ".env"), 0o600); } catch { /* Windows ACLs are managed by the user profile. */ }

    await run("docker", ["compose", "-p", config.composeProject, "config", "--quiet"], paths.appDirectory);
    await run("docker", ["compose", "-p", config.composeProject, "up", "-d", "--build", "--wait"], paths.appDirectory);
    state.postInstallUrl = resolvedPostInstallUrl(generated);
    state.installedAt = paths.appDirectory;
    state.stage = "ready";
    state.message = `${config.appName} is installed and healthy.`;
  } catch (error) {
    state.stage = "failed";
    state.message = error instanceof Error ? error.message : String(error);
    log(state.message);
  } finally {
    busy = false;
  }
}

function openExternal(url) {
  const command = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(command[0], command[1], { windowsHide: true }, () => {});
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 65_536) throw new Error("Setup request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname === "/" && request.method === "GET") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        "x-frame-options": "DENY",
      });
      response.end(fs.readFileSync(uiPath, "utf8").replaceAll("__SETUP_TOKEN__", token));
      return;
    }
    if (request.headers["x-setup-token"] !== token) return json(response, 403, { error: "Setup session is not authorized" });
    if (url.pathname === "/api/status" && request.method === "GET") {
      const docker = await dockerStatus();
      if (!busy && state.stage === "checking") {
        state.stage = docker.running ? "ready-to-install" : "docker-required";
        state.message = docker.running ? "Docker is ready. Complete the fields below." : "Docker must be installed and running first.";
      }
      return json(response, 200, {
        ...state,
        appName: config.appName,
        appUrl: config.appUrl,
        docker,
        dockerHelpUrl: dockerHelpUrl(),
        fields: config.fields || [],
        installRoot: installPaths().root,
      });
    }
    if (url.pathname === "/api/install" && request.method === "POST") {
      const body = await readBody(request);
      void install(body);
      return json(response, 202, { accepted: true });
    }
    if (url.pathname === "/api/open-docker" && request.method === "POST") {
      openExternal(dockerHelpUrl());
      return json(response, 200, { opened: true });
    }
    if (url.pathname === "/api/open-app" && request.method === "POST") {
      openExternal(state.postInstallUrl || config.appUrl);
      return json(response, 200, { opened: true });
    }
    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  state.message = "Setup launcher is ready.";
  openExternal(`http://127.0.0.1:${port}/`);
  console.log(`${config.appName} setup: http://127.0.0.1:${port}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
