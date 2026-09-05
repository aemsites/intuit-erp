import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const eagerStyles = readFileSync('styles/styles.css', 'utf8');

describe('third-party mobile CLS guards', () => {
  it('gives the active 1Mind launcher its settled mobile shell dimensions', () => {
    const mobileRule = eagerStyles.match(
      /@media \(width < 768px\)\s*{[\s\S]*?html\.onemind-active #onemind-widget\s*{([^}]*)}/,
    );

    expect(mobileRule).toBeTruthy();
    expect(mobileRule[1]).toContain('width: 214px !important;');
    expect(mobileRule[1]).toContain('height: 90px !important;');
    expect(mobileRule[1]).toContain('right: 12px !important;');
    expect(mobileRule[1]).toContain('bottom: 12px !important;');
    expect(mobileRule[1]).toContain('visibility: hidden !important;');
    expect(eagerStyles).toMatch(
      /html\.onemind-active\.onemind-ready #onemind-widget\s*{[^}]*visibility: visible !important;/,
    );
  });

  it('keeps OneTrust banner text on the eager no-swap fallback stack', () => {
    const consentRule = eagerStyles.match(
      /@media \(width < 768px\)\s*{\s*#onetrust-banner-sdk,\s*#onetrust-banner-sdk #onetrust-policy-text,\s*#onetrust-banner-sdk a,\s*#onetrust-banner-sdk button\s*{([^}]*)}/,
    );

    expect(consentRule).toBeTruthy();
    expect(consentRule[1]).toContain(
      'font-family: avenir-fallback, arial, sans-serif !important;',
    );
    expect(consentRule[1]).not.toContain('AvenirNext forINTUIT');
  });
});
