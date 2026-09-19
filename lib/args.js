"use strict";

/**
 * Minimal CLI flag parser.
 *
 *   --flag            -> boolean (has("flag") === true)
 *   --name=value      -> string  (get("name") === "value")
 */

function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set();
  const values = {};

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) flags.add(body);
    else values[body.slice(0, eq)] = body.slice(eq + 1);
  }

  return {
    has: (name) => flags.has(name),
    get: (name, fallback = null) =>
      Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : fallback,
    int: (name, fallback = 0) => {
      const parsed = parseInt(values[name], 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    raw: argv,
  };
}

module.exports = { parseArgs };
