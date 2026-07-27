/**
 * Native, on-page OF1 personalization driver. Collects personalizable text
 * elements from the main content, builds a behaviorProfile enriched with the
 * visitor's firmographics + RTCDP B2B audiences, calls the OF1 worker's
 * /api/personalize NDJSON stream, and applies the returned DOM mutations.
 * Runs in the eager phase so rewrites land before LCP (no flicker).
 */

const PERSONALIZE_TAGS = ['H1', 'H2', 'H3', 'P'];
const MAX_ELEMENTS = 12;

function collectElements(main) {
  const elements = {};
  let i = 0;
  for (const el of main.querySelectorAll(PERSONALIZE_TAGS.join(','))) {
    const text = (el.textContent || '').trim();
    if (!text || text.length < 12) continue;
    const id = `T${i}`;
    el.dataset.of1Id = id;
    elements[id] = { tag: el.tagName.toLowerCase(), text };
    i += 1;
    if (i >= MAX_ELEMENTS) break;
  }
  return { elements };
}

function applyMutation(main, mutation) {
  if (mutation.type !== 'mutation' || !mutation.id || !mutation.new) return;
  const el = main.querySelector(`[data-of1-id="${mutation.id}"]`);
  if (el) el.textContent = mutation.new;
}

export default async function runOf1Personalization(context, of1BaseUrl, tenantId) {
  const main = document.querySelector('main');
  if (!main || !context || !context.firmographics) return;

  const { elements } = collectElements(main);
  if (Object.keys(elements).length === 0) return;

  const behaviorProfile = {
    interests: [],
    intent: null,
    firmographics: context.firmographics,
    audiences: context.audiences || [],
  };

  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    res = await fetch(`${of1BaseUrl}/api/personalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: tenantId,
        elements,
        behaviorProfile,
        firmographics: context.firmographics,
        audiences: context.audiences || [],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return;
  }
  clearTimeout(timer);
  if (!res || !res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Stream NDJSON: apply each mutation line as it arrives.
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          applyMutation(main, JSON.parse(trimmed));
        } catch (e) {
          // skip non-JSON / partial lines
        }
      }
    }
  } catch (e) {
    // stream aborted mid-flight — apply what we have and stop
  }
  // Flush final buffered line if any.
  if (buffer.trim()) {
    try {
      applyMutation(main, JSON.parse(buffer.trim()));
    } catch (e) {
      // skip non-JSON / partial lines
    }
  }
}
