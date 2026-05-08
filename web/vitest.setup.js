import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Unmount React trees after every test
afterEach(() => {
  cleanup();
});

// Stub navigator.clipboard so useCopy doesn't throw in happy-dom
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: vi.fn(() => Promise.resolve()) },
  configurable: true,
});
