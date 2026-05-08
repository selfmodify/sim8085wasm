import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// Automatically unmount React trees after every test to keep them isolated
afterEach(() => {
  cleanup();
});