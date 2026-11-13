// A Worker's secrets can live in two places: on the Worker itself (a per-Worker secret, a plain
// string on `env`), or in the account's Cloudflare Secrets Store, bound to the Worker as an object
// whose value is fetched with `await binding.get()`. Every reader in this codebase expects a string,
// synchronously, so each Worker resolves its store bindings ONCE at its entry (the fetch, queue and
// scheduled handlers, and each Durable Object's constructor) and hands the rest of the program an
// environment in which every secret is a plain string again, or absent.
//
// Where a secret is looked for, in order:
//   1. a store binding named `SECRETS_STORE_<NAME>` (the name committed in wrangler.jsonc);
//   2. a store binding bound under the plain `<NAME>` (what the dashboard's "Add binding" produces
//      when the variable name is typed as the secret's own name);
//   3. a per-Worker secret `<NAME>`.
// The first that yields a non-empty string wins. The separate `SECRETS_STORE_` name is what lets a
// secret move with no gap: the store binding is added while the per-Worker copy still exists (two
// bindings cannot share one name), the store copy takes over, and the per-Worker copy is deleted
// afterwards. A store binding whose secret cannot be read (deleted, renamed, not scoped to Workers)
// falls through to the per-Worker copy rather than failing the request, and is reported by
// `secretSourcesOf` as not coming from the store, which is what the System Status page shows.
//
// Values are kept per isolate for a few minutes, so a request does not pay a store round-trip per
// secret. A value changed in the store therefore reaches a warm isolate within that window, not at
// once. The value is never logged, never put in an error, and never leaves the returned environment.

export const SECRETS_STORE_BINDING_PREFIX = "SECRETS_STORE_";

// How long one isolate keeps a value it read from the store. A failed read is kept for less, so a
// secret created after the Worker started is picked up soon after.
const STORED_VALUE_LIFETIME_MILLISECONDS = 5 * 60 * 1000;
const FAILED_READ_LIFETIME_MILLISECONDS = 30 * 1000;

export type SecretSource = "secrets-store" | "worker" | "absent";

type StoreBinding = { get(): Promise<string> };

type CachedRead = { readonly value: Promise<string | undefined>; expiresAt: number };

const cachedReads = new WeakMap<StoreBinding, CachedRead>();

// The resolved environment remembers where each of its secrets came from.
const sourcesByEnvironment = new WeakMap<object, Readonly<Record<string, SecretSource>>>();

// The last resolution of each raw environment, so an unchanged one returns the same object.
const previousResolution = new WeakMap<
  object,
  {
    readonly names: readonly string[];
    readonly storeValues: readonly (string | undefined)[];
    readonly resolved: object;
  }
>();

// Only ever asked of a binding at a secret's own name, so anything there with a get() is taken for a
// store binding. Nothing narrower is safe: locally the binding is an RPC stub, on which every
// property reads as a function, so testing for the absence of another method would reject it.
export function isStoreBinding(value: unknown): value is StoreBinding {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { get?: unknown }).get === "function"
  );
}

function storeBindingsFor(environment: object, name: string): StoreBinding[] {
  const record = environment as Record<string, unknown>;
  const bindings: StoreBinding[] = [];
  const prefixed = record[`${SECRETS_STORE_BINDING_PREFIX}${name}`];
  if (isStoreBinding(prefixed)) bindings.push(prefixed);
  const plain = record[name];
  if (isStoreBinding(plain)) bindings.push(plain);
  return bindings;
}

function readStoreBinding(binding: StoreBinding, now: number): Promise<string | undefined> {
  const cached = cachedReads.get(binding);
  if (cached !== undefined && cached.expiresAt > now) return cached.value;
  const entry: CachedRead = {
    value: binding.get().then(
      (value) => (typeof value === "string" && value !== "" ? value : undefined),
      () => {
        // A read that failed is retried sooner than a value is refreshed. The reason is not kept: it
        // can name the secret, and a missing secret is reported by its source, not by an error.
        entry.expiresAt = Math.min(entry.expiresAt, Date.now() + FAILED_READ_LIFETIME_MILLISECONDS);
        return undefined;
      },
    ),
    expiresAt: now + STORED_VALUE_LIFETIME_MILLISECONDS,
  };
  cachedReads.set(binding, entry);
  return entry.value;
}

function workerValue(environment: object, name: string): string | undefined {
  const value = (environment as Record<string, unknown>)[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The environment with every named secret as a plain string (or absent), read from the Secrets
 * Store where a store binding exists and from the per-Worker secret otherwise. When no named secret
 * has a store binding, the SAME environment object is returned, untouched: a Worker that binds
 * nothing from the store pays nothing and behaves exactly as before.
 */
export async function resolveStoredSecrets<Environment extends object>(
  environment: Environment,
  names: readonly string[],
): Promise<Environment> {
  const now = Date.now();
  const withStore = names.filter((name) => storeBindingsFor(environment, name).length > 0);
  if (withStore.length === 0) return environment;

  const storeValues = await Promise.all(
    withStore.map(async (name) => {
      for (const binding of storeBindingsFor(environment, name)) {
        const value = await readStoreBinding(binding, now);
        if (value !== undefined) return value;
      }
      return undefined;
    }),
  );

  // Hand back the same resolved object for as long as the values stay the same. Workers key
  // per-environment caches on the environment's identity (the auth instance, the logger), and a
  // new object per request would rebuild them on every one.
  const previous = previousResolution.get(environment);
  if (
    previous !== undefined &&
    previous.names === names &&
    previous.storeValues.length === storeValues.length &&
    previous.storeValues.every((value, index) => value === storeValues[index])
  ) {
    return previous.resolved as Environment;
  }

  const resolved: Record<string, unknown> = { ...(environment as Record<string, unknown>) };
  const sources: Record<string, SecretSource> = {};
  for (const name of names) {
    const index = withStore.indexOf(name);
    const fromStore = index === -1 ? undefined : storeValues[index];
    if (fromStore !== undefined) {
      resolved[name] = fromStore;
      sources[name] = "secrets-store";
      continue;
    }
    const fromWorker = workerValue(environment, name);
    // A store binding under the plain name that could not be read must not reach a reader as an
    // object: every reader tests for a string, and an object would read as a configured secret.
    resolved[name] = fromWorker;
    sources[name] = fromWorker === undefined ? "absent" : "worker";
  }
  sourcesByEnvironment.set(resolved, sources);
  previousResolution.set(environment, { names, storeValues, resolved });
  return resolved as Environment;
}

/**
 * Where each named secret in an environment came from. On an environment `resolveStoredSecrets`
 * produced, this is what it found; on any other (a Worker with no store bindings, or a test's), a
 * string is a per-Worker secret and anything else is absent.
 */
export function secretSourcesOf(
  environment: object,
  names: readonly string[],
): Record<string, SecretSource> {
  const known = sourcesByEnvironment.get(environment);
  const sources: Record<string, SecretSource> = {};
  for (const name of names) {
    sources[name] =
      known?.[name] ?? (workerValue(environment, name) === undefined ? "absent" : "worker");
  }
  return sources;
}
