import {
  BillDetail,
  BoardResponse,
  CreatedResponse,
  PaymentsResponse,
  PayBillsRequest,
  RecordBillRequest,
  ReverseBillRequest,
  SetVendorDefaultAccountRequest,
  VendorDefaultAccountResponse,
  civilDateField,
  vendorIdField,
} from "@magna-carta/general-ledger/contract";
import { GeneralLedgerValidationError } from "@magna-carta/general-ledger/general-ledger-validation";
import {
  readVendorBill,
  readVendorBillBoard,
  readVendorDefaultAccount,
} from "@magna-carta/general-ledger/vendor-bill-reads";
import {
  payVendorBills,
  recordVendorBill,
  reverseVendorBill,
  setVendorDefaultAccount,
} from "@magna-carta/general-ledger/vendor-bills";
import { identifierField } from "@magna-carta/identifiers/field";
import { problemJson } from "../../contracts/problem.ts";
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointFirmContext } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader, identifierPathParam } from "../../contracts/common.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  booksErrors,
  booksReadErrors,
  booksReadMeta,
  booksToday,
  booksWriteMeta,
  commitBooksWrite,
} from "./operating-books-support.ts";

// VENDOR BILLS: the firm's own bills from the people it buys from, and paying them from any of its
// operating accounts. A line on a matter becomes an approved cost on that matter, which its next
// draft invoice picks up. Trust never pays a vendor bill.

type App = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const boardQuery = z.object({
  filter: z.enum(["unpaid", "paid", "all"]).optional(),
  vendorId: vendorIdField.optional(),
  matterId: identifierField("matter").optional(),
  asOf: civilDateField.optional(),
});
const asOfQuery = z.object({ asOf: civilDateField.optional() });
const vendorBillIdParam = z.object({
  vendorBillId: identifierPathParam("vendorBill", "vendorBillId"),
});
const vendorIdParam = z.object({
  vendorId: vendorIdField.openapi({ param: { name: "vendorId", in: "path" } }),
});

const boardRoute = defineOpenAPIRoute(booksReadMeta("payables.board"), {
  method: "get",
  path: "/api/v1/payables/bills",
  description:
    "Vendor bills grouped by vendor, with each vendor's open amount by age and the totals above the list.",
  request: {
    query: boardQuery,
  },
  responses: {
    200: { description: "The board", content: { "application/json": { schema: BoardResponse } } },
    401: booksReadErrors[401],
    403: booksReadErrors[403],
    404: booksReadErrors[404],
    429: booksReadErrors[429],
  },
});

const billRoute = defineOpenAPIRoute(booksReadMeta("payables.bill"), {
  method: "get",
  path: "/api/v1/payables/bills/{vendorBillId}",
  description: "One vendor bill: its lines, where each went, and its payments.",
  request: {
    params: vendorBillIdParam,
    query: asOfQuery,
  },
  responses: {
    200: { description: "The bill", content: { "application/json": { schema: BillDetail } } },
    401: booksReadErrors[401],
    403: booksReadErrors[403],
    404: booksReadErrors[404],
    429: booksReadErrors[429],
  },
});

const recordBillRoute = defineOpenAPIRoute(
  booksWriteMeta("payables.recordBill", "payables:manage"),
  {
    method: "post",
    path: "/api/v1/payables/bills",
    description:
      "Enters a vendor bill. A line on a matter becomes an approved cost on that matter, picked up by its next draft invoice; a hard cost goes to Client Costs Advanced, anything else to its expense account.",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: RecordBillRequest } }, required: true },
    },
    responses: {
      201: { description: "Entered", content: { "application/json": { schema: CreatedResponse } } },
      400: booksErrors[400],
      401: booksErrors[401],
      403: booksErrors[403],
      404: booksErrors[404],
      409: booksErrors[409],
      422: booksErrors[422],
      429: booksErrors[429],
    },
  },
);

const payBillsRoute = defineOpenAPIRoute(booksWriteMeta("payables.payBills", "payables:manage"), {
  method: "post",
  path: "/api/v1/payables/payments",
  description:
    "Pays one or more vendor bills from one of the firm's operating accounts. Never from trust. A check with no number waits to be printed.",
  request: {
    headers: idempotencyKeyHeader,
    body: { content: { "application/json": { schema: PayBillsRequest } }, required: true },
  },
  responses: {
    201: { description: "Paid", content: { "application/json": { schema: PaymentsResponse } } },
    400: booksErrors[400],
    401: booksErrors[401],
    403: booksErrors[403],
    404: booksErrors[404],
    409: booksErrors[409],
    422: booksErrors[422],
    429: booksErrors[429],
  },
});

const reverseBillRoute = defineOpenAPIRoute(
  booksWriteMeta("payables.reverseBill", "payables:manage"),
  {
    method: "post",
    path: "/api/v1/payables/bills/{vendorBillId}/reverse",
    description:
      "Reverses a bill entered in error, with its matter costs. A bill with payments, or whose cost is on a finalized invoice, is refused.",
    request: {
      headers: idempotencyKeyHeader,
      params: vendorBillIdParam,
      body: { content: { "application/json": { schema: ReverseBillRequest } }, required: true },
    },
    responses: {
      201: {
        description: "Reversed",
        content: { "application/json": { schema: CreatedResponse } },
      },
      400: booksErrors[400],
      401: booksErrors[401],
      403: booksErrors[403],
      404: booksErrors[404],
      409: booksErrors[409],
      422: booksErrors[422],
      429: booksErrors[429],
    },
  },
);

const vendorDefaultRoute = defineOpenAPIRoute(booksReadMeta("payables.vendorDefaultAccount"), {
  method: "get",
  path: "/api/v1/payables/vendors/{vendorId}/default-account",
  description: "The account a new bill from this vendor fills in first, if one is set.",
  request: {
    params: vendorIdParam,
  },
  responses: {
    200: {
      description: "The account",
      content: { "application/json": { schema: VendorDefaultAccountResponse } },
    },
    401: booksReadErrors[401],
    403: booksReadErrors[403],
    404: booksReadErrors[404],
    429: booksReadErrors[429],
  },
});

const setVendorDefaultRoute = defineOpenAPIRoute(
  booksWriteMeta("payables.setVendorDefaultAccount", "payables:manage"),
  {
    method: "put",
    path: "/api/v1/payables/vendors/{vendorId}/default-account",
    description: "Sets or clears the expense account a vendor's bills usually go to.",
    request: {
      headers: idempotencyKeyHeader,
      params: vendorIdParam,
      body: {
        content: { "application/json": { schema: SetVendorDefaultAccountRequest } },
        required: true,
      },
    },
    responses: {
      201: { description: "Saved", content: { "application/json": { schema: CreatedResponse } } },
      400: booksErrors[400],
      401: booksErrors[401],
      403: booksErrors[403],
      404: booksErrors[404],
      409: booksErrors[409],
      422: booksErrors[422],
      429: booksErrors[429],
    },
  },
);

export function registerVendorBillRoutes(app: App, chokepoint: Chokepoint): void {
  app.openapi(
    { ...boardRoute, middleware: chokepointMiddleware(chokepoint, boardRoute) },
    async (c) => {
      const query = c.req.valid("query");
      const database = requireChokepointFirmContext(c).firmDatabase;
      const board = await readVendorBillBoard(database, {
        asOf: booksToday(query.asOf),
        filter: query.filter ?? "unpaid",
        vendorId: query.vendorId ?? null,
        matterId: query.matterId ?? null,
      });
      return c.json(
        {
          totals: board.totals,
          vendors: board.vendors.map((vendor) => ({
            ...vendor,
            aging: { ...vendor.aging },
            bills: vendor.bills.map((bill) => ({ ...bill, matterIds: [...bill.matterIds] })),
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...billRoute, middleware: chokepointMiddleware(chokepoint, billRoute) },
    async (c) => {
      const { vendorBillId: id } = c.req.valid("param");
      const { asOf } = c.req.valid("query");
      const database = requireChokepointFirmContext(c).firmDatabase;
      try {
        const bill = await readVendorBill(database, id, booksToday(asOf));
        return c.json(
          {
            ...bill,
            matterIds: [...bill.matterIds],
            lines: bill.lines.map((line) => ({ ...line })),
            payments: bill.payments.map((payment) => ({ ...payment })),
          },
          200,
        );
      } catch (caught) {
        if (
          caught instanceof GeneralLedgerValidationError &&
          caught.code === "unknown-vendor-bill"
        ) {
          return problemJson(c, {
            type: "not-found",
            title: "Not found",
            status: 404,
            detail: caught.message,
          });
        }
        throw caught;
      }
    },
  );

  app.openapi(
    { ...recordBillRoute, middleware: chokepointMiddleware(chokepoint, recordBillRoute) },
    async (c) => {
      const request = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => {
        const recorded = await recordVendorBill(database, request, options);
        return { write: recorded.effect, body: { id: recorded.vendorBillId } };
      });
    },
  );

  app.openapi(
    { ...payBillsRoute, middleware: chokepointMiddleware(chokepoint, payBillsRoute) },
    async (c) => {
      const request = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => {
        const paid = await payVendorBills(database, request, options);
        return { write: paid.effect, body: { paymentIds: [...paid.paymentIds] } };
      });
    },
  );

  app.openapi(
    { ...reverseBillRoute, middleware: chokepointMiddleware(chokepoint, reverseBillRoute) },
    async (c) => {
      const request = c.req.valid("json");
      const { vendorBillId: id } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => ({
        write: await reverseVendorBill(database, { ...request, vendorBillId: id }, options),
        body: { id },
      }));
    },
  );

  app.openapi(
    { ...vendorDefaultRoute, middleware: chokepointMiddleware(chokepoint, vendorDefaultRoute) },
    async (c) => {
      const { vendorId: id } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return c.json({ ledgerAccountId: await readVendorDefaultAccount(database, id) }, 200);
    },
  );

  app.openapi(
    {
      ...setVendorDefaultRoute,
      middleware: chokepointMiddleware(chokepoint, setVendorDefaultRoute),
    },
    async (c) => {
      const { vendorId: id } = c.req.valid("param");
      const { ledgerAccountId: account } = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => ({
        write: await setVendorDefaultAccount(
          database,
          { vendorId: id, ledgerAccountId: account },
          options,
        ),
        body: { id },
      }));
    },
  );
}
