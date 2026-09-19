"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "9router",
    );
  }
  return path.join(os.homedir(), ".9router");
}

function getCliToken() {
  const dir = getDataDir();
  const machineIdFile = path.join(dir, "machine-id");
  const secretFile = path.join(dir, "auth", "cli-secret");

  let machineId = "";
  let secret = "";
  try {
    machineId = fs.readFileSync(machineIdFile, "utf8").trim();
  } catch (e) {}
  try {
    secret = fs.readFileSync(secretFile, "utf8").trim();
  } catch (e) {}

  if (!machineId || !secret) {
    throw new Error(
      "Could not read 9Router CLI credentials. Expected files:\n" +
        `  ${machineIdFile}\n` +
        `  ${secretFile}\n` +
        "Make sure 9Router has been started at least once.",
    );
  }

  return crypto
    .createHash("sha256")
    .update(machineId + CLI_TOKEN_SALT + secret)
    .digest("hex")
    .substring(0, 16);
}

async function apiRequest(baseUrl, method, apiPath, body, token) {
  const res = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      [CLI_TOKEN_HEADER]: token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

function createClient(options = {}) {
  const baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
  const token = options.token || getCliToken();

  return {
    baseUrl,
    token,

    async getExistingNames(nodeId) {
      const res = await apiRequest(baseUrl, "GET", "/api/providers", undefined, token);
      if (!res.ok) {
        throw new Error(
          `GET /api/providers failed (HTTP ${res.status}): ` +
            `${res.data && res.data.error ? res.data.error : "unknown error"}`,
        );
      }
      const connections = (res.data && res.data.connections) || [];
      const names = new Set();
      for (const conn of connections) {
        if (conn.provider !== nodeId) continue;
        if (conn.name) names.add(conn.name.trim().toLowerCase());
      }
      return { names, total: connections.length };
    },

    async addKey(nodeId, { name, apiKey, model, testStatus = "unknown" }) {
      const res = await apiRequest(
        baseUrl,
        "POST",
        "/api/providers",
        {
          provider: nodeId,
          name,
          apiKey,
          defaultModel: model,
          testStatus,
        },
        token,
      );
      if (!res.ok || (res.data && res.data.error)) {
        const reason = (res.data && res.data.error) || `HTTP ${res.status}`;
        throw new Error(reason);
      }
      return res.data && res.data.connection;
    },

    async validateKey(nodeId, apiKey) {
      const res = await apiRequest(
        baseUrl,
        "POST",
        "/api/providers/validate",
        { provider: nodeId, apiKey },
        token,
      );
      return {
        valid: res.ok && !!(res.data && res.data.valid),
        error: (res.data && res.data.error) || `HTTP ${res.status}`,
      };
    },

    async pushKeyWithRetry(nodeId, payload, opts = {}) {
      const { retries = 4, backoffMs = 1000, onRetry } = opts;
      let lastError;
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await this.addKey(nodeId, payload);
        } catch (e) {
          lastError = e;
          if (attempt < retries) {
            const wait = backoffMs * Math.pow(2, attempt - 1);
            if (onRetry) onRetry(attempt, e, wait);
            await sleep(wait);
          }
        }
      }
      throw lastError;
    },
  };
}

module.exports = { getDataDir, getCliToken, createClient };
