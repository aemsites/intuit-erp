/**
 * Shared breakpoint constants. Keep these in sync with the pixel values
 * documented in AGENTS.md and used across blocks/*.css — this is the single
 * place to update when a project-wide breakpoint changes.
 */
export const BP_TABLET = 768;
export const BP_DESKTOP = 1024;
export const BP_WIDE = 1200;
export const BP_XWIDE = 1440;

export const MQ_TABLET_UP = `(min-width: ${BP_TABLET}px)`;
export const MQ_DESKTOP_UP = `(min-width: ${BP_DESKTOP}px)`;
export const MQ_WIDE_UP = `(min-width: ${BP_WIDE}px)`;
export const MQ_XWIDE_UP = `(min-width: ${BP_XWIDE}px)`;
