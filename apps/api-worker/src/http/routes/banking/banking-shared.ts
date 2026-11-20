import type { OpenAPIHono } from "@hono/zod-openapi";
import type { BankFeedPort } from "@magna-carta/bank-feeds/port";
import type { Bindings } from "../../../bindings.ts";
import { resolveBankFeedPort } from "../../../banking/bank-feed-engine.ts";
import type { CredentialStoreForFirm } from "../../../plugins/credential-store.ts";
import { integrationCredentialStoreForFirm } from "../../../plugins/credential-store.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { Problem } from "../../contracts/problem.ts";
import type { RouteMeta } from "../../contracts/route-meta.ts";

// What the Banking routes share: their seams, their permissions, and their error shapes.

export type BankingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

/** The seams tests inject fakes through. Production passes nothing. */
export interface BankingRouteDeps {
  readonly port?: (env: Bindings) => BankFeedPort;
  readonly credentialStoreForFirm?: CredentialStoreForFirm;
  readonly now?: () => Date;
}

export interface ResolvedBankingDeps {
  readonly port: (env: Bindings) => BankFeedPort;
  readonly credentialStoreForFirm: CredentialStoreForFirm;
  readonly now: () => Date;
}

export function resolveBankingDeps(deps: BankingRouteDeps): ResolvedBankingDeps {
  return {
    port: deps.port ?? resolveBankFeedPort,
    credentialStoreForFirm: deps.credentialStoreForFirm ?? integrationCredentialStoreForFirm,
    now: deps.now ?? (() => new Date()),
  };
}

export const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

export const readMeta = (operationId: string): RouteMeta => ({
  operationId,
  surface: "app",
  authenticated: true,
  permission: "banking:read",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
});

export const manageMeta = (operationId: string, idempotency: "required" | "optional"): RouteMeta => ({
  operationId,
  surface: "app",
  authenticated: true,
  permission: "banking:manage",
  resource: "firm",
  audited: true,
  idempotency,
  ...(idempotency === "required" ? { idempotencyStore: "firm" as const } : {}),
  rateLimit: "default",
});
