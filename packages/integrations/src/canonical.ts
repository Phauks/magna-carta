import { z } from "zod";

// Every canonical record carries the vendor-native id (`remoteId`) plus an opt-in untouched vendor
// payload (`raw`) — normalization never silently destroys data the caller might need. A port builds
// its canonical schema from this base so the boundary is validated (external data is untrusted): an
// adapter that produced a malformed record is rejected here, not let into the domain.
export interface CanonicalRecord {
  readonly remoteId: string;
  readonly raw?: unknown;
}

const BASE_SHAPE = {
  remoteId: z.string().min(1),
  raw: z.unknown().optional(),
};

// `Shape` may not redeclare `remoteId`/`raw`: those are the invariant base the boundary guarantees,
// and a spread override would silently weaken them. `raw` is the preserved vendor payload and is
// intentionally unvalidated (`z.unknown()`) — a consumer that reaches into it bypasses the boundary.
export function canonicalRecordSchema<
  Shape extends z.ZodRawShape & { remoteId?: never; raw?: never },
>(fields: Shape) {
  return z.object({ ...BASE_SHAPE, ...fields });
}
