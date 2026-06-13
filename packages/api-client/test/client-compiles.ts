// The "generated client compiles" gate. This file is compile-only: it
// has no runtime assertions and is never executed (api-client has no test runner); `vp check`'s tsc
// is the gate. It imports the generated Svelte Query factories through the package's single "."
// export and instantiates them, so a regeneration that breaks the public surface fails CI here — and
// it proves the tsc-stays-flat guarantee (no Hono `hc` whole-app inference): the factory
// names are stable domain methods (meGet…, membersInvite…), keyed off the native operationId.
import { meGetOptions, membersInviteMutation, type MeResponse } from "@magna-carta/api-client";

// A query-options factory call typechecks and yields a TanStack queryOptions object.
const meOptions = meGetOptions();
// A mutation-options factory call typechecks.
const inviteMutation = membersInviteMutation();
// The response component type is reachable through the barrel.
const sampleResponse: MeResponse["permissions"] = [];

export const __compileCheck = { meOptions, inviteMutation, sampleResponse };
