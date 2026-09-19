"use strict";

const chalk = require("chalk");

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function formatElapsed(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function startTimer() {
  const t0 = Date.now();
  return () => chalk.dim(`(${formatElapsed(Date.now() - t0)})`);
}

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

function banner(title, info = {}) {
  console.log(chalk.cyan.bold(`\n=== ${title} ===`));
  const maxLen = Math.max(...Object.keys(info).map((k) => k.length));
  for (const [k, v] of Object.entries(info)) {
    console.log(`  ${chalk.bold(k.padEnd(maxLen))} : ${v}`);
  }
  console.log("");
}

function section(index, total, email) {
  const bar = chalk.gray("─".repeat(50));
  console.log(`\n${bar}`);
  console.log(`${chalk.cyan.bold(`[${index}/${total}]`)} ${chalk.bold(email)}`);
  console.log(bar);
}

function step(msg) {
  console.log(`  ${chalk.dim("*")} ${chalk.dim(msg)}`);
}

function ok(msg, elapsed = "") {
  const suffix = elapsed ? `  ${elapsed}` : "";
  console.log(`${chalk.green.bold("[OK]")}   ${msg}${suffix}`);
}

function fail(msg, elapsed = "") {
  const suffix = elapsed ? `  ${elapsed}` : "";
  process.stdout.write(`${chalk.red.bold("[FAIL]")} ${msg}${suffix}\n`);
}

function fatal(msg) {
  process.stdout.write(`\n${chalk.bgRed.white.bold(" FATAL ")} ${chalk.red(msg)}\n`);
}

function retry(msg) {
  console.log(`  ${chalk.yellow("[retry]")} ${msg}`);
}

function info(msg) {
  console.log(msg);
}

function summary({
  pushed,
  failed,
  pendingSaved = 0,
  elapsed = "",
  successLog = "",
  failureLog = "",
  showRetryHint = false,
}) {
  console.log(`\n${chalk.cyan.bold("=== Summary ===")}`);

  const row = (label, value, color) => {
    const padded = String(value).padStart(4);
    const colored = color ? color(padded) : padded;
    console.log(`  ${chalk.bold(label.padEnd(16))} ${colored}`);
  };

  row("Pushed", pushed, pushed > 0 ? chalk.green : null);
  row("Failed", failed, failed > 0 ? chalk.red : null);
  if (pendingSaved > 0) row("Saved pending", pendingSaved, chalk.yellow);
  if (elapsed) row("Elapsed", elapsed, chalk.dim);

  if (successLog || failureLog || showRetryHint) console.log("");

  if (successLog && pushed > 0)
    console.log(`  ${chalk.bold("Success log")}      : ${chalk.green(successLog)}`);
  if (failureLog && failed > 0)
    console.log(`  ${chalk.bold("Failure log")}      : ${chalk.red(failureLog)}`);
  if (showRetryHint)
    console.log(
      `\n  ${chalk.yellow("Retry undelivered keys:")}\n  ${chalk.dim("node atria2router.js --push-pending")}`,
    );
}

function interrupted() {
  console.log(`\n${chalk.yellow("Interrupted.")} Closing browser...`);
}

module.exports = {
  banner,
  section,
  step,
  ok,
  fail,
  fatal,
  retry,
  info,
  summary,
  interrupted,
  startTimer,
  formatElapsed,
};
