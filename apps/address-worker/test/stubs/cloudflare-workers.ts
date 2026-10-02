// A stand-in for `cloudflare:workers`, which only the Workers runtime provides. `@cloudflare/containers`
// imports its two base classes from that module, and the tests that need the library's own dispatch
// (test/address-containers.test.ts, test/worker.test.ts) run in the node pool, where the scheme
// resolves to nothing. The classes under test never run a container here, so the two base classes hold
// what the runtime would hand them and nothing more. Wired to the scheme by vitest.config.ts.
export class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}

export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  constructor(
    readonly ctx: { props: Props },
    readonly env: Env,
  ) {}
}
