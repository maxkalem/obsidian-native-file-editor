import { defineConfig } from "vitest/config";

/**
 * The e2e suite has no obsidian alias on purpose: nothing it runs may import
 * the plugin API. It drives the transports and the format layer against real
 * files under tests/e2e/fixtures.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.ts"],
    environment: "node",
  },
});
