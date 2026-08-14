import {
  describe, it, expect, vi,
} from 'vitest';
import decorate, { parseFormConfig } from '../blocks/form/form.js';

// decorate() imports sendEvent (martech) at module scope; mock it the same
// way test/form-identity.test.js does so decorate() runs cleanly here too.
vi.mock('../plugins/martech/src/index.js', () => ({
  sendEvent: vi.fn(() => Promise.resolve()),
}));

function make() {
  const block = document.createElement('div');
  block.className = 'form block';
  block.innerHTML = `
    <div><div>formId</div><div>1058</div></div>
    <div><div>chiliPiperSubDomain</div><div>intuitsales</div></div>
    <div><div>chiliPiperRouter</div><div>mid-us-webform-managed-ies</div></div>
    <div><div>header</div><div>Let’s connect</div></div>
    <div><div>cta</div><div>Schedule now</div></div>`;
  return block;
}

describe('parseFormConfig', () => {
  it('extracts marketo + chilipiper config from the config rows', () => {
    const cfg = parseFormConfig(make());
    expect(cfg.formId).toBe('1058');
    expect(cfg.chiliPiperSubDomain).toBe('intuitsales');
    expect(cfg.chiliPiperRouter).toBe('mid-us-webform-managed-ies');
    expect(cfg.header).toBe('Let’s connect');
    expect(cfg.cta).toBe('Schedule now');
  });
});

describe('decorate — config rows', () => {
  function makeFullConfigBlock() {
    const block = document.createElement('div');
    block.className = 'form block';
    block.innerHTML = `
      <div><div>formId</div><div>1058</div></div>
      <div><div>munchkin</div><div>713-XYZ-001</div></div>
      <div><div>chiliPiperSubDomain</div><div>intuitsales</div></div>
      <div><div>chiliPiperRouter</div><div>mid-us-webform-managed-ies</div></div>
      <div><div>header</div><div>Let’s connect</div></div>
      <div><div>subheader</div><div>Talk to a specialist today.</div></div>
      <div><div>disclaimer</div><div>See the privacy statement for details.</div></div>
      <div><div>cta</div><div>Schedule now</div></div>`;
    return block;
  }

  it('stamps data attributes, renders header/subheader/disclaimer, and keeps the fixed fields', () => {
    const block = makeFullConfigBlock();
    decorate(block);

    expect(block.dataset.mktoFormId).toBe('1058');
    expect(block.dataset.mktoMunchkin).toBe('713-XYZ-001');
    expect(block.dataset.cpSubdomain).toBe('intuitsales');
    expect(block.dataset.cpRouter).toBe('mid-us-webform-managed-ies');

    expect(block.querySelector('.form-header').textContent).toBe('Let’s connect');
    expect(block.querySelector('.form-subheader').textContent).toBe('Talk to a specialist today.');
    expect(block.querySelector('.form-disclaimer').textContent).toBe('See the privacy statement for details.');

    // Fixed 5-field form must still render regardless of config rows.
    expect(block.querySelectorAll('input')).toHaveLength(5);
    expect(block.querySelector('input[type="email"]')).not.toBeNull();
    expect(block.querySelector('.form-submit')).not.toBeNull();
  });

  it('uses the authored `cta` as the submit button label', () => {
    const block = makeFullConfigBlock();
    decorate(block);
    expect(block.querySelector('.form-submit').textContent).toBe('Schedule now');
  });

  it('defaults the submit label to "Schedule a call" when no `cta` is authored', () => {
    const block = document.createElement('div');
    block.className = 'form block';
    block.innerHTML = '<div><div>header</div><div>Let’s connect</div></div>';
    decorate(block);
    expect(block.querySelector('.form-submit').textContent).toBe('Schedule a call');
  });
});
