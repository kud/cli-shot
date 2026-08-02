import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // These spawn real processes and rasterise PNGs through freeze; 5s is a
    // unit-test budget and fails on a loaded machine or a cold font cache,
    // neither of which is a regression.
    testTimeout: 30_000,
  },
})
