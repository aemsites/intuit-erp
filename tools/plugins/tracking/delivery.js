import { mergeOverride } from './model.js';

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalValue(item)]));
}

export function sheetsEqual(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

export async function saveAndPreviewOverride({ api, base, change }) {
  const latest = await api.readSourceRevision();
  const result = mergeOverride({ base, latest: latest.sheet, change });
  if (result.conflicts.length) return result;

  await api.writeSource(result.sheet, { etag: latest.etag });
  let revision;
  try {
    revision = await api.readSourceRevision();
    await api.preview();
    const previewed = await api.readSourceRevision();
    if (previewed.etag !== revision.etag || !sheetsEqual(previewed.sheet, revision.sheet)) {
      revision = previewed;
      throw new Error('The tracking sheet changed while previewing. Review the latest source before publishing.');
    }
    return { conflicts: [], ...revision };
  } catch (cause) {
    const error = new Error(`Saved the tracking sheet, but the follow-up failed: ${cause.message}`, {
      cause,
    });
    error.sourceSaved = true;
    error.sheet = revision?.sheet;
    error.etag = revision?.etag;
    throw error;
  }
}

function isReviewedRevision(revision, reviewed, etag) {
  return revision.etag === etag && sheetsEqual(revision.sheet, reviewed);
}

export async function publishReviewedSheet({ api, reviewed, etag }) {
  let revision = await api.readSourceRevision();
  if (!isReviewedRevision(revision, reviewed, etag)) return { stale: true, ...revision };
  await api.preview();
  revision = await api.readSourceRevision();
  if (!isReviewedRevision(revision, reviewed, etag)) return { stale: true, ...revision };
  await api.publish();
  return { stale: false, ...revision };
}
