import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { identifierField } from "@magna-carta/identifiers/field";
import {
  AppliedClientRow,
  AppliedEntry,
  AppliedFigures,
  AppliedOfficeRow,
  InvoiceClientRow,
  InvoiceFigures,
  InvoiceOfficeRow,
  MatterBalanceClientRow,
  MatterBalanceFigures,
  MatterBalanceOfficeRow,
} from "@magna-carta/reporting/contract";
import { assembleInvoiceRegister } from "@magna-carta/reporting/financial/invoice-register";
import { assembleMatterBalances } from "@magna-carta/reporting/financial/matter-balances";
import { assemblePaymentsApplied } from "@magna-carta/reporting/financial/payments-applied";
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

// THE BILLS AND WHAT WAS SET AGAINST THEM — the Invoices report and the Payments Applied report —
// and where each matter stands: the Matter Balances report.
//
// All are GETs on `reports:financial`. The first two take a period on the effective axis and an
// optional knowledge instant; Matter Balances is live and takes neither. The office is a filter on the
// rows and never a gate on who may run the report.

const periodQuery = z.object({
  periodStart: civilDate,
  periodEnd: civilDate,
  // Omitted, the report covers everything known now: stamped, and not claimed to reproduce.
  knownAsOf: knowledgeInstant.optional(),
  locationId: identifierField("location").optional(),
});

// Deliberately no date and no knowledge instant: unbilled work is live, so accepting one would answer
// a question about the past with a figure about the present.
const matterBalancesQuery = z.object({ locationId: identifierField("location").optional() });

const InvoicesResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    locationId: z.string().nullable(),
    currency: z.literal("USD"),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    completeness: ReportCompleteness,
    totals: InvoiceFigures,
    offices: z.array(InvoiceOfficeRow),
    clients: z.array(InvoiceClientRow),
  })
  .openapi("InvoicesReport");

const PaymentsAppliedResponse = z
  .object({
    periodStart: z.string(),
    periodEnd: z.string(),
    locationId: z.string().nullable(),
    currency: z.literal("USD"),
    reproducibility: ReportReproducibility,
    reproducibilityStatement: z.string(),
    completeness: ReportCompleteness,
    totals: AppliedFigures,
    offices: z.array(AppliedOfficeRow),
    clients: z.array(AppliedClientRow),
    entries: z.array(AppliedEntry),
  })
  .openapi("PaymentsAppliedReport");

const MatterBalancesResponse = z
  .object({
    computedAt: z.string(),
    asOfDate: z.string(),
    reproducible: z.literal(false),
    statement: z.string(),
    locationId: z.string().nullable(),
    currency: z.literal("USD"),
    completeness: ReportCompleteness,
    totals: MatterBalanceFigures,
    offices: z.array(MatterBalanceOfficeRow),
    clients: z.array(MatterBalanceClientRow),
  })
  .openapi("MatterBalancesReport");

const invoicesMeta: RouteMeta = {
  operationId: "reports.invoices",
  surface: "app",
  authenticated: true,
  permission: "reports:financial",
  resource: "firm",
  // A read audits nothing: it changes nothing a firm could later need to reconstruct.
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const refusals = {
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
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
} as const;

const invoicesRoute = defineOpenAPIRoute(invoicesMeta, {
  method: "get",
  path: "/api/v1/reports/invoices",
  description:
    "Every bill issued in a period, by office and client, with each bill's matters: what was billed, what was credited or written off and what was applied against it by the period's last day, and what was still unpaid then. Give a knowledge instant and every figure re-derives from records that can never change; omit it and the answer covers everything known now, which is stamped and not claimed to reproduce. Choosing an office narrows the rows; it does not limit who may run the report.",
  request: { query: periodQuery },
  responses: {
    200: {
      description: "The bills issued in this period",
      content: { "application/json": { schema: InvoicesResponse } },
    },
    ...refusals,
    422: {
      description:
        "The period is not two calendar dates or ends before it starts, the knowledge instant is not a UTC instant or is in the future, or more bills were issued than one report can list",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

const paymentsAppliedRoute = defineOpenAPIRoute(
  { ...invoicesMeta, operationId: "reports.paymentsApplied" },
  {
    method: "get",
    path: "/api/v1/reports/payments-applied",
    description:
      "Everything set against a bill in a period, one entry each: payments, transfers from trust, client credits, credit notes, write-offs, and the reversal of any of them as its own negative entry naming what it reverses. Totals by kind, office and client. Applied, not received: the platform records what was set against a bill, not cash arriving. Give a knowledge instant and the report re-derives from records that can never change. Choosing an office narrows the rows; it does not limit who may run the report.",
    request: { query: periodQuery },
    responses: {
      200: {
        description: "What was applied to bills in this period",
        content: { "application/json": { schema: PaymentsAppliedResponse } },
      },
      ...refusals,
      422: {
        description:
          "The period is not two calendar dates or ends before it starts, the knowledge instant is not a UTC instant or is in the future, or more was applied than one report can list",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

const matterBalancesRoute = defineOpenAPIRoute(
  { ...invoicesMeta, operationId: "reports.matterBalances" },
  {
    method: "get",
    path: "/api/v1/reports/matter-balances",
    description:
      "Where each matter stands now, by office and client: its unbilled time and costs, what its bills still owe, and what the firm holds for it in trust, three figures never added together. A live report: it takes no date, says when it was computed, and is not claimed to reproduce. Bills, payments and trust money count through the day it is produced. Choosing an office narrows the rows; it does not limit who may run the report.",
    request: { query: matterBalancesQuery },
    responses: {
      200: {
        description: "Each matter's balances now",
        content: { "application/json": { schema: MatterBalancesResponse } },
      },
      ...refusals,
      422: {
        description:
          "More matters have a balance than one report can list, or a trust account in a currency other than US dollars holds money for a matter",
        content: { "application/problem+json": { schema: Problem } },
      },
    },
  },
);

type ReportsApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerReceivablesReportsRoutes(app: ReportsApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...invoicesRoute, middleware: chokepointMiddleware(chokepoint, invoicesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      // Read per request, so a long-lived isolate cannot freeze it.
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleInvoiceRegister(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            knownAsOf: query.knownAsOf ?? null,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        // The report's arrays are `readonly` and the contract's are not; the response schema is what
        // the contract asserts, and the conformance suite checks it against the emitted document.
        return c.json(report as unknown as z.infer<typeof InvoicesResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...paymentsAppliedRoute, middleware: chokepointMiddleware(chokepoint, paymentsAppliedRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assemblePaymentsApplied(
          firm.firmDatabase,
          {
            periodStart: query.periodStart,
            periodEnd: query.periodEnd,
            knownAsOf: query.knownAsOf ?? null,
            locationId: query.locationId ?? null,
          },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof PaymentsAppliedResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );

  app.openapi(
    { ...matterBalancesRoute, middleware: chokepointMiddleware(chokepoint, matterBalancesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const query = c.req.valid("query");
      const computedAt = new Date().toISOString();
      try {
        const report = await assembleMatterBalances(
          firm.firmDatabase,
          { locationId: query.locationId ?? null },
          { computedAt },
        );
        return c.json(report as unknown as z.infer<typeof MatterBalancesResponse>, 200);
      } catch (caught) {
        if (caught instanceof ReportingValidationError) return reportingRefusal(c, caught);
        throw caught;
      }
    },
  );
}
