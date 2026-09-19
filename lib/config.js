"use strict";

const path = require("path");

const ROOT = path.join(__dirname, "..");

const config = {
  root: ROOT,

  // 9Router
  baseUrl: (process.env.NINE_ROUTER_URL || "http://localhost:20128").replace(
    /\/+$/,
    "",
  ),
  providerNodeId:
    process.env.PROVIDER_NODE_ID ||
    "openai-compatible-chat-52d3294f-b579-45c7-a582-58c0aa600a40",
  defaultModel: process.env.DEFAULT_MODEL || "Atria-Dawn-Preview",

  // Atria console
  consoleKeysUrl: "https://api.atria-asi.ai/console/keys",
  consoleOrigin: "https://api.atria-asi.ai",

  files: {
    akun: path.join(ROOT, "akun.txt"),

    // Run state (akun.txt -> Atria -> 9Router)
    sukses: path.join(ROOT, "sukses.txt"),
    gagal: path.join(ROOT, "gagal.txt"),
    pendingKeys: path.join(ROOT, "pending_keys.txt"),
  },
};

module.exports = config;
