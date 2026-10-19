/**
 * Type augmentation for the vitest-pool-workers runtime env: the `env`
 * exported by "cloudflare:test" carries the same bindings as production
 * (D1 + vars from vitest.config.ts / wrangler.toml).
 */
import type { Env } from "../src/env"

declare module "cloudflare:test" {
  // Empty extension is the documented augmentation shape: the point is to
  // bind ProvidedEnv to our Env, not to add members.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
