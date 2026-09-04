import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ROOT = `${process.cwd()}/`;

describe('tracking editor asset delivery', () => {
  it('uses one explicit release version for every browser-cached plugin asset', async () => {
    const [html, trackingRuntime, ...modules] = await Promise.all([
      readFile(`${ROOT}tools/plugins/tracking/index.html`, 'utf8'),
      readFile(`${ROOT}scripts/tracking.js`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/index.js`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/api.js`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/delivery.js`, 'utf8'),
    ]);
    const scriptVersion = html.match(/src="\.\/index\.js\?v=([^"]+)"/)?.[1];

    expect(scriptVersion).toBeTruthy();
    expect(html).toContain(`href="./index.css?v=${scriptVersion}"`);
    expect(trackingRuntime)
      .toContain(`import('../tools/plugins/tracking/bridge.js?v=${scriptVersion}')`);
    modules.forEach((source) => {
      const localImports = [...source.matchAll(/from '(\.\/[^']+\.js(?:\?[^']*)?)'/g)]
        .map((match) => match[1]);
      localImports.forEach((specifier) => {
        expect(specifier).toMatch(new RegExp(`\\?v=${scriptVersion.replace('.', '\\.')}\u0024`));
      });
    });
  });
});
