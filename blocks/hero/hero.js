/**
 * hero — dark gradient lead band (all 5 pages).
 *
 * Authoring rows (each row = one cell):
 *   1. eyebrow text            (optional — short kicker, e.g. "THE AI-NATIVE ERP")
 *   2. <h1> headline           (the page's single <h1>)
 *   3. lede paragraph          (optional)
 *   4. CTAs paragraph          (optional — <em><a> secondary, <strong><a> primary)
 *   5. media <img>             (optional; omitted on the .hero.form variant)
 *
 * Variant .hero.form (pricing) renders a static "Let's connect" lead card on
 * the right instead of the media image.
 * CSS: blocks/hero/hero.css
 */

function leadCard() {
  const wrap = document.createElement('div');
  wrap.className = 'hero-form';
  wrap.innerHTML = `
    <div class="lead-card">
      <h2 class="lead-title">Let's connect</h2>
      <p class="lead-sub">Schedule a call to see if Intuit Enterprise Suite is a good fit.</p>
      <a class="lead-acct" href="https://erp.intuit.com/accountant/">I'm an accountant</a>
      <div class="lead-row">
        <label class="field"><input type="text" placeholder="First name*"></label>
        <label class="field"><input type="text" placeholder="Last name*"></label>
      </div>
      <label class="field"><input type="text" placeholder="Business name*"></label>
      <label class="field"><input type="email" placeholder="Business email*"></label>
      <label class="field"><input type="tel" placeholder="Business phone*"></label>
      <div class="recaptcha">
        <div class="rc-left"><span class="rc-box" aria-hidden="true"></span><span class="rc-label">I'm not a robot</span></div>
        <div class="rc-brand"><div class="rc-logo" aria-hidden="true"></div><div class="rc-brandtext">reCAPTCHA</div><div class="rc-terms">Privacy - Terms</div></div>
      </div>
      <p class="lead-legal">When you schedule a call, you agree to be contacted by Intuit about related products and services. See the <a href="https://www.intuit.com/privacy/statement/">Global Privacy Statement</a> for details.</p>
      <button class="btn btn-primary lead-submit" type="button">Schedule a call</button>
    </div>`;
  return wrap;
}

export default function decorate(block) {
  const isForm = block.classList.contains('form');
  const rows = [...block.children];

  const copy = document.createElement('div');
  copy.className = 'hero-copy';
  let mediaEl = null;

  rows.forEach((row) => {
    const cell = row.firstElementChild;
    if (!cell) return;
    const pic = cell.querySelector('picture, img');
    if (pic && cell.textContent.trim() === '') {
      mediaEl = cell.querySelector('picture') || pic;
      return;
    }
    [...cell.childNodes].forEach((n) => copy.append(n));
  });

  // classify copy children
  const heading = copy.querySelector('h1, h2, h3');
  const ctaParas = [];
  copy.querySelectorAll('p').forEach((p) => {
    if (p.querySelector('a')) { ctaParas.push(p); return; }
    if (heading && p.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING) {
      p.classList.add('eyebrow', 'hero-eyebrow');
    } else {
      p.classList.add('hero-lede');
    }
  });

  // Buttonize CTAs ourselves so it works whether or not the global decorator
  // fired (two links in one <p> is not buttonized by vanilla EDS). <strong> =>
  // primary, <em> => secondary; collect all CTAs into one .hero-actions row.
  if (ctaParas.length) {
    const actions = document.createElement('p');
    actions.className = 'button-wrapper hero-actions';
    ctaParas.forEach((p) => {
      p.querySelectorAll('a').forEach((a) => {
        const wrap = a.closest('strong, em');
        const variant = wrap && wrap.tagName === 'EM' ? 'secondary' : 'primary';
        a.classList.add('button', variant);
        actions.append(a);
      });
    });
    ctaParas[0].replaceWith(actions);
    ctaParas.slice(1).forEach((p) => p.remove());
  }

  const grid = document.createElement('div');
  grid.className = 'hero-grid';
  grid.append(copy);

  if (isForm) {
    grid.append(leadCard());
  } else if (mediaEl) {
    const media = document.createElement('div');
    media.className = 'hero-media';
    media.append(mediaEl);
    grid.append(media);
  }

  block.replaceChildren(grid);
}
