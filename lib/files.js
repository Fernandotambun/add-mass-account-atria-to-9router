"use strict";

const fs = require("fs");

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
}

function readAccounts(file) {
  return readLines(file)
    .map((line) => {
      const parts = line.trim().split("|");
      if (parts.length < 2) return null;
      const email = parts[0].trim();
      const password = parts[1].trim();
      if (!email || !password) return null;
      return { email, password, raw: line.trim() };
    })
    .filter(Boolean);
}

function readEmailSet(file) {
  return new Set(
    readLines(file)
      .map((line) => line.split("|")[0].trim().toLowerCase())
      .filter(Boolean),
  );
}

function readKeyPairs(file) {
  return readLines(file)
    .map((line, i) => {
      const parts = line.split("|");
      if (parts.length < 2) return null;
      const email = parts[0].trim();
      const apiKey = parts.slice(1).join("|").trim();
      if (!email || !apiKey) return null;
      return { email, apiKey, raw: line.trim(), line: i + 1 };
    })
    .filter(Boolean);
}

function appendUniqueLine(file, line) {
  const target = line.trim();
  if (readLines(file).some((existing) => existing.trim() === target)) {
    return false;
  }
  fs.appendFileSync(file, `${target}\n`);
  return true;
}

function removeLine(file, raw) {
  if (!fs.existsSync(file)) return false;
  const target = raw.trim();
  const lines = readLines(file);
  const filtered = lines.filter((line) => line.trim() !== target);
  if (filtered.length === lines.length) return false;
  writeLines(file, filtered);
  return true;
}

function writeLines(file, lines) {
  fs.writeFileSync(file, lines.length ? `${lines.join("\n")}\n` : "");
}

module.exports = {
  readLines,
  readAccounts,
  readEmailSet,
  readKeyPairs,
  appendUniqueLine,
  removeLine,
  writeLines,
};
