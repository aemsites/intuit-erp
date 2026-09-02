import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const headMarkup = readFileSync('head.html', 'utf8');

describe('head scripts', () => {
  it('loads ERP logging without blocking HTML parsing', () => {
    const head = document.createElement('head');
    head.innerHTML = headMarkup;
    const loggingScript = head.querySelector('script[src="/scripts/erp-logging.js"]');

    expect(loggingScript).not.toBeNull();
    expect(loggingScript.defer).toBe(true);
    expect(loggingScript.hasAttribute('async')).toBe(false);
  });
});
