import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ROOT = `${process.cwd()}/`;

describe('tracking editor asset delivery', () => {
  it('uses one explicit release version for every browser-cached plugin asset', async () => {
    const [html, ...modules] = await Promise.all([
      readFile(`${ROOT}tools/plugins/tracking/index.html`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/index.js`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/api.js`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/delivery.js`, 'utf8'),
    ]);
    const scriptVersion = html.match(/src="\.\/index\.js\?v=([^"]+)"/)?.[1];

    expect(scriptVersion).toBeTruthy();
    expect(html).toContain(`href="./index.css?v=${scriptVersion}"`);
    modules.forEach((source) => {
      const localImports = [...source.matchAll(/from '(\.\/[^']+\.js(?:\?[^']*)?)'/g)]
        .map((match) => match[1]);
      localImports.forEach((specifier) => {
        expect(specifier).toMatch(new RegExp(`\\?v=${scriptVersion.replace('.', '\\.')}\u0024`));
      });
    });
  });

  it('renders a native panel editor without a page frame or nested rail shell', async () => {
    const [html, script] = await Promise.all([
      readFile(`${ROOT}tools/plugins/tracking/index.html`, 'utf8'),
      readFile(`${ROOT}tools/plugins/tracking/index.js`, 'utf8'),
    ]);

    expect(html).not.toMatch(/<iframe\b/i);
    expect(script).not.toMatch(/createElement\(['"]iframe['"]\)/);
    expect(script).not.toContain('canvasPreviewWindows');
    expect(script).not.toContain("class: 'tracking-rail'");
  });

  it('keeps editor-only code out of the production tracking runtime', async () => {
    const trackingRuntime = await readFile(`${ROOT}scripts/tracking.js`, 'utf8');

    expect(trackingRuntime).not.toContain('/tools/plugins/tracking/');
    expect(trackingRuntime).not.toContain('TrackingInspector');
    expect(trackingRuntime).not.toContain('collectTrackingInventory');
    expect(trackingRuntime).not.toContain('describeTrackingTarget');
  });
});
