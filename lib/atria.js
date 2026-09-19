"use strict";

const config = require("./config");
const logger = require("./logger");
const {
  sleep,
  launchBrowser,
  grantClipboard,
  isVisible,
  clickButtonByText,
  typeInto,
  clickOrEnter,
  dismissBubbles,
  removeProfileDir,
} = require("./browser");
const {
  detectGoogleBlock,
  waitForGooglePage,
  completeGoogleLogin,
} = require("./google");

const CONSOLE_KEYS_URL = config.consoleKeysUrl;
const CONSOLE_ORIGIN = config.consoleOrigin;

const EMAIL_SELECTORS = [
  'input[type="email"]',
  "#identifierId",
  'input[name="identifier"]',
];
const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="Passwd"]',
];

// Tracks the browser currently owned by createAtriaKey so a SIGINT can close it.
let activeBrowser = null;

function closeActiveBrowser() {
  if (!activeBrowser) return;
  try {
    activeBrowser.close().catch(() => {});
  } catch (e) {}
  activeBrowser = null;
}

function isValidApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return false;
  if (/\s/.test(apiKey)) return false;
  return (
    /^atr_[A-Za-z0-9_-]{10,}$/.test(apiKey) ||
    /^(sk-|key-)[A-Za-z0-9_-]{16,}$/.test(apiKey)
  );
}

/* ------------------------------------------------------------------ */
/* Atria console key flow                                              */
/* ------------------------------------------------------------------ */

async function openCreateKey(page) {
  let clicked = await clickButtonByText(
    page,
    ["Create key", "Create Key", "Create API key", "New key"],
    15000,
    ["Create account"],
  );
  if (clicked) return true;
  clicked = await clickButtonByText(page, ["Create"], 6000, [
    "Create account",
  ]);
  return clicked;
}

async function findKeyNameInput(page) {
  const handles = await page.$$(
    'input[type="text"], input:not([type]), input[type="search"], textarea',
  );
  const visible = [];
  for (const h of handles) {
    if (await isVisible(h)) visible.push(h);
  }
  if (visible.length === 0) return null;

  let best = null;
  let bestScore = -1;
  for (const h of visible) {
    const meta = await page.evaluate((el) => {
      const ph = (el.placeholder || "").toLowerCase();
      const name = (el.name || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const label = (el.labels && el.labels[0] ? el.labels[0].innerText : "")
        .toLowerCase()
        .trim();
      const inDialog = !!el.closest(
        '[role="dialog"], [class*="modal" i], [class*="dialog" i]',
      );
      return { ph, name, aria, label, inDialog };
    }, h);
    let score = 0;
    if (meta.ph.includes("name")) score += 5;
    if (meta.name.includes("name")) score += 4;
    if (meta.aria.includes("name")) score += 4;
    if (meta.label.includes("name")) score += 4;
    if (meta.inDialog) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

async function fillKeyName(page, name) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const input = await findKeyNameInput(page);
    if (input) {
      await input.click({ clickCount: 3 }).catch(() => {});
      await input.type(name, { delay: 25 });
      return true;
    }
    await sleep(400);
  }
  return false;
}

async function submitCreateKey(page) {
  const dialog = '[role="dialog"], [class*="modal" i], [class*="dialog" i]';
  const clicked = await clickButtonByText(
    page,
    ["Create key", "Create", "Generate", "Confirm", "Save"],
    8000,
    ["Cancel", "Create account"],
    dialog,
  );
  if (clicked) return true;
  return await clickButtonByText(
    page,
    ["Create", "Generate", "Confirm", "Save"],
    5000,
    ["Cancel", "Create account"],
  );
}

function findKeyInObject(obj, depth = 0) {
  if (depth > 6 || obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findKeyInObject(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (
      typeof v === "string" &&
      /^(api[_-]?key|secret|token|key)$/i.test(k) &&
      v.length >= 16
    ) {
      return v;
    }
  }
  for (const v of Object.values(obj)) {
    const found = findKeyInObject(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function attachKeyCapture(page) {
  const ref = { value: null };
  const handler = async (response) => {
    if (ref.value) return;
    try {
      const request = response.request();
      if (request.method() !== "POST") return;
      const contentType = (
        response.headers()["content-type"] || ""
      ).toLowerCase();
      if (!contentType.includes("json") && !contentType.includes("text")) {
        return;
      }
      const text = await response.text();
      let found = null;
      try {
        found = findKeyInObject(JSON.parse(text));
      } catch (e) {
        const m = text.match(/(?:sk-|atria-|key-)[A-Za-z0-9_\-]{16,}/);
        if (m) found = m[0];
      }
      if (found && found.length >= 16) ref.value = found;
    } catch (e) {
      // ignore malformed responses
    }
  };
  page.on("response", handler);
  return {
    ref,
    detach: () => {
      try {
        page.off("response", handler);
      } catch (e) {}
    },
  };
}

async function readClipboardText(page) {
  try {
    await page.bringToFront();
    const text = await page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch (e) {
        return "";
      }
    });
    return (text || "").trim();
  } catch (e) {
    return "";
  }
}

async function scrapeKeyFromDom(page) {
  try {
    return await page.evaluate(() => {
      const looks = (s) => {
        if (!s) return false;
        const v = s.trim();
        if (v.length < 20 || /\s/.test(v)) return false;
        return /[A-Za-z]/.test(v) && /[0-9]/.test(v);
      };
      const candidates = [];
      document
        .querySelectorAll(
          'input[readonly], textarea[readonly], input[type="text"], code, pre, [class*="key" i]',
        )
        .forEach((el) => {
          const v = el.value || el.textContent || "";
          if (v) candidates.push(v.trim());
        });
      const body = document.body ? document.body.innerText : "";
      const matches = body.match(/(?:sk-|atria-|key-)[A-Za-z0-9_\-]{16,}/g);
      if (matches) candidates.push(...matches);
      return candidates.find(looks) || "";
    });
  } catch (e) {
    return "";
  }
}

async function readApiKey(page, capturedRef) {
  if (capturedRef && capturedRef.value) return capturedRef.value;

  const copied = await clickButtonByText(page, ["Copy"], 6000, ["Copy all"]);
  if (copied) {
    await sleep(600);
    const clip = await readClipboardText(page);
    if (clip && clip.length >= 12) return clip;
  }

  const dom = await scrapeKeyFromDom(page);
  if (dom) return dom;

  return capturedRef && capturedRef.value ? capturedRef.value : "";
}

async function clickSavedMyKey(page) {
  return await clickButtonByText(
    page,
    [
      "I've saved my key",
      "I have saved my key",
      "I saved my key",
      "I've saved",
      "Saved my key",
    ],
    8000,
  );
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

async function createAtriaKey(account, options = {}) {
  const { index = 1, total = 1 } = options;
  const { email, password } = account;

  let browser;
  let profileDir;
  try {
    logger.step("Launching browser...");
    const launched = await launchBrowser();
    browser = launched.browser;
    activeBrowser = browser;
    profileDir = launched.userDataDir;
    await grantClipboard(browser, CONSOLE_ORIGIN);

    const page = await browser.newPage();

    // The console is the real entry point: opening it while logged out
    // redirects to the Logto sign-in page with a valid interaction session.
    logger.step(`Navigating to console (will redirect to sign-in)...`);
    await page.goto(CONSOLE_KEYS_URL, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });
    await sleep(2500);

    logger.step('Clicking "Continue with Google"...');
    const clickedGoogle = await clickButtonByText(
      page,
      [
        "Continue with Google",
        "Lanjutkan dengan Google",
        "Sign in with Google",
        "Google",
      ],
      20000,
    );
    if (!clickedGoogle) {
      throw new Error('Could not find "Continue with Google" button.');
    }
    await sleep(2000);

    logger.step("Waiting for Google OAuth page...");
    const googlePage = await waitForGooglePage(browser, page, 25000);
    if (!googlePage) {
      throw new Error("Google OAuth page did not open within 25 seconds.");
    }
    await googlePage.bringToFront();

    logger.step(`Typing email: ${email}`);
    const emailInput = await typeInto(googlePage, EMAIL_SELECTORS, email, 25000);
    if (!emailInput) throw new Error("Google email input not found.");

    logger.step("Clicking Next (email)...");
    await clickOrEnter(googlePage, "#identifierNext", ["Next", "Berikutnya"]);

    await sleep(2500);
    const emailErr = await detectGoogleBlock(googlePage);
    if (emailErr) throw new Error(`Google Email Error: ${emailErr}`);

    logger.step("Waiting for password input...");
    const passInput = await typeInto(
      googlePage,
      PASSWORD_SELECTORS,
      password,
      30000,
    );
    if (!passInput) throw new Error("Google password input not found.");
    await sleep(800);

    logger.step("Clicking Next (password)...");
    await clickOrEnter(googlePage, "#passwordNext", ["Next", "Berikutnya"]);
    await sleep(2500);
    await dismissBubbles(googlePage);

    logger.step("Processing post-password / consent steps...");
    const atriaPage = await completeGoogleLogin(browser, googlePage, 90000);
    logger.step(`Login completed. URL: ${atriaPage.url()}`);
    await dismissBubbles(atriaPage);

    logger.step("Navigating to API Keys page...");
    await atriaPage.goto(CONSOLE_KEYS_URL, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });
    await sleep(3000);
    if (atriaPage.url().includes("sign-in")) {
      throw new Error(
        "Still on sign-in after OAuth; session was not established.",
      );
    }

    logger.step('Clicking "Create key"...');
    const capture = attachKeyCapture(atriaPage);
    const opened = await openCreateKey(atriaPage);
    if (!opened) throw new Error('Could not find "Create key" button.');
    await sleep(1500);

    logger.step(`Filling key name: ${email}`);
    const filled = await fillKeyName(atriaPage, email);
    if (!filled) throw new Error('Could not find "Key name" input.');

    logger.step("Submitting create key...");
    const submitted = await submitCreateKey(atriaPage);
    if (!submitted) {
      logger.step("No submit button found, pressing Enter...");
      await atriaPage.keyboard.press("Enter").catch(() => {});
    }
    await sleep(3000);

    logger.step("Reading generated API key...");
    const apiKey = await readApiKey(atriaPage, capture.ref);
    capture.detach();

    await clickSavedMyKey(atriaPage).catch(() => {});
    await sleep(800);

    if (!apiKey || apiKey.length < 12) {
      throw new Error("Created key but could not read the API key value.");
    }

    return { apiKey };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    activeBrowser = null;
    removeProfileDir(profileDir);
  }
}

module.exports = {
  createAtriaKey,
  isValidApiKey,
  closeActiveBrowser,
};
