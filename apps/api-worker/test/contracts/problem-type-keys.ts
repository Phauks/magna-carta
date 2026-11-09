// Negative-compile assertions for the problem-type registry: exercised by the typechecker
// (pnpm check), not by Vitest — the pattern from packages/access-control/test/brand-types.ts.
import { problemType, type ProblemTypeKey } from "../../src/http/contracts/problem-types";

// @ts-expect-error - an unknown problem-type key must not compile; the registry is closed
export const unknownKey: string = problemType("nonexistent-problem");

// @ts-expect-error - a runtime string is not a ProblemTypeKey without narrowing
export const rawString: ProblemTypeKey = "validation" as string;

// POSITIVE control: every registered key compiles and yields a string URI.
export const validationUri: string = problemType("validation");
export const idempotencyConflictUri: string = problemType("idempotency-key-conflict");
