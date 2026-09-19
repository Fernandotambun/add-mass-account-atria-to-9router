"use strict";

const path = require("path");
const config = require("./lib/config");
const files = require("./lib/files");
const { parseArgs } = require("./lib/args");
const {
  createAtriaKey,
  isValidApiKey,
  closeActiveBrowser,
} = require("./lib/atria");
const { createClient } = require("./lib/nineRouter");
const { sleep } = require("./lib/browser");

const args = parseArgs();

const BASE_URL = (
  args.get("base-url") ||
  process.env.NINE_ROUTER_URL ||
  config.baseUrl
).replace(/\/+$/, "");
const PROVIDER_NODE_ID =
  args.get("provider") || process.env.PROVIDER_NODE_ID || config.providerNodeId;
const MODEL = args.get("model") || process.env.DEFAULT_MODEL || config.defaultModel;

const KEEP_AKUN = args.has("keep-akun");
const PUSH_PENDING = args.has("push-pending");
const RETRIES = args.int("retries", parseInt(process.env.RETRIES || "4", 10) || 4);
const DELAY_MS = args.int("delay", 3000);

const fileName = (file) => path.basename(file);

/* ------------------------------------------------------------------ */
/* Retry mode: pending_keys.txt -> 9Router                             */
/* ------------------------------------------------------------------ */

async function pushPending() {
  const pairs = files.readKeyPairs(config.files.pendingKeys);
  console.log(`Pending keys in ${fileName(config.files.pendingKeys)}: ${pairs.length}`);
  if (pairs.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const client = createClient({ baseUrl: BASE_URL });
  let pushed = 0;
  let failed = 0;

  for (const pair of pairs) {
    try {
      await client.pushKeyWithRetry(
        PROVIDER_NODE_ID,
        { name: pair.email, apiKey: pair.apiKey, model: MODEL },
        {
          retries: RETRIES,
          onRetry: (attempt, err, wait) =>
            console.log(
              `  [retry] ${pair.email} attempt ${attempt} failed (${err.message}); waiting ${wait}ms`,
            ),
        },
      );
      files.appendUniqueLine(config.files.sukses, pair.raw);
      files.removeLine(config.files.pendingKeys, pair.raw);
      pushed++;
      console.log(`[OK]   ${pair.email} pushed to 9Router`);
    } catch (e) {
      failed++;
      console.error(`[FAIL] ${pair.email}: ${e.message}`);
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log("\n=== Summary ===");
  console.log(`Pushed : ${pushed}`);
  console.log(`Failed : ${failed}`);
}

/* ------------------------------------------------------------------ */
/* Main pipeline: akun.txt -> Atria -> 9Router                         */
/* ------------------------------------------------------------------ */

async function runPipeline() {
  const accounts = files.readAccounts(config.files.akun);
  console.log(`Accounts in ${fileName(config.files.akun)}: ${accounts.length}`);
  if (accounts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const client = createClient({ baseUrl: BASE_URL });

  let existing;
  try {
    existing = await client.getExistingNames(PROVIDER_NODE_ID);
  } catch (e) {
    throw new Error(e.message);
  }
  const success = files.readEmailSet(config.files.sukses);
  const awaitingPush = files.readEmailSet(config.files.pendingKeys);

  const pending = accounts.filter(
    (a) =>
      !success.has(a.email.toLowerCase()) &&
      !awaitingPush.has(a.email.toLowerCase()) &&
      !existing.names.has(a.email.toLowerCase()),
  );

  console.log(`Already pushed to 9Router : ${success.size}`);
  console.log(`Existing keys on node     : ${existing.names.size}`);
  console.log(`Keys awaiting push        : ${awaitingPush.size}`);
  console.log(`Accounts to process       : ${pending.length}\n`);

  if (pending.length === 0) {
    console.log("No new accounts to process.");
    return;
  }

  let pushed = 0;
  let failed = 0;
  let pendingSaved = 0;

  for (let i = 0; i < pending.length; i++) {
    const account = pending[i];
    console.log(`\n==================================================`);
    console.log(`=== Account ${i + 1}/${pending.length}: ${account.email} ===`);
    console.log(`==================================================`);

    // 1. Create the Atria key (browser is closed by createAtriaKey).
    let apiKey;
    try {
      ({ apiKey } = await createAtriaKey(account, {
        index: i + 1,
        total: pending.length,
      }));
    } catch (e) {
      failed++;
      files.appendUniqueLine(
        config.files.gagal,
        `${account.raw} | Reason: atria: ${e.message}`,
      );
      console.error(`[FAIL] ${account.email}: ${e.message}`);
      if (i < pending.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
      continue;
    }

    if (!isValidApiKey(apiKey)) {
      failed++;
      files.appendUniqueLine(
        config.files.gagal,
        `${account.raw} | Reason: created key has an unrecognized format`,
      );
      console.error(
        `[FAIL] ${account.email}: created key has an unrecognized format`,
      );
      if (i < pending.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
      continue;
    }

    console.log("  Pushing key to 9Router...");

    // 2. Push to 9Router, then discard the key.
    try {
      await client.pushKeyWithRetry(
        PROVIDER_NODE_ID,
        { name: account.email, apiKey, model: MODEL },
        {
          retries: RETRIES,
          onRetry: (attempt, err, wait) =>
            console.log(
              `  [retry] push attempt ${attempt} failed (${err.message}); waiting ${wait}ms`,
            ),
        },
      );

      files.appendUniqueLine(config.files.sukses, account.raw);
      existing.names.add(account.email.toLowerCase());
      if (!KEEP_AKUN) files.removeLine(config.files.akun, account.raw);

      pushed++;
      console.log(
        `[OK]   ${account.email} pushed to 9Router` +
        (KEEP_AKUN ? "" : " and removed from akun.txt"),
      );
    } catch (e) {
      // The Atria key exists but could not be delivered. Keep the key for a
      // retry and drop the account so the next run does not log in again and
      // create a duplicate key.
      failed++;
      pendingSaved++;
      files.appendUniqueLine(
        config.files.pendingKeys,
        `${account.email}|${apiKey}`,
      );
      files.appendUniqueLine(
        config.files.gagal,
        `${account.raw} | Reason: 9router push failed: ${e.message}`,
      );
      if (!KEEP_AKUN) files.removeLine(config.files.akun, account.raw);
      console.error(
        `[FAIL] ${account.email}: push failed (${e.message}); ` +
        `key saved to ${fileName(config.files.pendingKeys)}` +
        (KEEP_AKUN ? "" : " and removed from akun.txt"),
      );
    }

    if (i < pending.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  console.log("\n=== Summary ===");
  console.log(`Pushed        : ${pushed}`);
  console.log(`Failed        : ${failed}`);
  console.log(`Saved pending : ${pendingSaved}`);
  if (pushed > 0) {
    console.log(`\nSuccess log: ${fileName(config.files.sukses)}`);
  }
  if (failed > 0) {
    console.log(`Failure log: ${fileName(config.files.gagal)}`);
  }
  if (pendingSaved > 0) {
    console.log(
      `Retry the undelivered keys with: node atria2router.js --push-pending`,
    );
  }
}

async function main() {
  console.log("=== Atria -> 9Router Pipeline ===");
  console.log(`Base URL : ${BASE_URL}`);
  console.log(`Node     : ${PROVIDER_NODE_ID}`);
  console.log(`Model    : ${MODEL}`);
  if (PUSH_PENDING) console.log("Mode     : PUSH PENDING");
  console.log("");

  if (PUSH_PENDING) return pushPending();
  return runPipeline();
}

process.on("SIGINT", () => {
  console.log("\nInterrupted. Closing browser...");
  closeActiveBrowser();
  process.exit(130);
});

if (require.main === module) {
  main().catch((error) => {
    console.error(`\n[FATAL] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, runPipeline, pushPending };
