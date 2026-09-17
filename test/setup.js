// Global test setup (jsdom is configured via vitest.config.js).

// jsdom doesn't implement <dialog> interactivity (showModal/close) — stub the bare
// minimum so real code paths that call them (blocks/modal/modal.js) don't throw.
HTMLDialogElement.prototype.showModal ??= function showModal() { this.open = true; };
HTMLDialogElement.prototype.close ??= function close() {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};
