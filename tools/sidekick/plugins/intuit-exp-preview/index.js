/*
 * Experience Preview palette — the UI half of the tool. It renders inside the sidekick
 * palette iframe and drives the page-side engine (scripts/experience-preview.js) purely
 * over postMessage, so it works even when the sidekick loads this iframe in an opaque
 * ('null') origin. No DA SDK — this talks to the previewed page, not to DA.
 */
/* eslint-disable no-use-before-define */

const NS = 'intuit-exp-preview';

/** Minimal element builder (same shape as the DA personalization panel). */
function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => node.appendChild(c));
  return node;
}

// --- postMessage client ------------------------------------------------------

let seq = 0;
const pending = new Map();

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.ns !== NS || d.dir !== 'res') return;
  const entry = pending.get(d.id);
  if (!entry) return;
  pending.delete(d.id);
  clearTimeout(entry.timer);
  entry.resolve(d);
});

function request(type, payload = null, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    seq += 1;
    const id = seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${type} timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    window.parent.postMessage({
      ns: NS, dir: 'req', id, type, payload,
    }, '*');
  });
}

async function connect() {
  for (let i = 0; i < 40; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await request('hello', null, 500);
      if (res && res.ok) return res;
    } catch (err) { /* engine not ready yet — retry */ }
  }
  throw new Error('no-connection');
}

// --- state + small helpers ---------------------------------------------------

const app = document.getElementById('app');
const state = { targets: [], seed: {}, path: '' };
let statusEl;

function setStatus(text, kind) {
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.className = `pzn-status${kind ? ` pzn-status-${kind}` : ''}`;
}

function splitCsv(value) {
  return String(value || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function input(value) {
  return el('input', { class: 'pzn-input', attrs: { value: value == null ? '' : String(value) } });
}

function textarea(value) {
  const t = el('textarea', { class: 'iep-textarea' });
  t.value = value == null ? '' : String(value);
  return t;
}

function select(options, value) {
  const s = el('select', { class: 'pzn-select' });
  options.forEach((o) => {
    const opt = el('option', { text: o.label, attrs: { value: o.value } });
    if (o.value === value) opt.selected = true;
    s.append(opt);
  });
  return s;
}

function field(labelText, control) {
  return el('div', { class: 'iep-field' }, [
    el('label', { class: 'pzn-field-label', text: labelText }),
    control,
  ]);
}

// --- Phase 1: variant preview ------------------------------------------------

async function selectVariant(target, path, row) {
  const group = row.parentElement;
  group.querySelectorAll('.iep-variant').forEach((r) => r.classList.remove('is-active'));
  row.classList.add('is-active');
  setStatus(`Applying ${path === '__default__' ? 'default' : path}…`, 'pending');
  try {
    const res = await request('applyVariant', { targetKey: target.key, path });
    if (res.ok) setStatus('Applied — the page now shows this variant.', 'ok');
    else setStatus(res.reason || 'Could not apply this variant.', 'error');
  } catch (err) {
    setStatus('Could not reach the page.', 'error');
  }
}

function variantCard(target) {
  const kindName = target.kind === 'exp' ? 'Experiment' : 'Personalization';
  const kindChip = el('span', {
    class: `pzn-chip iep-kind ${target.kind === 'exp' ? 'pzn-chip-exp' : 'pzn-chip-pzn'} is-set`,
    text: kindName,
  });
  const head = el('div', { class: 'pzn-section-head' }, [
    el('span', { class: 'pzn-section-title', text: target.label, attrs: { title: `${kindName} · id: ${target.id}` } }),
    kindChip,
  ]);

  const body = el('div', { class: 'iep-target-body' });

  const badges = [];
  if (target.mode === 'append') badges.push(el('span', { class: 'iep-badge iep-badge-append', text: 'Append' }));
  if (target.droppedByIxp) badges.push(el('span', { class: 'iep-badge iep-badge-ixp', text: 'IXP wins' }));
  if (badges.length) body.append(el('div', { class: 'iep-note' }, badges));
  if (target.droppedByIxp) {
    body.append(el('div', {
      class: 'iep-note',
      text: 'At runtime the experiment on this target takes precedence; shown so you can still preview it in isolation.',
    }));
  }

  const group = el('div', { class: 'iep-variants' });
  const options = [{ path: '__default__', label: 'Default (authored)' }]
    .concat(target.variants.map((p) => ({ path: p, label: p })));
  options.forEach((opt, idx) => {
    const radio = el('input', { attrs: { type: 'radio', name: target.key } });
    if (idx === 0) radio.checked = true;
    const labelClass = `iep-variant-label${opt.path === '__default__' ? '' : ' pzn-variant-path'}`;
    const row = el('label', { class: `iep-variant${idx === 0 ? ' is-active' : ''}` }, [
      radio,
      el('span', { class: labelClass, text: opt.label }),
    ]);
    radio.addEventListener('change', () => selectVariant(target, opt.path, row));
    group.append(row);
  });
  body.append(group);

  if (!target.variants.length) {
    body.append(el('div', {
      class: 'iep-note',
      text: 'No variant fragments are listed on this target. Add them in the DA personalization panel, or use “Simulate context” below.',
    }));
  }

  return el('div', { class: 'pzn-section' }, [head, body]);
}

function variantsSection() {
  const wrap = el('div');
  wrap.append(el('div', { class: 'iep-group-title', text: 'Instrumented variants' }));
  if (!state.targets.length) {
    wrap.append(el('div', {
      class: 'pzn-muted',
      text: 'No personalization or experimentation is instrumented on this page yet. Tag it in the DA personalization panel, then reopen this preview.',
    }));
    return wrap;
  }
  state.targets.forEach((t) => wrap.append(variantCard(t)));
  return wrap;
}

// --- Phase 2: context simulation --------------------------------------------

function buildPreviewParams(ctx) {
  // Exact contract is TBD (see plan Open items). Send the common scalar signals as query
  // params so the preview backend can read overrides; the full context still rides the body.
  const p = {};
  if (ctx.locale) p.locale = ctx.locale;
  if (ctx.deviceType) p.deviceType = ctx.deviceType;
  const of1 = ctx.of1Intent || {};
  if (of1.topIntent) p.topIntent = of1.topIntent;
  if (of1.journeyStage) p.journeyStage = of1.journeyStage;
  if (Array.isArray(ctx.segments) && ctx.segments.length) p.segments = ctx.segments.join(',');
  return p;
}

function assembleContext(f, rawMode) {
  if (rawMode) return JSON.parse(f.raw.value);
  const seed = state.seed || {};
  const ctx = { ...seed };
  ctx.locale = f.locale.value.trim() || seed.locale;
  ctx.deviceType = f.device.value;
  ctx.newVisitor = f.newVisitor.checked;
  if (f.ivid.value.trim()) ctx.ivid = f.ivid.value.trim(); else delete ctx.ivid;
  if (f.screen.value.trim()) ctx.screenResolution = f.screen.value.trim();

  const of1 = { ...(seed.of1Intent || {}) };
  of1.topInterests = splitCsv(f.interests.value);
  if (f.topIntent.value.trim()) of1.topIntent = f.topIntent.value.trim(); else delete of1.topIntent;
  if (f.journey.value) of1.journeyStage = f.journey.value; else delete of1.journeyStage;
  of1.pagesViewed = splitCsv(f.pages.value);
  if (f.entry.value.trim()) of1.entrySource = f.entry.value.trim(); else delete of1.entrySource;
  ctx.of1Intent = of1;

  const segs = splitCsv(f.segments.value);
  if (segs.length) ctx.segments = segs; else delete ctx.segments;
  return ctx;
}

function renderDecisions(out, decisions) {
  out.replaceChildren();
  if (!decisions || !decisions.length) {
    out.append(el('div', { class: 'iep-note', text: 'No variant was selected for these signals (control / baseline).' }));
    return;
  }
  decisions.forEach((d) => {
    const noun = d.kind === 'exp' ? 'Experiment' : 'Personalization';
    const to = d.replacement ? `→ ${d.replacement}` : '→ (control, no swap)';
    out.append(el('div', {}, [
      el('span', { text: `${noun} ${d.id} ` }),
      el('span', { class: 'pzn-variant-path', text: to }),
    ]));
  });
}

function simulateSection(shared) {
  const seed = state.seed || {};
  const of1 = seed.of1Intent || {};

  const f = {
    locale: input(seed.locale),
    device: select([{ value: 'Desktop', label: 'Desktop' }, { value: 'Mobile', label: 'Mobile' }], seed.deviceType || 'Desktop'),
    newVisitor: el('input', { attrs: { type: 'checkbox' } }),
    ivid: input(seed.ivid),
    screen: input(seed.screenResolution),
    interests: input((of1.topInterests || []).join(', ')),
    topIntent: input(of1.topIntent),
    journey: select(
      ['', 'awareness', 'consideration', 'decision', 'retention'].map((v) => ({ value: v, label: v || '(unset)' })),
      of1.journeyStage || '',
    ),
    pages: input((of1.pagesViewed || []).join(', ')),
    entry: input(of1.entrySource),
    segments: textarea(''),
    raw: textarea(''),
  };
  f.newVisitor.checked = seed.newVisitor !== false;

  // structured groups
  const structured = el('div', {}, [
    el('div', { class: 'iep-group-title', text: 'Base context' }),
    field('Locale', f.locale),
    field('Device type', f.device),
    el('label', { class: 'pzn-checkbox' }, [f.newVisitor, el('span', { text: 'New visitor' })]),
    field('ivid', f.ivid),
    field('Screen resolution', f.screen),
    el('div', { class: 'iep-group-title', text: 'AOF1 intent signals' }),
    field('Top interests (comma-separated)', f.interests),
    field('Top intent', f.topIntent),
    field('Journey stage', f.journey),
    field('Pages viewed (comma-separated)', f.pages),
    field('Entry source', f.entry),
    el('div', { class: 'iep-group-title', text: 'AEP segments' }),
    field('Segment IDs (comma or newline separated)', f.segments),
  ]);

  const rawWrap = el('div', {}, [
    el('div', { class: 'iep-note', text: 'Authoritative when enabled — edits here are sent as-is.' }),
    f.raw,
  ]);
  rawWrap.hidden = true;

  const rawToggle = el('input', { attrs: { type: 'checkbox' } });
  rawToggle.addEventListener('change', () => {
    if (rawToggle.checked) {
      try {
        f.raw.value = JSON.stringify(assembleContext(f, false), null, 2);
      } catch (err) { /* leave the textarea as-is if the form can't be serialized */ }
    }
    structured.hidden = rawToggle.checked;
    rawWrap.hidden = !rawToggle.checked;
  });

  const decisionsOut = el('div', { class: 'iep-decisions' });
  decisionsOut.hidden = true;

  const runBtn = el('button', { class: 'pzn-save', text: 'Preview with this context' });
  const resetBtn = el('button', { class: 'pzn-clear', text: 'Reset' });

  runBtn.addEventListener('click', async () => {
    let ctx;
    try {
      ctx = assembleContext(f, rawToggle.checked);
    } catch (err) {
      setStatus('The raw JSON is not valid.', 'error');
      return;
    }
    setStatus('Contacting the experience endpoint…', 'pending');
    runBtn.disabled = true;
    try {
      const res = await request('simulateContext', {
        context: ctx,
        previewParams: buildPreviewParams(ctx),
        baseUrl: shared.apiUrl.value.trim() || undefined,
      });
      decisionsOut.hidden = false;
      if (res.ok) {
        setStatus('Applied the endpoint’s decision to the page.', 'ok');
        renderDecisions(decisionsOut, res.decisions);
      } else {
        setStatus(`No change (${res.reason || 'error'}). Showing baseline.`, 'error');
        renderDecisions(decisionsOut, []);
      }
    } catch (err) {
      setStatus('Could not reach the experience endpoint.', 'error');
    } finally {
      runBtn.disabled = false;
    }
  });

  resetBtn.addEventListener('click', () => resetPage());

  const body = el('div', { class: 'iep-collapse-body' }, [
    el('div', { class: 'iep-note', text: 'Edit the visitor signals below, then send them to the pzn/exp endpoint to preview the real decision.' }),
    structured,
    el('label', { class: 'pzn-checkbox' }, [rawToggle, el('span', { text: 'Edit as raw JSON (advanced)' })]),
    rawWrap,
    el('div', { class: 'iep-actions' }, [runBtn, resetBtn]),
    decisionsOut,
  ]);

  const head = el('button', { class: 'iep-collapse-head' }, [
    el('span', { text: 'Simulate context' }),
    el('span', { class: 'iep-caret', text: '▸' }),
  ]);
  const collapse = el('div', { class: 'iep-collapse' }, [head, body]);
  head.addEventListener('click', () => collapse.classList.toggle('is-open'));
  return collapse;
}

// Advanced (collapsed) — power-user settings that shouldn't clutter the main flow.
function advancedSection(shared) {
  const body = el('div', { class: 'iep-collapse-body' }, [
    el('div', { class: 'iep-group-title', text: 'API endpoint' }),
    field('Override API URL', shared.apiUrl),
    el('div', { class: 'iep-note', text: 'Blank uses this site’s /api. Set a full base (e.g. https://stage.erp.intuit.com/api) to point pzn/exp elsewhere. ?preview=true is always added.' }),
  ]);
  const head = el('button', { class: 'iep-collapse-head' }, [
    el('span', { text: 'Advanced' }),
    el('span', { class: 'iep-caret', text: '▸' }),
  ]);
  const collapse = el('div', { class: 'iep-collapse' }, [head, body]);
  head.addEventListener('click', () => collapse.classList.toggle('is-open'));
  return collapse;
}

// --- reset + shell -----------------------------------------------------------

async function resetPage() {
  setStatus('Resetting to the authored page…', 'pending');
  try {
    const res = await request('resetToBaseline');
    if (res.ok) {
      setStatus('Reset to the authored default.', 'ok');
      app.querySelectorAll('.iep-variants').forEach((group) => {
        group.querySelectorAll('.iep-variant').forEach((row, i) => {
          const radio = row.querySelector('input[type="radio"]');
          if (radio) radio.checked = i === 0;
          row.classList.toggle('is-active', i === 0);
        });
      });
    } else {
      setStatus('Could not reset the page.', 'error');
    }
  } catch (err) {
    setStatus('Could not reach the page.', 'error');
  }
}

function render() {
  app.replaceChildren();
  statusEl = el('div', { class: 'pzn-status' });
  // The API-URL override lives in Advanced but is read by Simulate, so both share one input.
  const shared = { apiUrl: input('') };
  shared.apiUrl.setAttribute('placeholder', 'https://stage.erp.intuit.com/api');
  app.append(
    el('div', { class: 'iep-intro', text: 'Preview how this page renders for different variants and visitor signals. Changes apply to the live preview page and never publish.' }),
    statusEl,
    variantsSection(),
    simulateSection(shared),
    advancedSection(shared),
  );
  const footer = el('div', { class: 'iep-footer' }, [
    el('span', { class: 'iep-path', text: state.path || '' }),
    el('button', { class: 'pzn-clear', text: 'Reset page' }),
  ]);
  footer.querySelector('button').addEventListener('click', () => resetPage());
  app.append(footer);
  setStatus(state.targets.length
    ? 'Pick a variant to preview it on the page.'
    : 'No variants instrumented on this page.', '');
}

function renderMessage(text) {
  app.replaceChildren(el('div', { class: 'pzn-muted', text }));
}

async function start() {
  renderMessage('Connecting to the preview page…');
  try {
    await connect();
  } catch (err) {
    renderMessage('Couldn’t connect to the page. Open this from the AEM Sidekick on an aem.page preview page, then reload the page and reopen this panel.');
    return;
  }
  const [targetsRes, ctxRes] = await Promise.all([
    request('getTargets').catch(() => ({ targets: [] })),
    request('getContext').catch(() => ({ context: {} })),
  ]);
  state.targets = targetsRes.targets || [];
  state.seed = ctxRes.context || {};
  const ready = await request('hello').catch(() => ({}));
  state.path = ready.path || '';
  render();
}

// The AEM Sidekick keeps its theme in the extension's own storage (unreadable here) and
// hands it to us as ?theme=dark|light on the palette URL. It rebuilds the palette with a
// fresh param when the theme toggles, so reading it on load is all we need. Default dark.
function applyTheme() {
  const theme = new URLSearchParams(window.location.search).get('theme');
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
}

applyTheme();
start();
