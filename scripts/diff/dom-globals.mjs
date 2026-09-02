/**
 * dom-globals.mjs — a global jsdom window/document for the Node parity harness.
 *
 * Block modules under blocks/ import scripts/aem.js, which references `window` at module-eval
 * time. To import a block's exported JIT payload deriver (faqTogglePayload, navArrowPayload, …)
 * into parity-gate, a global window/document must exist BEFORE those imports evaluate — so this
 * module is imported FIRST and installs them as a side effect (mirrors the vitest jsdom env the
 * block tests run in). It also exports `document` so the harness uses this one instance.
 */
/* eslint-disable import/extensions, import/no-extraneous-dependencies */
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><head></head><body></body></html>');
if (!global.window) global.window = window;
if (!global.document) global.document = window.document;

export default window.document;
