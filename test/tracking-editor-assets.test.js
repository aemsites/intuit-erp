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
      readFile(`${ROOT}tools/plugins/tracking/bridge.js`, 'utf8'),
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

  it('renders a native panel with one visually hidden probe and no nested rail shell', async () => {
    const [html, script, css] = await Promise.all([
      readFile(`${ROOT}tools/plugins/tracking/index.html`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/index.js`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/index.css`, 'utf8'),
    ]);

    expect(html).not.toMatch(/<iframe\b/i);
    expect(script).toMatch(/el\(['"]iframe['"]/);
    expect(script).toContain("class: 'tracking-probe'");
    expect(script).not.toContain("class: 'tracking-rail'");
    expect(css).toMatch(/\.tracking-probe\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.tracking-probe\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('keeps the editor bridge behind an explicit dynamic-import gate', async () => {
    const trackingRuntime = await readFile(`${ROOT}scripts/tracking.js`, 'utf8');

    expect(trackingRuntime).not.toMatch(/^import .*tools\/plugins\/tracking/m);
    expect(trackingRuntime).toContain("params.get('tracking-editor') === '1'");
    expect(trackingRuntime).toMatch(/import\('\.\.\/tools\/plugins\/tracking\/bridge\.js\?v=/);
  });
});
