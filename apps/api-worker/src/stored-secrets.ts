import { DurableObject } from "cloudflare:workers";
import { resolveStoredSecrets } from "@magna-carta/worker-secrets/stored-secrets";
import type { Bindings } from "./bindings.ts";
import { API_WORKER_SECRET_NAMES } from "./stored-secret-names.ts";

export function resolveApiWorkerSecrets(env: Bindings): Promise<Bindings> {
  return resolveStoredSecrets(env, API_WORKER_SECRET_NAMES);
}

// The base every Durable Object here extends instead of DurableObject. The runtime hands a Durable
// Object the raw environment, so a secret bound from the store would reach it as a binding, not a
// string; this resolves them before any call is delivered. A subclass whose own constructor starts
// work that reads a secret awaits `storedSecretsReady` first, because blockConcurrencyWhile holds
// back calls, not other constructor work.
export abstract class StoredSecretsDurableObject extends DurableObject<Bindings> {
  protected readonly storedSecretsReady: Promise<void>;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.storedSecretsReady = ctx.blockConcurrencyWhile(async () => {
      this.env = await resolveApiWorkerSecrets(env);
    });
  }
}
