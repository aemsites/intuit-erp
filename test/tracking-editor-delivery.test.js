import {
  describe, expect, it, vi,
} from 'vitest';
import {
  publishReviewedSheet,
  saveAndPreviewOverride,
  sheetsEqual,
} from '../tools/plugins/tracking/delivery.js';

const ORIGINAL = {
  ':type': 'sheet',
  total: 1,
  data: [{ path: '*', id: 'footer:company', 'wa-link': 'company', owner: 'keep' }],
};

function memoryApi(initial = ORIGINAL) {
  let source = structuredClone(initial);
  let revision = 1;
  const etag = () => `"revision-${revision}"`;
  const writeSource = vi.fn(async (sheet, options = {}) => {
    if (options.etag !== etag()) throw new Error('Source changed before the conditional write.');
    source = structuredClone(sheet);
    revision += 1;
  });
  return {
    api: {
      readSource: vi.fn(async () => structuredClone(source)),
      readSourceRevision: vi.fn(async () => ({ sheet: structuredClone(source), etag: etag() })),
      writeSource,
      preview: vi.fn(async () => {}),
      publish: vi.fn(async () => {}),
    },
    mutate(next) {
      source = structuredClone(typeof next === 'function' ? next(source) : next);
      revision += 1;
    },
    etag,
    source: () => structuredClone(source),
  };
}

describe('tracking editor delivery workflow', () => {
  it('compares sheets by content rather than object key order', () => {
    expect(sheetsEqual(
      { ':type': 'sheet', total: 1, data: [{ path: '*', id: 'a', action: 'go' }] },
      { data: [{ action: 'go', id: 'a', path: '*' }], total: 1, ':type': 'sheet' },
    )).toBe(true);
  });

  it('saves onto the latest source, reads the canonical result, then previews it', async () => {
    const harness = memoryApi();
    const result = await saveAndPreviewOverride({
      api: harness.api,
      base: ORIGINAL,
      change: { path: '/accounting', id: 'page:contact', values: { action: 'engaged' } },
    });

    expect(result.conflicts).toEqual([]);
    expect(result.sheet.data).toContainEqual({
      path: '/accounting', id: 'page:contact', action: 'engaged',
    });
    expect(harness.api.writeSource).toHaveBeenCalledTimes(1);
    expect(harness.api.writeSource).toHaveBeenCalledWith(result.sheet, { etag: '"revision-1"' });
    expect(harness.api.preview).toHaveBeenCalledTimes(1);
    expect(result.etag).toBe('"revision-2"');
  });

  it('stops a same-field concurrent edit before writing or previewing', async () => {
    const latest = structuredClone(ORIGINAL);
    latest.data.push({ path: '/accounting', id: 'page:contact', action: 'started' });
    latest.total = 2;
    const base = structuredClone(latest);
    const harness = memoryApi(latest);
    harness.api.readSourceRevision.mockResolvedValueOnce({
      etag: '"revision-2"',
      sheet: {
        ...latest,
        data: latest.data.map((row) => (
          row.id === 'page:contact' ? { ...row, action: 'completed' } : row
        )),
      },
    });

    const result = await saveAndPreviewOverride({
      api: harness.api,
      base,
      change: { path: '/accounting', id: 'page:contact', values: { action: 'engaged' } },
    });

    expect(result.conflicts).toEqual(['action']);
    expect(result.sheet).toBeNull();
    expect(harness.api.writeSource).not.toHaveBeenCalled();
    expect(harness.api.preview).not.toHaveBeenCalled();
  });

  it('does not overwrite a write interleaved after its merge read', async () => {
    const harness = memoryApi();
    harness.api.writeSource.mockImplementationOnce(async (sheet, options) => {
      harness.mutate((source) => ({
        ...source,
        total: 2,
        data: [...source.data, { path: '*', id: 'header:login', action: 'signed-in' }],
      }));
      if (options.etag !== harness.etag()) {
        throw new Error('Could not save tracking sheet (412 Precondition Failed).');
      }
    });

    await expect(saveAndPreviewOverride({
      api: harness.api,
      base: ORIGINAL,
      change: { path: '/accounting', id: 'page:contact', values: { action: 'engaged' } },
    })).rejects.toThrow(/412 Precondition Failed/);

    expect(harness.source().data).toContainEqual({
      path: '*', id: 'header:login', action: 'signed-in',
    });
    expect(harness.source().data).not.toContainEqual({
      path: '/accounting', id: 'page:contact', action: 'engaged',
    });
    expect(harness.api.preview).not.toHaveBeenCalled();
  });

  it('reports that the source was saved when the follow-up preview fails', async () => {
    expect.assertions(3);
    const harness = memoryApi();
    harness.api.preview.mockRejectedValue(new Error('Preview unavailable'));

    try {
      await saveAndPreviewOverride({
        api: harness.api,
        base: ORIGINAL,
        change: { path: '/accounting', id: 'page:contact', values: { action: 'engaged' } },
      });
    } catch (error) {
      expect(error).toMatchObject({ sourceSaved: true });
      expect(error.sheet.data).toContainEqual({
        path: '/accounting', id: 'page:contact', action: 'engaged',
      });
    }
    expect(harness.source().data).toHaveLength(2);
  });

  it('reports a partial save when the source changes while preview is running', async () => {
    expect.assertions(3);
    const harness = memoryApi();
    harness.api.preview.mockImplementationOnce(async () => {
      harness.mutate((source) => ({
        ...source,
        total: source.total + 1,
        data: [...source.data, { path: '*', id: 'header:login', action: 'signed-in' }],
      }));
    });

    try {
      await saveAndPreviewOverride({
        api: harness.api,
        base: ORIGINAL,
        change: { path: '/accounting', id: 'page:contact', values: { action: 'engaged' } },
      });
    } catch (error) {
      expect(error).toMatchObject({ sourceSaved: true, etag: '"revision-3"' });
      expect(error.message).toMatch(/changed while previewing/i);
      expect(error.sheet.data).toContainEqual({
        path: '*', id: 'header:login', action: 'signed-in',
      });
    }
  });

  it('blocks publishing a source that changed since it was reviewed', async () => {
    const harness = memoryApi({ ...ORIGINAL, data: [{ ...ORIGINAL.data[0], action: 'changed' }] });
    const result = await publishReviewedSheet({
      api: harness.api,
      reviewed: ORIGINAL,
      etag: '"revision-1"',
    });

    expect(result).toMatchObject({ stale: true, sheet: harness.source() });
    expect(harness.api.preview).not.toHaveBeenCalled();
    expect(harness.api.publish).not.toHaveBeenCalled();
  });

  it('re-previews the reviewed source immediately before publishing', async () => {
    const harness = memoryApi();
    await expect(publishReviewedSheet({
      api: harness.api,
      reviewed: ORIGINAL,
      etag: '"revision-1"',
    })).resolves.toMatchObject({ stale: false, sheet: ORIGINAL, etag: '"revision-1"' });
    expect(harness.api.preview).toHaveBeenCalledTimes(1);
    expect(harness.api.readSourceRevision).toHaveBeenCalledTimes(2);
    expect(harness.api.publish).toHaveBeenCalledTimes(1);
    expect(harness.api.preview.mock.invocationCallOrder[0])
      .toBeLessThan(harness.api.publish.mock.invocationCallOrder[0]);
  });

  it('blocks publish when the source changes while preview is running', async () => {
    const harness = memoryApi();
    harness.api.preview.mockImplementationOnce(async () => {
      harness.mutate((source) => ({
        ...source,
        data: [{ ...source.data[0], action: 'changed-during-preview' }],
      }));
    });

    const result = await publishReviewedSheet({
      api: harness.api,
      reviewed: ORIGINAL,
      etag: '"revision-1"',
    });

    expect(result).toMatchObject({ stale: true, sheet: harness.source() });
    expect(harness.api.publish).not.toHaveBeenCalled();
  });

  it('preserves unrelated data through an add, edit, and remove lifecycle', async () => {
    const harness = memoryApi();
    let reviewed = structuredClone(ORIGINAL);
    let reviewedEtag = '"revision-1"';

    for (const value of ['e2e-added', 'e2e-edited', '']) {
      const saved = await saveAndPreviewOverride({
        api: harness.api,
        base: reviewed,
        change: {
          path: '/accounting',
          id: 'page:e2e-tracking-editor',
          values: { action: value },
        },
      });
      reviewed = saved.sheet;
      reviewedEtag = saved.etag;
      await publishReviewedSheet({
        api: harness.api,
        reviewed,
        etag: reviewedEtag,
      });
    }

    expect(harness.source()).toEqual(ORIGINAL);
    expect(harness.api.writeSource).toHaveBeenCalledTimes(3);
    expect(harness.api.preview).toHaveBeenCalledTimes(6);
    expect(harness.api.publish).toHaveBeenCalledTimes(3);
  });
});
