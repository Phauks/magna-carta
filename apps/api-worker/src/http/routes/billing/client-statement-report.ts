import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  ClientStatementLine,
  ClientStatementTotals,
  ClientStatementUnpaidInvoice,
} from "@magna-carta/reporting/contract";
import { assembleClientStatement } from "@magna-carta/reporting/financial/client-statement";
import { ReportingValidationError } from "@magna-carta/reporting/reporting-validation";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { reportingRefusal } from "./financial-reports.ts";
import {
  civilDate,
  knowledgeInstant,
  ReportCompleteness,
  ReportReproducibility,
} from "./reports.ts";

// ONE CLIENT'S STATEMENT OF ACCOUNT — what they owed the day before a period, every bill and every
// application against their bills in it with the balance after each, what they owed at its end, and
// the bills still unpaid then.
//
// A GET on `reports:financial`, over billing's append-only records: a period on the effective axis
// and an optional knowledge instant. The client is a directory person or organization, named by its
// handle; a malformed handle is refused before anything is read.

const clientStatementQuery = z.object({
  clientEntityId: z.union([
    identifierField("directoryPerson"),
    identifierField("directoryOrganization"),
  ]),
  periodStart: civilDate,
  periodEnd: civilDate,
  // Omitted, the statement covers everything known now: stamped, and not claimed to reproduce.
  knownAsOf: knowledgeInstant.optional(),
});

const ClientStatementResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    clientEntityId: z.string(),
    clientName: z.string().nullable(),
    currency: z.literal("USD"),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    completeness: ReportCompleteness,
    totals: ClientStatementTotals,
    activity: z.array(ClientStatementLine),
    unpaidInvoices: z.array(ClientStatementUnpaidInvoice),
  })
  .openapi("ClientStatementReport");

const clientStatementMeta: RouteMeta = {
  operationId: "reports.clientStatement",
  surface: "app",
  authenticated: true,
  permission: "reports:financial",
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const clientStatementRoute = defineOpenAPIRoute(clientStatementMeta, {
  method: "get",
  path: "/api/v1/reports/client-statement",
  description:
    "One client's statement of account over a period: what the client owed at the end of the day before it starts, every bill issued to the client in it and everything set against the client's bills in it (payments, transfers from trust, client credits, credit notes, write-offs, and the reversal of any of them as its own line naming what it reverses), each with the balance after it, what the client owed at the period's last day, and the bills still unpaid then. The balances are the aging's, so the closing balance is the client's total in the Accounts Receivable Aging report at that date. Give a knowledge instant and every figure re-derives from records that can never change; omit it and the answer covers everything known now, which is stamped and not claimed to reproduce.",
  request: { query: clientStatementQuery },
  responses: {
    200: {
      description: "The client's statement of account for this period",
      content: { "application/json": { schema: ClientStatementResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks reports:financial",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description:
        "The client is not a directory person or organization handle, the period is not two calendar dates or ends before it starts, the knowledge instant is not a UTC instant or is in the future, or the client has more bills or applications than one statement can list",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerClientStatementReportRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...clientStatementRoute,
      middleware: chokepointMiddleware(chokepoint, clientStatementRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleClientStatement(
          firm.firmDatabase,
          {
            clientEntityId: query.clientEntityId,
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            knownAsOf: query.knownAsOf ?? null,
          },
          { computedAt },
        );
        // The report's arrays are `readonly` and the contract's are not; the response schema is what
        // the contract asserts, and the conformance suite checks it against the emitted document.
        return c.json(report as unknown as z.infer<typeof ClientStatementResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
