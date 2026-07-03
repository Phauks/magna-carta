// The operator-owned status:authored KV document: read-modify-write helpers shared by every
// platform-status write route (declare / post-update / resolve). The cron sweep owns a DIFFERENT
// key (status:derived — see @magna-carta/status), so there is no cross-writer race; concurrent
// operator writes are rare (a single small operator team) and last-write-wins on this one key is
// acceptable for v1.
import { type AuthoredSnapshot, parseAuthored, STATUS_KV_KEYS } from "@magna-carta/status";

export async function readAuthored(kv: KVNamespace, now: string): Promise<AuthoredSnapshot> {
  return parseAuthored(await kv.get(STATUS_KV_KEYS.authored), now);
}

export async function mutateAuthored(
  kv: KVNamespace,
  now: string,
  mutate: (current: AuthoredSnapshot) => AuthoredSnapshot,
): Promise<AuthoredSnapshot> {
  const current = await readAuthored(kv, now);
  const next = { ...mutate(current), updatedAt: now };
  await kv.put(STATUS_KV_KEYS.authored, JSON.stringify(next));
  return next;
}
