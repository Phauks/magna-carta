// Negative-compile assertions for identifierPathParam's brand: exercised by the typechecker
// (pnpm check), not by Vitest — the pattern from problem-status.ts and
// packages/access-control/test/brand-types.ts. The helper promises that a validated path param
// carries the entity's branded identifier type; these assertions pin that the brand actually
// flows out of route inference and that it stays entity-specific.
import { z } from "@hono/zod-openapi";
import type { DocumentId, MatterId } from "@magna-carta/identifiers/types";
import { identifierPathParam } from "../../src/http/contracts/common";

const matterParams = z.object({ matterId: identifierPathParam("matter", "matterId") });
type InferredMatterParams = z.infer<typeof matterParams>;

declare const inferredParams: InferredMatterParams;
declare const rawString: string;
declare const documentIdentifier: DocumentId;

// POSITIVE control: the inferred param type is the branded matter identifier.
export const inferredAsBranded: MatterId = inferredParams.matterId;

// POSITIVE control: a branded identifier flows into a plain string (DB values, URLs, logs).
export const asString: string = inferredParams.matterId;

// @ts-expect-error - a raw string must not be assignable to the inferred param type without
// going through validation (the brand is the whole point)
export const rawAsParam: InferredMatterParams = { matterId: rawString };

// @ts-expect-error - a different entity's identifier (document) must not be assignable to the
// matter param — brands are keyed by the entity literal and are mutually non-assignable
export const wrongEntity: InferredMatterParams = { matterId: documentIdentifier };
