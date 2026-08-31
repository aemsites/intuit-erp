#!/usr/bin/env node
/**
 * Read-only authenticated stage inventory for complete customer-golden replay.
 * It never clicks, fills forms, reads storage, or captures DOM snapshots.
 */
/* eslint-disable import/no-extraneous-dependencies, import/extensions, no-console, no-restricted-syntax, no-await-in-loop, no-plusplus, max-len, no-continue, no-underscore-dangle, no-nested-ternary */
import { chromium } from 'playwright';
import {
  chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCdpEndpoint } from './live-replay-harness.mjs';
import { createTargetGuard } from './live-replay-runner.mjs';
import { validateGoldenReplayManifest } from './golden-replay-manifest.mjs';

const EXACT_ORIGIN = 'https://stage.erp.intuit.com';
const DEFAULT_CDP = 'http://127.0.0.1:9339';
const DEFAULT_GOLDEN = 'scripts/diff/fixtures/local/clicktrack-golden-customer.json';
const DEFAULT_LOCK = '.jig/click-tracking-harness/evidence/customer-golden-identity-lock.json';
const DEFAULT_MANIFEST = 'scripts/diff/fixtures/local/clicktrack-golden-replay-manifest.json';
const DEFAULT_OUT = 'scripts/diff/fixtures/local/clicktrack-golden-stage-inventory.json';
const ALLOWED_RESOURCE = /(?:\.js|\.plain\.html|query-index\.json|tracking\.json)$/;

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const normalize = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
const safeError = (value) => [...String(value || 'unknown error')].map((character) => {
  const code = character.codePointAt(0);
  return code <= 31 || (code >= 127 && code <= 159) || /\p{Bidi_Control}/u.test(character) ? '?' : character;
}).join('').replace(/([?#]).*$/, '');

export function safeInventoryResourceUrl(value, origin = EXACT_ORIGIN) {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !ALLOWED_RESOURCE.test(url.pathname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function safeHref(value) {
  if (!value) return '';
  try {
    const url = new URL(value, EXACT_ORIGIN);
    if (url.hostname === 'erp.intuit.com' || url.hostname === 'stage.erp.intuit.com') {
      return `site:${url.pathname}`;
    }
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

function expectedBlocks(scenario) {
  return (scenario.runtimeAssets || []).map((path) => path.match(/\/blocks\/([^/]+)\//)?.[1]).filter(Boolean);
}

const LOCATOR_SHEET_COLUMNS = [
  'object', 'object-detail', 'action', 'ui-object', 'ui-object-detail',
  'ui-action', 'access-point', 'ui-access-point', 'wa-link',
];

function normalizeSheetPath(value) {
  const path = String(value || '').trim();
  if (!path || path === '*') return '*';
  return `/${path.replace(/^\/+|\/+$/g, '')}`;
}

export function indexTrackingSheet(rows) {
  const index = new Map();
  for (const row of rows || []) {
    const id = String(row.id ?? row.key ?? '').trim();
    if (!id) continue;
    const residue = Object.fromEntries(LOCATOR_SHEET_COLUMNS
      .map((column) => [column, String(row[column] ?? '').trim()])
      .filter(([, value]) => value));
    if (!Object.keys(residue).length) continue;
    const path = normalizeSheetPath(row.path);
    index.set(path === '*' ? id : `${path}|${id}`, residue);
  }
  return index;
}

function sheetResidueFor(index, page, id) {
  if (!index || !id) return null;
  const pathname = normalizeSheetPath(page);
  return index.get(`${pathname}|${id}`) || index.get(id) || null;
}

function scoreCandidate(scenario, candidate) {
  if (!candidate.visible) return -Infinity;
  const target = scenario.targetSignature || {};
  let score = 0;
  const reasons = [];
  if (target.region && target.region === candidate.region) { score += 12; reasons.push('region'); } else if (target.region) score -= 20;
  if (target.waLink) {
    const candidateWaLink = candidate.sheetResidue?.['wa-link'] || candidate.waLink;
    if (target.waLink === candidateWaLink) {
      score += 80;
      reasons.push(candidate.sheetResidue?.['wa-link'] ? 'wa-link-sheet' : 'wa-link-dom');
    } else score -= 25;
  }
  const wantedName = normalize(target.uiObjectDetail);
  const actualName = normalize(candidate.accessibleName);
  const alias = normalize(wantedName.includes('|') ? wantedName.split('|').pop() : wantedName);
  if (wantedName && actualName === wantedName) { score += 50; reasons.push('name-exact'); } else if (alias && actualName === alias) { score += 42; reasons.push('name-alias'); } else if (alias && (actualName.includes(alias) || alias.includes(actualName)) && actualName.length > 1) {
    score += 22; reasons.push('name-partial');
  }
  const wantedHref = safeHref(target.href);
  if (wantedHref && wantedHref !== 'site:/') {
    if (safeHref(candidate.href) === wantedHref) { score += 40; reasons.push('href'); } else score -= 12;
  }
  const blocks = expectedBlocks(scenario);
  if (blocks.includes(candidate.block)) { score += 25; reasons.push('block'); }
  const uiObject = normalize(target.uiObject);
  if ((uiObject === 'button' || uiObject.startsWith('accordion item'))
    && (candidate.tag === 'BUTTON' || candidate.role === 'button' || candidate.tag === 'SUMMARY')) {
    score += 5;
    reasons.push('role');
  }
  return { score, reasons };
}

export function matchScenarioToInventory(scenario, candidates, { trackingSheet } = {}) {
  if (scenario.classification?.interaction === 'passive') return { status: 'passive', candidates: [] };
  const ranked = candidates.map((candidate) => {
    const sheetResidue = sheetResidueFor(trackingSheet, scenario.page, candidate.dataTrackId);
    const resolved = sheetResidue ? { ...candidate, sheetResidue } : candidate;
    return { candidate: resolved, ...scoreCandidate(scenario, resolved) };
  })
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => right.score - left.score || left.candidate.candidateId.localeCompare(right.candidate.candidateId));
  const eligible = ranked.filter(({ score }) => score >= 30);
  if (!eligible.length) return { status: 'missing', candidates: ranked };
  const best = eligible[0].score;
  const tied = eligible.filter(({ score }) => score === best);
  if (tied.length !== 1) return { status: 'ambiguous', candidates: ranked };
  return { status: 'proposed', candidate: tied[0].candidate, candidates: ranked };
}

export function summarizeStageInventory(inventory) {
  const summary = {
    total: 0, proposed: 0, ambiguous: 0, missing: 0, passive: 0, blocked: 0,
  };
  for (const page of inventory.pages || []) {
    if (page.status === 'blocked') {
      const count = (page.expectedScenarioIds || []).length;
      summary.total += count;
      summary.blocked += count;
      continue;
    }
    for (const match of page.matches || []) {
      summary.total += 1;
      if (Object.hasOwn(summary, match.status)) summary[match.status] += 1;
    }
  }
  return summary;
}

export async function retryTransientInventoryPage(task) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      const retryable = /fetch failed|page readiness failed|timeout|net::err_/i.test(error.message);
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw lastError;
}

function parseArgs(argv) {
  const options = {
    cdp: DEFAULT_CDP,
    origin: EXACT_ORIGIN,
    golden: DEFAULT_GOLDEN,
    identityLock: DEFAULT_LOCK,
    manifest: DEFAULT_MANIFEST,
    out: DEFAULT_OUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cdp') options.cdp = argv[++index];
    else if (argument === '--origin') options.origin = argv[++index];
    else if (argument === '--golden') options.golden = argv[++index];
    else if (argument === '--identity-lock') options.identityLock = argv[++index];
    else if (argument === '--manifest') options.manifest = argv[++index];
    else if (argument === '--out') options.out = argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

function selectPage(context, origin) {
  const pages = context.pages();
  if (pages.length !== 1) throw new Error(`dedicated CDP expected exactly one target, got ${pages.length}`);
  let url;
  try { url = new URL(pages[0].url()); } catch { throw new Error('bound target URL is invalid'); }
  if (url.origin !== origin) throw new Error(`bound target must use exact origin ${origin}`);
  return pages[0];
}

async function hashUrl(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`runtime asset ${url} returned ${response.status}`);
  return sha256(Buffer.from(await response.arrayBuffer()));
}

export async function captureDocumentBody(response) {
  if (!response) throw new Error('navigation response body is unavailable');
  try {
    return await response.body();
  } catch (error) {
    throw new Error(`navigation response body is unavailable: ${error.message}`);
  }
}

async function collectPageEvidence(page, origin) {
  return page.evaluate((expectedOrigin) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    const cleanHref = (value) => {
      if (!value) return '';
      try { const url = new URL(value, expectedOrigin); return `${url.origin}${url.pathname}`; } catch { return ''; }
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && Number(style.opacity) !== 0;
    };
    const blockName = (element) => {
      const block = element.closest('.block');
      return [...(block?.classList || [])].find((name) => name !== 'block' && !name.endsWith('-block')) || '';
    };
    const region = (element) => {
      if (element.closest('header, nav')) return 'header';
      if (element.closest('footer')) return 'footer';
      if (element.closest('#contact-us, .contact-us, [class*="talk-to-sales"]')) return 'widget';
      return 'main';
    };
    const selector = 'a,button,summary,[role="button"],[data-track-id],[data-track-as]';
    const elements = [...new Set(document.querySelectorAll(selector))];
    const candidates = elements.map((element, index) => ({
      candidateId: `dom-${String(index + 1).padStart(4, '0')}`,
      tag: element.tagName,
      role: element.getAttribute('role') || (element.tagName === 'A' ? 'link' : element.tagName === 'BUTTON' || element.tagName === 'SUMMARY' ? 'button' : ''),
      region: region(element),
      accessibleName: clean(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent),
      dataTrackId: clean(element.getAttribute('data-track-id')),
      trackAs: clean(element.getAttribute('data-track-as')),
      waLink: clean(element.getAttribute('data-wa-link')),
      href: cleanHref(element.getAttribute('href')),
      block: blockName(element),
      heading: clean(element.closest('section')?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent),
      ariaExpanded: element.getAttribute('aria-expanded'),
      visible: visible(element),
    }));
    const scriptUrls = [...document.scripts].map((script) => script.src).filter(Boolean);
    const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const loginUi = Boolean(document.querySelector('input[type="password"], form[action*="login" i], [data-testid*="login" i]'));
    const consentBanner = Boolean(document.querySelector('#onetrust-banner-sdk:not([style*="display: none"])'));
    return {
      origin: window.location.origin,
      pathname: window.location.pathname,
      title: document.title,
      authenticated: !loginUi,
      consentState: (typeof window.OneTrust === 'object' || typeof window.OneTrust === 'function') && !consentBanner ? 'resolved' : 'unresolved',
      utagReady: typeof window.utag === 'object',
      trackerReady: typeof window.intuit?.tracking?.ecs?.webAnalytics?.track === 'function',
      enqueueReady: typeof window.intuit?.tracking?.ecs?.analytics?._dispatch === 'function',
      pageCasId: window.appVars?.externalContentIdentifier || '',
      candidates,
      resourceUrls: [...new Set([...scriptUrls, ...resourceUrls])],
    };
  }, origin);
}

async function preloadReadOnly(page) {
  await page.evaluate(async () => {
    const delay = (milliseconds) => new Promise((accept) => { setTimeout(accept, milliseconds); });
    let lastHeight = 0;
    for (let step = 1; step <= 12; step += 1) {
      window.scrollTo(0, (step / 12) * document.body.scrollHeight);
      await delay(180);
      if (step >= 6 && document.body.scrollHeight === lastHeight) break;
      lastHeight = document.body.scrollHeight;
    }
    window.scrollTo(0, 0);
    await delay(250);
  });
}

function writeInventory(path, inventory) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  chmodSync(target, 0o600);
}

async function run(options) {
  if (options.origin !== EXACT_ORIGIN) throw new Error(`exact stage origin is required: ${EXACT_ORIGIN}`);
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'));
  const golden = JSON.parse(readFileSync(options.golden, 'utf8'));
  const identityLock = JSON.parse(readFileSync(options.identityLock, 'utf8'));
  validateGoldenReplayManifest(manifest, golden, identityLock);
  const endpoint = validateCdpEndpoint(options.cdp);
  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  if (contexts.length !== 1) throw new Error(`dedicated CDP expected one context, got ${contexts.length}`);
  const context = contexts[0];
  const page = selectPage(context, options.origin);
  const guard = createTargetGuard(page, options.origin);
  const onPage = (candidate) => guard.observePage(candidate);
  const onNavigation = (frame) => { if (frame === page.mainFrame()) guard.observeNavigation(frame.url()); };
  const onClose = () => guard.observeClose();
  context.on('page', onPage);
  page.on('framenavigated', onNavigation);
  page.on('close', onClose);
  const cdp = await context.newCDPSession(page);
  const targetInfo = await cdp.send('Target.getTargetInfo');
  await cdp.detach();
  const inventory = {
    schemaVersion: 1,
    source: 'authenticated-stage-locator-inventory',
    capturedAt: new Date().toISOString(),
    manifest: {
      schemaVersion: manifest.schemaVersion,
      contentHash: manifest.manifestContentHash,
      mappingHash: manifest.goldenMappingHash,
    },
    browser: { name: 'Chrome', version: await browser.version(), targetId: targetInfo.targetInfo.targetId },
    origin: options.origin,
    viewport: { width: 1728, height: 640 },
    pages: [],
  };
  try {
    await page.setViewportSize(inventory.viewport);
    for (const manifestPage of manifest.pages) {
      const pageScenarios = manifest.scenarios.filter(({ page: pathname }) => pathname === manifestPage.pathname);
      try {
        const result = await retryTransientInventoryPage(async (attempt) => {
          if (attempt > 1) await page.waitForTimeout(500);
          const response = await page.goto(`${options.origin}${manifestPage.pathname}`, { waitUntil: 'domcontentloaded' });
          const documentBody = await captureDocumentBody(response, page);
          context.pages().forEach((candidate) => guard.observePage(candidate));
          guard.assert();
          await page.waitForFunction(() => {
            const ecs = window.intuit?.tracking?.ecs;
            return typeof window.utag === 'object' && typeof ecs?.webAnalytics?.track === 'function'
              && typeof ecs?.analytics?._dispatch === 'function';
          }, null, { timeout: 30000 });
          await preloadReadOnly(page);
          const evidence = await collectPageEvidence(page, options.origin);
          if (evidence.origin !== options.origin || evidence.pathname !== manifestPage.pathname
            || !evidence.authenticated || evidence.consentState !== 'resolved'
            || !evidence.utagReady || !evidence.trackerReady || !evidence.enqueueReady) {
            throw new Error('page readiness failed');
          }
          const explicitResources = manifestPage.runtimeAssets.map((path) => new URL(path, options.origin).href);
          const resources = [...new Set([...evidence.resourceUrls, ...explicitResources]
            .map((url) => safeInventoryResourceUrl(url, options.origin)).filter(Boolean))].sort();
          const runtimeHashes = Object.fromEntries(await Promise.all(resources.map(async (url) => [url, await hashUrl(url)])));
          const documentHash = sha256(documentBody);
          return {
            pathname: manifestPage.pathname,
            status: 'inventoried',
            expectedScenarioIds: manifestPage.expectedScenarioIds,
            pageCasId: evidence.pageCasId,
            pageCasIdPass: evidence.pageCasId === manifestPage.pathname,
            documentHash,
            runtimeHashes,
            candidates: evidence.candidates,
            matches: pageScenarios.map((scenario) => ({
              scenarioId: scenario.scenarioId,
              ...matchScenarioToInventory(scenario, evidence.candidates),
            })),
          };
        });
        inventory.pages.push(result);
      } catch (error) {
        inventory.pages.push({
          pathname: manifestPage.pathname,
          status: 'blocked',
          expectedScenarioIds: manifestPage.expectedScenarioIds,
          reason: safeError(error.message),
        });
      }
      inventory.summary = summarizeStageInventory(inventory);
      writeInventory(options.out, inventory);
    }
    guard.assert();
    inventory.completedAt = new Date().toISOString();
    inventory.summary = summarizeStageInventory(inventory);
    writeInventory(options.out, inventory);
    console.log(JSON.stringify({ output: options.out, pages: inventory.pages.length, summary: inventory.summary }, null, 2));
  } finally {
    context.off('page', onPage);
    page.off('framenavigated', onNavigation);
    page.off('close', onClose);
    await browser.close().catch(() => {});
  }
  return inventory;
}

export async function main(argv = process.argv.slice(2)) {
  return run(parseArgs(argv));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ verdict: 'REFUSED', error: safeError(error.message) }, null, 2));
    process.exitCode = 1;
  });
}
