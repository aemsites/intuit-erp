import { describe, it, expect } from 'vitest';
import {
  parseSlots,
  setBlockSlot,
  clearBlockSlot,
  setSectionSlot,
  clearSectionSlot,
  collectPageSlots,
  buildFormData,
} from '../tools/plugins/personalization/slots.js';

const PAGE = `<body>
  <header></header>
  <main>
    <div>
      <h1>Hero</h1>
      <div class="hero slot-2">
        <div><div>a</div></div>
      </div>
    </div>
    <div>
      <div class="cards">
        <div><div>b</div></div>
      </div>
      <div class="section-metadata">
        <div><div>Style</div><div>dark, slot-5</div></div>
        <div><div>Background</div><div>https://content.da.live/x.jpg</div></div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>`;

describe('parseSlots', () => {
  it('reads sections, blocks, and both slot kinds in order', () => {
    const { sections } = parseSlots(PAGE);
    expect(sections).toHaveLength(2);

    expect(sections[0].sectionSlot).toBeNull();
    expect(sections[0].blocks).toEqual([{ index: 0, name: 'hero', slot: 'slot-2' }]);

    expect(sections[1].sectionSlot).toBe('slot-5');
    // section-metadata is metadata, not a block — excluded from the block list
    expect(sections[1].blocks).toEqual([{ index: 0, name: 'cards', slot: null }]);
  });

  it('returns no sections when there is no <main>', () => {
    expect(parseSlots('<body><header></header></body>').sections).toEqual([]);
  });
});

describe('setBlockSlot / clearBlockSlot', () => {
  it('replaces an existing block slot rather than stacking', () => {
    const out = setBlockSlot(PAGE, 0, 0, 'slot-9');
    const block = parseSlots(out).sections[0].blocks[0];
    expect(block.slot).toBe('slot-9');
    expect(out).toContain('class="hero slot-9"');
    expect(out).not.toContain('slot-2');
  });

  it('assigns a slot to a block that had none', () => {
    const out = setBlockSlot(PAGE, 1, 0, 'slot-7');
    expect(parseSlots(out).sections[1].blocks[0].slot).toBe('slot-7');
  });

  it('clears a block slot, leaving the block name', () => {
    const out = clearBlockSlot(PAGE, 0, 0);
    expect(parseSlots(out).sections[0].blocks[0].slot).toBeNull();
    expect(out).toContain('class="hero"');
  });

  it('is a no-op for an out-of-range address', () => {
    expect(setBlockSlot(PAGE, 9, 0, 'slot-1')).toBe(PAGE);
    expect(setBlockSlot(PAGE, 0, 9, 'slot-1')).toBe(PAGE);
  });
});

describe('setSectionSlot', () => {
  it('creates a section-metadata block + Style row when absent', () => {
    const out = setSectionSlot(PAGE, 0, 'slot-3');
    expect(parseSlots(out).sections[0].sectionSlot).toBe('slot-3');
    expect(out).toContain('section-metadata');
    expect(out).toContain('Style');
    // did not touch the other section
    expect(parseSlots(out).sections[1].sectionSlot).toBe('slot-5');
  });

  it('preserves other Style tokens and replaces an existing slot', () => {
    const out = setSectionSlot(PAGE, 1, 'slot-8');
    expect(parseSlots(out).sections[1].sectionSlot).toBe('slot-8');
    expect(out).toContain('dark, slot-8');
    expect(out).not.toContain('slot-5');
  });
});

describe('clearSectionSlot', () => {
  it('removes the slot token but keeps other Style tokens', () => {
    const out = clearSectionSlot(PAGE, 1);
    expect(parseSlots(out).sections[1].sectionSlot).toBeNull();
    expect(out).toContain('<div>dark</div>');
    // Background row and section-metadata block survive
    expect(out).toContain('Background');
  });

  it('drops the Style row and the section-metadata block when they become empty', () => {
    const single = `<body><header></header><main>
      <div>
        <div class="cards"><div><div>b</div></div></div>
        <div class="section-metadata"><div><div>Style</div><div>slot-1</div></div></div>
      </div>
    </main><footer></footer></body>`;
    const out = clearSectionSlot(single, 0);
    expect(parseSlots(out).sections[0].sectionSlot).toBeNull();
    expect(out).not.toContain('section-metadata');
    expect(out).not.toContain('Style');
  });
});

describe('collectPageSlots', () => {
  it('gathers every assigned slot id, deduped', () => {
    expect(collectPageSlots(PAGE).sort()).toEqual(['slot-2', 'slot-5']);
  });
});

describe('buildFormData', () => {
  it('appends the source under field name "data" as a text/html blob', () => {
    const body = buildFormData('<body></body>');
    const value = body.get('data');
    expect(value).toBeInstanceOf(Blob);
    expect(value.type).toBe('text/html');
  });
});
