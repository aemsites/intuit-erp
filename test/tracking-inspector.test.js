import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  collectTrackingInventory,
  describeTrackingTarget,
  indexRows,
  isTrackingInspectorPreview,
  loadTrackingInspectorBridge,
  trackAs,
} from '../scripts/tracking.js';

describe('tracking inspector probe gate', () => {
  it('enables the bridge only in an explicitly requested preview probe', () => {
    expect(isTrackingInspectorPreview({
      hostname: 'main--intuit-erp--aemsites.preview.da.live',
      search: '?tracking-editor=1&martech=off',
    })).toBe(true);
    expect(isTrackingInspectorPreview({
      hostname: 'main--intuit-erp--aemsites.preview.da.live',
      search: '?quick-edit=on&controller=parent',
    })).toBe(false);
    expect(isTrackingInspectorPreview({
      hostname: 'erp.intuit.com',
      search: '?tracking-editor=1',
    })).toBe(false);
  });

  it('does not fetch the bridge module outside the explicit probe', async () => {
    const loader = vi.fn().mockResolvedValue({ installTrackingInspectorBridge: vi.fn() });

    expect(loadTrackingInspectorBridge({
      hostname: 'main--intuit-erp--aemsites.preview.da.live',
      search: '?quick-edit=on&controller=parent',
    }, loader)).toBeNull();
    expect(loader).not.toHaveBeenCalled();

    await expect(loadTrackingInspectorBridge({
      hostname: 'main--intuit-erp--aemsites.preview.da.live',
      search: '?tracking-editor=1&martech=off',
    }, loader)).resolves.toBeDefined();
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('tracking inspector rendered inventory', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<main data-tracking="landing">'
      + '<div class="cta block" data-block-name="cta">'
      + '<p><a class="button" href="/pricing">View pricing</a></p>'
      + '</div>'
      + '<p><a href="/contact">Contact us</a></p>'
      + '</main>';
    trackAs('cta_block', document.querySelector('.cta'), { key: 'cta' });
  });

  it('describes automatic, override, and effective values without stamping the CTA', () => {
    const cta = document.querySelector('.cta a');
    const sheet = indexRows([{
      path: '/accounting',
      id: 'cta:pricing',
      'wa-link': 'campaign-pricing',
      action: 'engaged',
    }]);

    const item = describeTrackingTarget(cta, sheet, {
      pathname: '/accounting',
      hostname: 'erp.intuit.com',
    });

    expect(item).toMatchObject({
      id: 'cta:pricing',
      path: '/accounting',
      label: 'View pricing',
      href: '/pricing',
      block: 'cta',
      editable: true,
      automatic: {
        event: 'content:interacted',
        object: 'content',
        action: 'interacted',
        'ui-object': 'button',
        'ui-object-detail': 'View pricing',
        'ui-access-point': 'landing|cta_block',
      },
      override: {
        'wa-link': 'campaign-pricing',
        action: 'engaged',
      },
      effective: {
        event: 'content:engaged',
        action: 'engaged',
        'wa-link': 'campaign-pricing',
        'ui-access-point': 'landing|cta_block',
      },
    });
    expect(item.automatic['custom-properties'].link_name)
      .toBe('button-view-pricing [erp.intuit.com]');
    expect(cta.hasAttribute('data-object')).toBe(false);
    expect(cta.hasAttribute('data-action')).toBe(false);
  });

  it('makes an unconfigured loose CTA editable using its runtime identity', () => {
    const loose = document.querySelector('main > p a');
    const item = describeTrackingTarget(loose, new Map(), {
      pathname: '/accounting',
      hostname: 'erp.intuit.com',
    });

    expect(item.id).toBe('page:contact');
    expect(item.editable).toBe(true);
    expect(item.block).toBe('page');
    expect(loose.hasAttribute('data-track-id')).toBe(false);
  });

  it('reports the actual sheet id when runtime matching uses the label fallback', () => {
    const cta = document.querySelector('.cta a');
    const item = describeTrackingTarget(cta, [{
      path: '/accounting',
      id: 'cta:view-pricing',
      action: 'engaged',
    }], {
      pathname: '/accounting',
      hostname: 'erp.intuit.com',
    });

    expect(item.id).toBe('cta:pricing');
    expect(item.matchedId).toBe('cta:view-pricing');
    expect(item.effective.action).toBe('engaged');
  });

  it('collects configured and unconfigured interactions without skipped chrome', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button data-track-skip>Menu</button><div class="cookie"><a href="#accept">Accept</a></div>',
    );
    const inventory = collectTrackingInventory(document, [], {
      pathname: '/accounting',
      hostname: 'erp.intuit.com',
    });

    expect(inventory.map((item) => item.id)).toEqual(['cta:pricing', 'page:contact']);
  });
});
