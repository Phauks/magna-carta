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

// `fields` may not redeclare `remoteId`/`raw`: those are the invariant base the boundary guarantees,
// and a spread override would silently weaken them. `raw` is the preserved vendor payload and is
// intentionally unvalidated (`z.unknown()`) — a consumer that reaches into it bypasses the boundary.
// The forbidden-keys constraint lives on the *parameter* (`fields`), not on `Shape` itself, so
// `Shape` is inferred clean and the output type carries `remoteId: string`, `raw?: unknown`, and the
// caller's fields — never `never`. The internal cast strips the intersection before the spread so
// the compiler does not widen the return type with the `{ remoteId?: never; raw?: never }` half.
export function canonicalRecordSchema<Shape extends z.ZodRawShape>(
  fields: Shape & { remoteId?: never; raw?: never },
) {
  return z.object({ ...BASE_SHAPE, ...(fields as Shape) });
}
