import { defineConfig } from 'vitest/config'

/**
 * Node-only: everything under test here is the CPU side of the pipeline —
 * matrix maths, binary parsers, LUT construction. The GPU passes are verified
 * by driving the real app in a browser, not from here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
