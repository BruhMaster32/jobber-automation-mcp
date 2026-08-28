"use strict";

const os = require("node:os");
const path = require("node:path");

function safeValue(value) {
  const text = String(value ?? "").trim();
  if (/\r|\n|\0/.test(text)) throw new Error("Configuration values cannot contain line breaks");
  return text;
}

function formatEnvValue(value) {
  return `"${safeValue(value).replace(/\\/g, "/").replace(/"/g, '\\"')}"`;
}

function defaultInstallRoot(appId, platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), appId);
  if (platform === "darwin") return path.join(home, "Library", "Application Support", appId);
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), appId);
}

function validateFields(config, input) {
  const values = {};
  for (const field of config.fields || []) {
    const value = safeValue(input[field.name]);
    if (field.required && !value) throw new Error(`${field.label} is required`);
    if (value && field.minLength && value.length < field.minLength) throw new Error(`${field.label} is too short`);
    if (value && field.pattern && !(new RegExp(field.pattern).test(value))) throw new Error(`${field.label} is not valid`);
    values[field.name] = value || safeValue(field.default || "");
  }
  return values;
}

function buildEnvironment(config, input, generated, paths) {
  const values = { ...(config.environmentDefaults || {}), ...validateFields(config, input), ...generated };
  if (config.controlDirectoryEnv) values[config.controlDirectoryEnv] = paths.controlDirectory;
  for (const secret of config.secretFiles || []) {
    delete values[secret.field];
    values[secret.env] = paths.secretFiles[secret.field];
  }
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length > 0)
    .map(([key, value]) => `${key}=${formatEnvValue(value)}`)
    .join("\n") + "\n";
}

function dockerHelpUrl(platform = process.platform) {
  if (platform === "win32") return "https://docs.docker.com/desktop/setup/install/windows-install/";
  if (platform === "darwin") return "https://docs.docker.com/desktop/setup/install/mac-install/";
  return "https://docs.docker.com/engine/install/";
}

module.exports = { buildEnvironment, defaultInstallRoot, dockerHelpUrl, formatEnvValue, safeValue, validateFields };
