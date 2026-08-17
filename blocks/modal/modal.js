// eslint-disable-next-line import/no-cycle
import { loadFragment } from '../fragment/fragment.js';
import {
  buildBlock, decorateBlock, loadBlock, loadCSS, loadSections,
} from '../../scripts/aem.js';

// Fragments are fetched once and reused across opens; each open clones the
// cached copy (loadFragment has no cache of its own).
const fragmentCache = new Map();

// Not a decorated block: links to a /modals/ path are turned into modals, and
// other code opens modals via createModal()/openModal(). Adapted from the AEM
// Block Collection modal block.

export async function createModal(contentNodes) {
  await loadCSS(`${window.hlx.codeBasePath}/blocks/modal/modal.css`);
  const dialog = document.createElement('dialog');
  const dialogContent = document.createElement('div');
  dialogContent.classList.add('modal-content');
  dialogContent.append(...contentNodes);
  dialog.append(dialogContent);

  const closeButton = document.createElement('button');
  closeButton.classList.add('close-button');
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.type = 'button';
  closeButton.innerHTML = '<span class="icon icon-close"></span>';
  closeButton.addEventListener('click', () => dialog.close());
  dialog.prepend(closeButton);

  // Wrap the block in its own div so decorateBlock() adds `modal-wrapper` to the
  // wrapper, not to <main> (which would permanently pollute main's classList).
  const block = buildBlock('modal', '');
  const wrapper = document.createElement('div');
  wrapper.append(block);
  document.querySelector('main').append(wrapper);
  decorateBlock(block);
  await loadBlock(block);

  // close on click outside the dialog
  dialog.addEventListener('click', (e) => {
    const {
      left, right, top, bottom,
    } = dialog.getBoundingClientRect();
    if (e.clientX < left || e.clientX > right || e.clientY < top || e.clientY > bottom) {
      dialog.close();
    }
  });

  let previouslyFocused;
  dialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
    wrapper.remove();
    // Restore focus to whatever opened the modal (a11y).
    if (previouslyFocused?.focus) previouslyFocused.focus();
  });

  block.innerHTML = '';
  block.append(dialog);

  return {
    block,
    showModal: () => {
      previouslyFocused = document.activeElement;
      dialog.showModal();
      setTimeout(() => { dialogContent.scrollTop = 0; }, 0);
      document.body.classList.add('modal-open');
    },
  };
}

export async function openModal(fragmentUrl) {
  const path = fragmentUrl.startsWith('http')
    ? new URL(fragmentUrl, window.location).pathname
    : fragmentUrl;

  let fragment = fragmentCache.get(path);
  if (fragment === undefined) {
    fragment = await loadFragment(path);
    // Cache only a successful load, so a failed fetch can be retried on reopen.
    if (fragment) fragmentCache.set(path, fragment);
  }
  if (!fragment) {
    // Fragment fetch failed (404/network) — show a fallback instead of throwing.
    const error = document.createElement('p');
    error.className = 'modal-error';
    error.textContent = 'Sorry, something went wrong loading this content. Please try again.';
    const { showModal } = await createModal([error]);
    showModal();
    return;
  }

  // Clone so the cached fragment keeps its content for the next open. cloneNode
  // copies DOM + attributes but not JS-attached listeners, so re-decorate the
  // clones: reset the "loaded" block/section status the cache carries back to
  // "initialized" so loadSections re-runs each block's decorate() and rebinds.
  const clones = [...fragment.childNodes].map((node) => node.cloneNode(true));
  const { block, showModal } = await createModal(clones);
  block.querySelectorAll('[data-block-status]').forEach((b) => { b.dataset.blockStatus = 'initialized'; });
  block.querySelectorAll('.section[data-section-status]').forEach((s) => { s.dataset.sectionStatus = 'initialized'; });
  await loadSections(block);
  showModal();
}
