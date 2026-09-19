"use strict";

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const os = require("os");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome's native "Sign in to Chromium" bubble and password-save prompts are
// browser UI (not page DOM), so Puppeteer cannot dismiss them. Suppress them
// with Chrome preferences written into a throwaway profile per account.
function createProfileDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atria-profile-"));
  const defaultProfile = path.join(dir, "Default");
  fs.mkdirSync(defaultProfile, { recursive: true });
  const prefs = {
    credentials_enable_service: false,
    profile: {
      password_manager_enabled: false,
      password_manager_leak_detection: false,
    },
    signin: { allowed: false },
    autofill: { profile_enabled: false, credit_card_enabled: false },
  };
  fs.writeFileSync(
    path.join(defaultProfile, "Preferences"),
    JSON.stringify(prefs),
  );
  return dir;
}

function removeProfileDir(dir) {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // best effort
  }
}

async function launchBrowser() {
  const userDataDir = createProfileDir();
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    userDataDir,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-save-password-bubble",
      "--disable-features=SigninPromo,SignInProfileCreation,ChromeSignin,PasswordManagerOnboarding,AutofillServerCommunication,PasswordLeakDetection,OptimizationHints",
    ],
  });
  return { browser, userDataDir };
}

async function grantClipboard(browser, origin) {
  try {
    await browser
      .defaultBrowserContext()
      .overridePermissions(origin, ["clipboard-read", "clipboard-write"]);
  } catch (e) {
    // permission override is best effort
  }
}

async function isVisible(handle) {
  try {
    return await handle.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        rect.width > 0 &&
        rect.height > 0
      );
    });
  } catch (e) {
    return false;
  }
}

async function clickButtonByText(
  page,
  textSubstrings,
  timeoutMs = 10000,
  excludeSubstrings = [],
  withinSelector = null,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return false;
    try {
      const selector = withinSelector
        ? `${withinSelector} button, ${withinSelector} a[role="button"], ${withinSelector} div[role="button"], ${withinSelector} input[type="submit"], ${withinSelector} a[href]`
        : 'button, a[role="button"], div[role="button"], input[type="submit"], a[href]';
      const buttons = await page.$$(selector);
      for (const btn of buttons) {
        if (!(await isVisible(btn))) continue;
        const text = await page.evaluate(
          (el) =>
            el.innerText ||
            el.textContent ||
            el.value ||
            (el.getAttribute ? el.getAttribute("aria-label") : "") ||
            "",
          btn,
        );
        if (
          text &&
          textSubstrings.some((sub) =>
            text.toLowerCase().includes(sub.toLowerCase()),
          ) &&
          !excludeSubstrings.some((ex) =>
            text.toLowerCase().includes(ex.toLowerCase()),
          )
        ) {
          await btn.click();
          return true;
        }
      }
    } catch (e) {
      // Element might have detached or tab closed
    }
    await sleep(500);
  }
  return false;
}

async function typeInto(page, selectors, text, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      const el = await page.$(sel).catch(() => null);
      if (el && (await isVisible(el))) {
        await el.click({ clickCount: 3 }).catch(() => {});
        await el.type(text, { delay: 25 });
        return el;
      }
    }
    await sleep(300);
  }
  return null;
}

async function clickOrEnter(page, selector, texts) {
  try {
    const el = await page.$(selector);
    if (el && (await isVisible(el))) {
      await el.click();
      return true;
    }
  } catch (e) {
    // fall through to text/Enter
  }
  const clicked = await clickButtonByText(page, texts, 5000);
  if (clicked) return true;
  await page.keyboard.press("Enter").catch(() => {});
  return false;
}

// Press Escape a couple of times to dismiss native Chrome bubbles
// (password save / "Sign in to Chromium") that can overlay the page.
async function dismissBubbles(page) {
  try {
    await page.bringToFront();
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(150);
    await page.keyboard.press("Escape").catch(() => {});
  } catch (e) {
    // ignore
  }
}

module.exports = {
  sleep,
  createProfileDir,
  removeProfileDir,
  launchBrowser,
  grantClipboard,
  isVisible,
  clickButtonByText,
  typeInto,
  clickOrEnter,
  dismissBubbles,
};
