import { describe, it, expect } from 'vitest';
import { parseFormConfig } from '../blocks/form/form.js';

function make() {
  const block = document.createElement('div');
  block.className = 'form block';
  block.innerHTML = `
    <div><div>formId</div><div>1058</div></div>
    <div><div>chiliPiperSubDomain</div><div>intuitsales</div></div>
    <div><div>chiliPiperRouter</div><div>mid-us-webform-managed-ies</div></div>
    <div><div>header</div><div>Let’s connect</div></div>`;
  return block;
}

describe('parseFormConfig', () => {
  it('extracts marketo + chilipiper config from the config rows', () => {
    const cfg = parseFormConfig(make());
    expect(cfg.formId).toBe('1058');
    expect(cfg.chiliPiperSubDomain).toBe('intuitsales');
    expect(cfg.chiliPiperRouter).toBe('mid-us-webform-managed-ies');
    expect(cfg.header).toBe('Let’s connect');
  });
});
