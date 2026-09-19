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
const logger = require("./lib/logger");

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
  logger.info(`Pending keys in ${fileName(config.files.pendingKeys)}: ${pairs.length}`);
  if (pairs.length === 0) {
    logger.info("Nothing to do.");
    return;
  }

  const client = createClient({ baseUrl: BASE_URL });
  let pushed = 0;
  let failed = 0;
  const runStart = Date.now();

  for (const pair of pairs) {
    const elapsed = logger.startTimer();
    try {
      await client.pushKeyWithRetry(
        PROVIDER_NODE_ID,
        { name: pair.email, apiKey: pair.apiKey, model: MODEL },
        {
          retries: RETRIES,
          onRetry: (attempt, err, wait) =>
            logger.retry(
              `${pair.email} attempt ${attempt} failed (${err.message}); waiting ${wait}ms`,
            ),
        },
      );
      files.appendUniqueLine(config.files.sukses, pair.raw);
      files.removeLine(config.files.pendingKeys, pair.raw);
      pushed++;
      logger.ok(`${pair.email} pushed to 9Router`, elapsed());
    } catch (e) {
      failed++;
      logger.fail(`${pair.email}: ${e.message}`, elapsed());
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  logger.summary({ pushed, failed, elapsed: logger.formatElapsed(Date.now() - runStart) });
}

/* ------------------------------------------------------------------ */
/* Main pipeline: akun.txt -> Atria -> 9Router                         */
/* ------------------------------------------------------------------ */

async function runPipeline() {
  const accounts = files.readAccounts(config.files.akun);
  logger.info(`Accounts in ${fileName(config.files.akun)}: ${accounts.length}`);
  if (accounts.length === 0) {
    logger.info("Nothing to do.");
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

  logger.info(`Already pushed to 9Router : ${success.size}`);
  logger.info(`Existing keys on node     : ${existing.names.size}`);
  logger.info(`Keys awaiting push        : ${awaitingPush.size}`);
  logger.info(`Accounts to process       : ${pending.length}`);

  if (pending.length === 0) {
    logger.info("No new accounts to process.");
    return;
  }

  let pushed = 0;
  let failed = 0;
  let pendingSaved = 0;
  const runStart = Date.now();

  for (let i = 0; i < pending.length; i++) {
    const account = pending[i];
    logger.section(i + 1, pending.length, account.email);
    const elapsed = logger.startTimer();

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
      logger.fail(`${account.email}: ${e.message}`, elapsed());
      if (i < pending.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
      continue;
    }

    if (!isValidApiKey(apiKey)) {
      failed++;
      files.appendUniqueLine(
        config.files.gagal,
        `${account.raw} | Reason: created key has an unrecognized format`,
      );
      logger.fail(`${account.email}: created key has an unrecognized format`, elapsed());
      if (i < pending.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
      continue;
    }

    logger.step("Pushing key to 9Router...");

    // 2. Push to 9Router, then discard the key.
    try {
      await client.pushKeyWithRetry(
        PROVIDER_NODE_ID,
        { name: account.email, apiKey, model: MODEL },
        {
          retries: RETRIES,
          onRetry: (attempt, err, wait) =>
            logger.retry(
              `push attempt ${attempt} failed (${err.message}); waiting ${wait}ms`,
            ),
        },
      );

      files.appendUniqueLine(config.files.sukses, account.raw);
      existing.names.add(account.email.toLowerCase());
      if (!KEEP_AKUN) files.removeLine(config.files.akun, account.raw);

      pushed++;
      logger.ok(
        `${account.email} pushed to 9Router` +
        (KEEP_AKUN ? "" : " and removed from akun.txt"),
        elapsed(),
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
      logger.fail(
        `${account.email}: push failed (${e.message}); ` +
        `key saved to ${fileName(config.files.pendingKeys)}` +
        (KEEP_AKUN ? "" : " and removed from akun.txt"),
        elapsed(),
      );
    }

    if (i < pending.length - 1 && DELAY_MS > 0) await sleep(DELAY_MS);
  }

  logger.summary({
    pushed,
    failed,
    pendingSaved,
    elapsed: logger.formatElapsed(Date.now() - runStart),
    successLog: pushed > 0 ? fileName(config.files.sukses) : "",
    failureLog: failed > 0 ? fileName(config.files.gagal) : "",
    showRetryHint: pendingSaved > 0,
  });
}

async function main() {
  logger.banner("Atria -> 9Router Pipeline", {
    "Base URL": BASE_URL,
    "Node    ": PROVIDER_NODE_ID,
    "Model   ": MODEL,
    ...(PUSH_PENDING ? { "Mode    ": "PUSH PENDING" } : {}),
  });

  if (PUSH_PENDING) return pushPending();
  return runPipeline();
}

process.on("SIGINT", () => {
  logger.interrupted();
  closeActiveBrowser();
  process.exit(130);
});

if (require.main === module) {
  main().catch((error) => {
    logger.fatal(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, runPipeline, pushPending };
