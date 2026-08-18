/**
 * scripts/diff/capture-html.mjs
 *
 * Shared prod-capture for the click-tracking tools (extract-tracking.mjs,
 * clicktrack-diff.mjs). Reuses live-session.mjs's hardened navigation (the same
 * Akamai/Cloudflare bot-management ladder appvars-diff / martech-diff use) and
 * returns the fully-rendered HTML, which the callers parse with jsdom and feed
 * to the unit-tested tracking modules — so the tracker replica and derive logic
 * stay single-sourced instead of being re-implemented inside page.evaluate.
 */

/* eslint-disable import/no-extraneous-dependencies, import/extensions, import/prefer-default-export, max-len */

import { newLiveContext, gotoLive, dismissOverlays } from './live-session.mjs';

/**
 * Load `url` and return its rendered HTML, or throw the live-session error
 * (BotChallengeError / LiveHTTPError / timeout) so callers can report honestly.
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {{settleMs?: number, headed?: boolean}} [opts]
 * @returns {Promise<string>}
 */
export async function captureHtml(browser, url, { settleMs = 1500, headed = false } = {}) {
  const context = await newLiveContext(browser, {});
  try {
    const pg = await context.newPage();
    const resp = await gotoLive(pg, url, {
      waitUntil: 'domcontentloaded', timeoutMs: 45000, settleMs: 0, httpError: 'measure', solveWindow: headed,
    });
    if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()} (page not deployed?)`);
    await dismissOverlays(pg).catch(() => {});
    await pg.waitForTimeout(settleMs);
    return await pg.content();
  } finally {
    await context.close().catch(() => {});
  }
}
