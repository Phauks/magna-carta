// How a scan request picks a scan Container instance.
//
// A Container-backed Durable Object runs ONE container instance per DO id, so the worker only ever
// reaches the container capacity it has configured if it addresses that many distinct DO names. A
// single hard-coded name means a single instance no matter how many the platform is allowed to start,
// and every concurrent scan queues behind it. Requests are therefore spread over a fixed set of shard
// names, one per allowed instance.

// MUST match `containers[0].max_instances` in wrangler.jsonc: fewer shards leaves paid-for capacity
// unreachable, more shards addresses instances the platform will refuse to start (those requests would
// wait behind a shard that can never come up). The two are changed together.
export const SCAN_SHARD_COUNT = 5;

// The query parameter carrying the caller's stable per-file key. The app worker's scan adapter sets it
// from the file version's storage key, so every attempt at the same file — including a queue retry —
// lands on the same shard and reuses whatever that instance has already warmed.
export const SHARD_KEY_QUERY_PARAMETER = "shardKey";

function shardName(index: number): string {
  return `scan-${index}`;
}

// The shard every request that is not a file scan uses, and the one the warm-poke cron keeps resident.
// The score histogram is engine-global metadata baked into the image (identical on every instance) and
// a file-type identify is a head-bytes sniff — neither needs the scan fan-out, and both are far better
// served by the instance most likely to already be running than by waking a cold one.
export const SCAN_PRIMARY_SHARD_NAME = shardName(0);

// FNV-1a (32-bit): a tiny, dependency-free, well-distributed non-cryptographic hash. Nothing here is a
// security boundary — the only requirement is that the same key always maps to the same shard and that
// unrelated keys spread evenly.
function fnv1aHash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// The shard name for a scan. A key hashes to a fixed shard (deterministic per file: a retry re-scans on
// the same instance). No key — a caller with nothing stable to hash, such as an ad-hoc diagnostic
// upload — picks a shard at random rather than defaulting to a fixed one, so a caller that omits the
// key can never collapse the whole fleet back onto a single instance.
// A keyless scan goes to the PRIMARY shard — the one instance the warm-poke keeps resident — and
// not to a random one. This used to pick at random, which under light load sent four scans in five
// to a shard that had scaled to zero: each paid the container's cold start (tens of seconds, and a
// 500 from the engine until clamd's signature database was loaded), the ingest queue retried, and
// a member watched their upload sit at "Checking the file" for minutes. The interactive ingest lane
// sends no key for exactly that reason; the bulk lane keeps its key, because there the fan-out over
// every instance is the throughput, and a cold start amortises over a migration.
export function scanShardName(shardKey: string | null): string {
  if (shardKey === null || shardKey === "") return SCAN_PRIMARY_SHARD_NAME;
  return shardName(fnv1aHash32(shardKey) % SCAN_SHARD_COUNT);
}

// The shard for an incoming request, read from its query string.
export function scanShardNameForRequest(url: URL): string {
  return scanShardName(url.searchParams.get(SHARD_KEY_QUERY_PARAMETER));
}
