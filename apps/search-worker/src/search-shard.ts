// How an engine call picks a search Container instance.
//
// A Container-backed Durable Object runs ONE container instance per Durable Object id, so a worker only
// reaches the capacity it has configured if it addresses that many distinct names. Search shards by
// FIRM rather than by request, and that is not the same choice the scan worker makes for a reason worth
// stating: a scan is stateless, so spreading it wide is pure parallelism, while a search instance's
// value is the splits it is already holding open. Sending one firm's queries to one instance is what
// makes the warm engine mean anything; spreading them would give every query a cold searcher and a
// second copy of the same working set.
//
// It is a routing preference, never an isolation boundary. Two firms can share an instance, and nothing
// about correctness rests on them not doing so: a call reaches only the split keys the app Worker named
// and only through a capability token minted for that one firm's corpus, so the engine cannot read a
// firm's bytes because it happened to answer that firm's neighbour.

// MUST match `containers[0].max_instances` in wrangler.jsonc: fewer shards leaves paid-for capacity
// unreachable, more shards addresses instances the platform will refuse to start. Changed together.
export const SEARCH_SHARD_COUNT = 3;

function shardName(index: number): string {
  return `search-${index}`;
}

// The instance a call with no firm uses, and the one the warm-poke cron keeps resident. One shard is
// warmed rather than all of them: warming the fleet bills every instance's memory continuously for
// capacity that scales to zero on its own, and the cold ones come up under real load.
export const SEARCH_PRIMARY_SHARD_NAME = shardName(0);

// FNV-1a (32-bit): a tiny, dependency-free, well-distributed non-cryptographic hash. Nothing here is a
// security boundary — the only requirement is that the same firm always maps to the same instance and
// that unrelated firms spread evenly.
function fnv1aHash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// The instance for one firm's engine call. A firm hashes to a fixed instance so its working set
// accumulates in one place; no firm (a health poke, or a body the engine will reject anyway) uses the
// warm primary rather than a random one — waking a cold instance to answer a probe is the one thing a
// probe must not do.
export function searchShardNameForFirm(firmId: string | null): string {
  if (firmId === null || firmId === "") return SEARCH_PRIMARY_SHARD_NAME;
  return shardName(fnv1aHash32(firmId) % SEARCH_SHARD_COUNT);
}
