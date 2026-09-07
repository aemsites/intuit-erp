import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT_FILES = [
  'README.md',
  'appvars-diff.mjs',
  'capture-html.mjs',
  'clicktrack-diff.mjs',
  'content-diff.mjs',
  'content-inventory.mjs',
  'diff-profiles.mjs',
  'live-session.mjs',
  'martech-diff.mjs',
  'tracker-replica.mjs',
  'visual-diff.mjs',
];

const FIXTURES = [
  'appvars-homepage.golden.json',
  'backend-contract.json',
  'clicktrack-contract.golden.json',
  'clicktrack-homepage.golden.json',
  'martech.golden.json',
];

const VERIFY_COMMANDS = {
  'verify:appvars': 'node scripts/diff/appvars-diff.mjs --env local --page homepage --local-base http://localhost:3000 --baseline scripts/diff/fixtures/appvars-homepage.golden.json --verify',
  'verify:click-tracking': 'vitest run test/tracking-replica.test.js test/tracking-contract.test.js test/clicktrack-diff.test.js',
  'verify:martech': 'node scripts/diff/martech-diff.mjs --env local --page homepage,pricing,accountant,case-study --local-base http://localhost:3000 --baseline scripts/diff/fixtures/martech.golden.json --verify',
};

describe('customer-facing martech verification kit', () => {
  it('contains only the supported tools plus the protected visual parity tools', () => {
    expect(readdirSync('scripts/diff').filter((name) => name !== 'fixtures').sort())
      .toEqual(ROOT_FILES.sort());
  });

  it('contains only sanitized, reusable fixtures', () => {
    expect(readdirSync('scripts/diff/fixtures').filter((name) => name !== 'local').sort())
      .toEqual(FIXTURES.sort());
  });

  it('exposes runnable verification commands instead of local-evidence commands', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const verificationScripts = Object.fromEntries(
      Object.entries(pkg.scripts).filter(([name]) => name.startsWith('verify:')),
    );

    expect(verificationScripts).toEqual(VERIFY_COMMANDS);
    expect(Object.keys(pkg.scripts)).not.toEqual(expect.arrayContaining([
      'golden:customer',
      'contract:audit',
      'golden:crosscheck',
      'sheet:customer',
      'oracle:customer',
      'oracle:customer:floor',
      'coverage:customer',
      'stage:parity',
    ]));
  });

  it('documents only customer-supported verification entry points', () => {
    const clickTracking = readFileSync('CLICK-TRACKING.md', 'utf8');
    const martech = readFileSync('MARTECH.md', 'utf8');
    const readme = readFileSync('scripts/diff/README.md', 'utf8');

    expect(clickTracking).not.toMatch(/parity-gate|golden-replay|sheet-from-our-build/);
    expect(martech).toContain('scripts/diff/fixtures/martech.golden.json');
    expect(martech).not.toContain('scripts/diff/fixtures/martech-homepage.golden.json');
    expect(readme).toContain('npm run verify:martech');
    expect(readme).toContain('npm run verify:appvars');
    expect(readme).toContain('npm run verify:click-tracking');
  });
});
