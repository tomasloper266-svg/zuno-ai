import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Test-only configuration overrides. No real secrets or endpoints here:
          // AI_BASE_URL points the adapter at a mocked upstream host.
          vars: {
            AI_PROVIDER: "gemini",
            AI_MODEL: "gemini-test",
            AI_API_KEY: "test-key",
            AI_BASE_URL: "https://gemini.mock.test",
            ALLOWED_ORIGINS: "https://app.example.test,https://other.example.test",
          },
        },
      },
    },
  },
})
