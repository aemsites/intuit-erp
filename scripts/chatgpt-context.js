/**
 * Captures the `q` query param on /construction as ChatGPT conversation
 * context and stores it in localStorage for the of1-preview-extension's
 * content script to read from the page later.
 */
const STORAGE_KEY = 'of1_chatgpt_context';

export default function captureChatgptContext() {
  const q = new URLSearchParams(window.location.search).get('q');
  if (!q) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, q);
  } catch (e) {
    // localStorage unavailable (private mode, quota, etc.) — do nothing
  }
}
