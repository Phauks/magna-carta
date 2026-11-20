import {
  CountResponse,
  CreateAccountRequest,
  CreatedResponse,
  ChartResponse,
  EditOperatingAccountRequest,
  OpenOperatingAccountRequest,
  RoleAssignmentsRequest,
  UpdateAccountRequest,
} from "@magna-carta/general-ledger/contract";
import {
  createChartAccount,
  readChartOfAccounts,
  updateChartAccount,
} from "@magna-carta/general-ledger/chart";
import {
  editOperatingBankAccount,
  openOperatingBankAccount,
  readOperatingBankAccounts,
  setDefaultOperatingBankAccount,
} from "@magna-carta/general-ledger/operating-accounts";
import {
  configureAccountRoles,
  readAccountRoleMap,
} from "@magna-carta/general-ledger/role-configuration";
import {
  adoptStarterChart,
  suggestedRoleAccounts,
} from "@magna-carta/general-ledger/starter-chart";
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
  booksWriteMeta,
  commitBooksWrite,
} from "./operating-books-support.ts";

// THE CHART OF ACCOUNTS AND THE FIRM'S OWN BANK ACCOUNTS. The chart is read here and edited here;
// trust's accounts are shown and never edited (they belong to the Trust screen). Any number of
// operating bank accounts may be opened, and one is the default the payment window offers first.

type App = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

const ledgerAccountIdParam = z.object({
  ledgerAccountId: identifierPathParam("ledgerAccount", "ledgerAccountId"),
});
const operatingBankAccountIdParam = z.object({
  operatingBankAccountId: identifierPathParam("operatingBankAccount", "operatingBankAccountId"),
});

const chartRoute = defineOpenAPIRoute(booksReadMeta("ledger.chart"), {
  method: "get",
  path: "/api/v1/ledger/accounts",
  description:
    "The chart of accounts: every account outside trust's per-client tree, the firm's operating bank accounts with the default marked, the accounts the app posts to, and the standard chart's suggestions for any it has not been told.",
  responses: {
    200: { description: "The chart", content: { "application/json": { schema: ChartResponse } } },
    401: booksReadErrors[401],
    403: booksReadErrors[403],
    404: booksReadErrors[404],
    429: booksReadErrors[429],
  },
});

const createAccountRoute = defineOpenAPIRoute(
  booksWriteMeta("ledger.createAccount", "billing:configure"),
  {
    method: "post",
    path: "/api/v1/ledger/accounts",
    description: "Adds an account to the chart. Trust accounts are opened on the Trust screen.",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: CreateAccountRequest } }, required: true },
    },
    responses: {
      201: { description: "Added", content: { "application/json": { schema: CreatedResponse } } },
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

const updateAccountRoute = defineOpenAPIRoute(
  booksWriteMeta("ledger.updateAccount", "billing:configure"),
  {
    method: "patch",
    path: "/api/v1/ledger/accounts/{ledgerAccountId}",
    description:
      "Renames, renumbers, places or describes an account. An account's type never changes.",
    request: {
      headers: idempotencyKeyHeader,
      params: ledgerAccountIdParam,
      body: { content: { "application/json": { schema: UpdateAccountRequest } }, required: true },
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

const standardChartRoute = defineOpenAPIRoute(
  booksWriteMeta("ledger.adoptStandardChart", "billing:configure"),
  {
    method: "post",
    path: "/api/v1/ledger/standard-chart",
    description:
      "Adds the standard chart of accounts for a law firm, once. Nothing is mapped to the app's accounts until the firm saves them.",
    request: { headers: idempotencyKeyHeader },
    responses: {
      201: { description: "Added", content: { "application/json": { schema: CountResponse } } },
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

const rolesRoute = defineOpenAPIRoute(
  booksWriteMeta("ledger.setAccountRoles", "billing:configure"),
  {
    method: "put",
    path: "/api/v1/ledger/account-roles",
    description:
      "Sets which account the app posts to for each purpose. A trust account, an account with accounts under it, or an account of the wrong type is refused.",
    request: {
      headers: idempotencyKeyHeader,
      body: { content: { "application/json": { schema: RoleAssignmentsRequest } }, required: true },
    },
    responses: {
      201: { description: "Saved", content: { "application/json": { schema: CountResponse } } },
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

const openOperatingRoute = defineOpenAPIRoute(
  booksWriteMeta("ledger.openOperatingAccount", "billing:configure"),
  {
    method: "post",
    path: "/api/v1/ledger/operating-accounts",
    description:
      "Adds one of the firm's own bank accounts. The first one becomes the default; any open one can pay a vendor bill.",
    request: {
      headers: idempotencyKeyHeader,
      body: {
        content: { "application/json": { schema: OpenOperatingAccountRequest } },
        required: true,
      },
    },
    responses: {
      201: { description: "Added", content: { "application/json": { schema: CreatedResponse } } },
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

const editOperatingRoute = defineOpenAPIRoute(
  booksWriteMeta("ledger.editOperatingAccount", "billing:configure"),
  {
    method: "patch",
    path: "/api/v1/ledger/operating-accounts/{operatingBankAccountId}",
    description: "Renames a bank account or changes its bank name or last four digits.",
    request: {
      headers: idempotencyKeyHeader,
      params: operatingBankAccountIdParam,
      body: {
        content: { "application/json": { schema: EditOperatingAccountRequest } },
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

const defaultOperatingRoute = defineOpenAPIRoute(
  booksWriteMeta("ledger.setDefaultOperatingAccount", "billing:configure"),
  {
    method: "post",
    path: "/api/v1/ledger/operating-accounts/{operatingBankAccountId}/default",
    description: "Makes this bank account the one the payment window offers first.",
    request: {
      headers: idempotencyKeyHeader,
      params: operatingBankAccountIdParam,
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

export function registerLedgerAccountRoutes(app: App, chokepoint: Chokepoint): void {
  app.openapi(
    { ...chartRoute, middleware: chokepointMiddleware(chokepoint, chartRoute) },
    async (c) => {
      const database = requireChokepointFirmContext(c).firmDatabase;
      const [accounts, operatingAccounts, roles, suggested] = await Promise.all([
        readChartOfAccounts(database),
        readOperatingBankAccounts(database),
        readAccountRoleMap(database),
        suggestedRoleAccounts(database),
      ]);
      return c.json(
        {
          accounts: accounts.map((account) => ({ ...account, roles: [...account.roles] })),
          operatingAccounts: operatingAccounts.map((account) => ({
            operatingBankAccountId: account.operatingBankAccountId,
            name: account.name,
            bankName: account.bankName,
            accountNumberLastFour: account.accountNumberLastFour,
            ledgerAccountId: account.ledgerAccountId,
            code: account.code,
            openedOn: account.openedOn,
            closedAt: account.closedAt,
            balanceMinor: account.balanceMinor,
            isDefault: account.isDefault,
          })),
          roles: [...roles].map(([role, ledgerAccountId]) => ({ role, ledgerAccountId })),
          suggestedRoles: [...suggested]
            .filter(([role]) => !roles.has(role))
            .map(([role, ledgerAccountId]) => ({ role, ledgerAccountId })),
          hasStandardChart: accounts.some((account) => account.systemAccount),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...createAccountRoute, middleware: chokepointMiddleware(chokepoint, createAccountRoute) },
    async (c) => {
      const request = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => {
        const made = await createChartAccount(database, request, options);
        return { write: made.effect, body: { id: made.accountId } };
      });
    },
  );

  app.openapi(
    { ...updateAccountRoute, middleware: chokepointMiddleware(chokepoint, updateAccountRoute) },
    async (c) => {
      const request = c.req.valid("json");
      const { ledgerAccountId: id } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async () => ({
        write: await updateChartAccount(database, { ...request, ledgerAccountId: id }),
        body: { id },
      }));
    },
  );

  app.openapi(
    { ...standardChartRoute, middleware: chokepointMiddleware(chokepoint, standardChartRoute) },
    async (c) => {
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => {
        const adopted = await adoptStarterChart(database, options);
        return { write: adopted.effect, body: { count: adopted.accountIds.size } };
      });
    },
  );

  app.openapi(
    { ...rolesRoute, middleware: chokepointMiddleware(chokepoint, rolesRoute) },
    async (c) => {
      const { assignments } = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => ({
        write: await configureAccountRoles(database, assignments, options),
        body: { count: assignments.length },
      }));
    },
  );

  app.openapi(
    { ...openOperatingRoute, middleware: chokepointMiddleware(chokepoint, openOperatingRoute) },
    async (c) => {
      const request = c.req.valid("json");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => {
        const opened = await openOperatingBankAccount(database, request, options);
        return { write: opened.effect, body: { id: opened.operatingBankAccountId } };
      });
    },
  );

  app.openapi(
    { ...editOperatingRoute, middleware: chokepointMiddleware(chokepoint, editOperatingRoute) },
    async (c) => {
      const request = c.req.valid("json");
      const { operatingBankAccountId: id } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async () => ({
        write: await editOperatingBankAccount(database, { ...request, operatingBankAccountId: id }),
        body: { id },
      }));
    },
  );

  app.openapi(
    {
      ...defaultOperatingRoute,
      middleware: chokepointMiddleware(chokepoint, defaultOperatingRoute),
    },
    async (c) => {
      const { operatingBankAccountId: id } = c.req.valid("param");
      const database = requireChokepointFirmContext(c).firmDatabase;
      return commitBooksWrite(c, async (options) => ({
        write: await setDefaultOperatingBankAccount(database, id, options),
        body: { id },
      }));
    },
  );
}
