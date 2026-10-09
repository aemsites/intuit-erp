import { vi } from 'vitest';

export { ReadableStream } from 'node:stream/web';
export { TextEncoder } from 'node:util';

export const httpRequest = vi.fn();
export const createResponse = vi.fn((status, headers, body) => ({ status, headers, body }));
export const logger = { log: vi.fn() };
