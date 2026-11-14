import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  ContinueExhibitSetRequest,
  CorrectExhibitRequest,
  CreatedExhibitSet,
  IssueExhibitSetRequest,
  IssuedExhibitSet,
  SupersedeExhibitSetRequest,
  WithdrawExhibitRequest,
} from "@magna-carta/exhibits/contract";
import { correctMember } from "@magna-carta/exhibits/correction-service";
import { issueExhibitSet } from "@magna-carta/exhibits/issue-service";
import {
  continueExhibitSet,
  supersedeExhibitSet,
} from "@magna-carta/exhibits/supersession-service";
import { withdrawMember } from "@magna-carta/exhibits/withdrawal-service";
import type {
  ExhibitSetId,
  ExhibitSetMemberId,
  FileId,
  FileVersionId,
  MatterId,
} from "@magna-carta/identifiers/types";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { idempotencyKeyHeader } from "../../contracts/common.ts";
import { defineOpenAPIRoute } from "../../contracts/route-meta.ts";
import {
  ISSUE,
  MANAGE,
  errors,
  idempotentWrite,
  jsonBody,
  memberParams,
  setParams,
  writeMeta,
} from "./exhibit-route-support.ts";

// What happens when a set goes out, and what stays possible after. Issuing is a member's recorded
// assertion — the platform does not observe a filing — and it cannot be undone: every label, title
// and file version freezes, and the database refuses to change them. Afterwards an exhibit can be
// withdrawn (its label is retired, never reused), its record corrected (beside the as-issued values,
// never renumbering), and the set superseded by an amended one or continued by a later one.

const acknowledged = {
  200: { description: "Done", content: { "application/json": { schema: CreatedExhibitSet } } },
  400: errors[400],
  401: errors[401],
  403: errors[403],
  404: errors[404],
  409: errors[409],
  422: errors[422],
  429: errors[429],
} as const;

const issueRoute = defineOpenAPIRoute(writeMeta("issueExhibitSet", ISSUE), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/issue",
  description:
    "Records that a draft set went out — filed, served, exchanged or lodged — on the date given. " +
    "Every label, title and file version is written down as it is now and can never change; the " +
    "set cannot be unissued. Answers with the labels it froze.",
  request: {
    headers: idempotencyKeyHeader,
    params: setParams,
    body: jsonBody(IssueExhibitSetRequest),
  },
  responses: {
    200: {
      description: "The labels the set went out with",
      content: { "application/json": { schema: IssuedExhibitSet } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const withdrawRoute = defineOpenAPIRoute(writeMeta("withdrawExhibit", ISSUE), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/members/{memberId}/withdraw",
  description:
    "Withdraws one exhibit from an issued set, with the reason. It keeps its label, and no later " +
    "exhibit in this set or one continuing it is given that label.",
  request: {
    headers: idempotencyKeyHeader,
    params: memberParams,
    body: jsonBody(WithdrawExhibitRequest),
  },
  responses: acknowledged,
});

const correctRoute = defineOpenAPIRoute(writeMeta("correctExhibit", ISSUE), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/members/{memberId}/correct",
  description:
    "Corrects the record of an issued exhibit: a mistyped title, or the wrong version recorded. " +
    "The correction is kept beside what was recorded at issue, with who made it and why. It never " +
    "changes a label or the order.",
  request: {
    headers: idempotencyKeyHeader,
    params: memberParams,
    body: jsonBody(CorrectExhibitRequest),
  },
  responses: acknowledged,
});

const supersedeRoute = defineOpenAPIRoute(writeMeta("supersedeExhibitSet", ISSUE), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/supersede",
  description:
    "Starts the amended set that replaces an issued one: a draft holding the same exhibits in the " +
    "same order, minus any withdrawn. A set is replaced at most once.",
  request: {
    headers: idempotencyKeyHeader,
    params: setParams,
    body: jsonBody(SupersedeExhibitSetRequest),
  },
  responses: {
    201: {
      description: "The new set",
      content: { "application/json": { schema: CreatedExhibitSet } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

const continueRoute = defineOpenAPIRoute(writeMeta("continueExhibitSet", MANAGE), {
  method: "post",
  path: "/api/v1/matters/{matterId}/exhibit-sets/{setId}/continue",
  description:
    "Starts an empty draft whose numbering picks up after an issued set, past every label it used, " +
    "withdrawn ones included.",
  request: {
    headers: idempotencyKeyHeader,
    params: setParams,
    body: jsonBody(ContinueExhibitSetRequest),
  },
  responses: {
    201: {
      description: "The new set",
      content: { "application/json": { schema: CreatedExhibitSet } },
    },
    400: errors[400],
    401: errors[401],
    403: errors[403],
    404: errors[404],
    409: errors[409],
    422: errors[422],
    429: errors[429],
  },
});

export function registerExhibitSetIssueRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...issueRoute, middleware: chokepointMiddleware(chokepoint, issueRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 200, async (database, options) => {
        const issued = await issueExhibitSet(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          { ...body, filedCopyFileId: (body.filedCopyFileId ?? null) as FileId | null },
          options,
        );
        return { body: { labels: [...issued.labels] }, effect: issued.effect };
      });
    },
  );

  app.openapi(
    { ...withdrawRoute, middleware: chokepointMiddleware(chokepoint, withdrawRoute) },
    async (c) => {
      const { matterId, setId, memberId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 200, async (database, options) => {
        const withdrawn = await withdrawMember(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          memberId as ExhibitSetMemberId,
          body,
          options,
        );
        return { body: { id: setId as ExhibitSetId }, effect: withdrawn.effect };
      });
    },
  );

  app.openapi(
    { ...correctRoute, middleware: chokepointMiddleware(chokepoint, correctRoute) },
    async (c) => {
      const { matterId, setId, memberId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 200, async (database, options) => {
        const corrected = await correctMember(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          memberId as ExhibitSetMemberId,
          { ...body, fileVersionId: body.fileVersionId as FileVersionId | undefined },
          options,
        );
        return { body: { id: setId as ExhibitSetId }, effect: corrected.effect };
      });
    },
  );

  app.openapi(
    { ...supersedeRoute, middleware: chokepointMiddleware(chokepoint, supersedeRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 201, async (database, options) => {
        const successor = await supersedeExhibitSet(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          body,
          options,
        );
        return { body: { id: successor.setId }, effect: successor.effect };
      });
    },
  );

  app.openapi(
    { ...continueRoute, middleware: chokepointMiddleware(chokepoint, continueRoute) },
    async (c) => {
      const { matterId, setId } = c.req.valid("param");
      const body = c.req.valid("json");
      return idempotentWrite(c, 201, async (database, options) => {
        const continued = await continueExhibitSet(
          database,
          matterId as MatterId,
          setId as ExhibitSetId,
          body,
          options,
        );
        return { body: { id: continued.setId }, effect: continued.effect };
      });
    },
  );
}
