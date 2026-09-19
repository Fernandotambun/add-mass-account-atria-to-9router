"use strict";

const { sleep, clickButtonByText } = require("./browser");

async function detectGoogleBlock(page) {
  if (page.isClosed()) return null;
  try {
    const pageText = await page.evaluate(() =>
      document.body ? document.body.innerText : "",
    );
    const errorKeywords = [
      "Verify it's you",
      "2-Step Verification",
      "Check your phone",
      "Couldn't sign you in",
      "Wrong password",
      "Enter a phone number",
      "Confirm your recovery email",
      "This browser or app may not be secure",
      "Suspicious activity",
      "That\u2019s an error",
      "There was an error",
    ];
    for (const kw of errorKeywords) {
      if (pageText.toLowerCase().includes(kw.toLowerCase())) return kw;
    }
  } catch (e) {
    // Page might be navigating
  }
  return null;
}

async function waitForGooglePage(browser, originalPage, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (
        !originalPage.isClosed() &&
        originalPage.url().includes("accounts.google.com")
      ) {
        return originalPage;
      }
    } catch (e) {}
    const pages = await browser.pages();
    for (const p of pages) {
      try {
        if (p.url().includes("accounts.google.com")) return p;
      } catch (e) {}
    }
    await sleep(500);
  }
  return null;
}

// The app lives on api.atria-asi.ai. auth.atria-asi.ai is the Logto host
// (sign-in + /callback/...), which is blank for a moment while it exchanges
// the OAuth code, so it must not be treated as login complete.
function isAtriaAppUrl(url) {
  return (
    url.includes("atria-asi.ai") &&
    !url.includes("accounts.google.com") &&
    !url.includes("auth.atria-asi.ai")
  );
}

async function findAtriaPage(browser) {
  const pages = await browser.pages();
  for (const p of pages) {
    try {
      if (isAtriaAppUrl(p.url())) return p;
    } catch (e) {}
  }
  return null;
}

async function completeGoogleLogin(browser, googlePage, timeoutMs = 90000) {
  const start = Date.now();
  let lastLogged = "";
  while (Date.now() - start < timeoutMs) {
    if (!googlePage.isClosed()) {
      let url = "";
      try {
        url = googlePage.url();
      } catch (e) {}
      if (url && url !== lastLogged) {
        lastLogged = url;
      }
      if (isAtriaAppUrl(url)) return googlePage;

      const err = await detectGoogleBlock(googlePage);
      if (err) {
        throw new Error(`Google Login Verification/Error required: "${err}"`);
      }

      try {
        const el = await googlePage.$("#gaplustosNext");
        if (el) {
          await el.click();
          await sleep(2000);
          continue;
        }
      } catch (e) {}

      try {
        const el = await googlePage.$("#submit_approve_access");
        if (el) {
          await el.click();
          await sleep(2000);
          continue;
        }
      } catch (e) {}

      const clicked = await clickButtonByText(
        googlePage,
        [
          "I understand",
          "Saya mengerti",
          "Continue",
          "Allow",
          "Izinkan",
          "Lanjutkan",
        ],
        1500,
      );
      if (clicked) {
        await sleep(2000);
        continue;
      }
    }

    const atria = await findAtriaPage(browser);
    if (atria) return atria;

    await sleep(1000);
  }
  throw new Error("Google login did not complete within the timeout.");
}

module.exports = {
  detectGoogleBlock,
  waitForGooglePage,
  isAtriaAppUrl,
  findAtriaPage,
  completeGoogleLogin,
};
