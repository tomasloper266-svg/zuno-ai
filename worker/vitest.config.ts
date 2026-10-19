import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

/**
 * The pool reads wrangler.toml with the dedicated "test" environment
 * (see [env.test] in wrangler.toml): fixture vars, local D1, mocked provider
 * endpoint. Test config lives there because miniflare var overrides are
 * ignored when a wrangler config is in play — [env.test] is the single source
 * of truth. "test-key" is a dummy fixture, never a real credential.
 */
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml", environment: "test" },
      },
    },
  },
})
