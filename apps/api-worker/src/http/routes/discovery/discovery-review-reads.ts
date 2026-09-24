import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { decodeCursor, encodeCursor } from "@magna-carta/data-access/cursor-pagination";
import { readReviewSetIndexBacklog } from "@magna-carta/discovery/index-statements";
import {
  readReviewDocumentPage,
  readReviewSetExceptionPage,
  readVisibleExceptionCounts,
  readVisibleOccurrences,
  readVisibleReviewDocument,
  readVisibleReviewDocumentExceptions,
  readVisibleReviewSet,
  type ReviewDocumentListCursor,
  type ReviewDocumentListFilters,
} from "@magna-carta/discovery/review-reads";
import { resolveFirmBucket } from "../../../files/firm-bucket.ts";
import { reviewSetAccessPredicate } from "@magna-carta/discovery/review-set-visibility";
import {
  REVIEW_DOCUMENT_EXCEPTION_CODES,
  REVIEW_DOCUMENT_EXCEPTION_STAGES,
  REVIEW_DOCUMENT_FAMILY_ROLES,
  REVIEW_DOCUMENT_INDEX_STATES,
  REVIEW_DOCUMENT_PROCESSING_STATES,
} from "@magna-carta/discovery/types";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { identifierField } from "@magna-carta/identifiers/field";
import { cursorQuery, paginated } from "@magna-carta/data-access/pagination-contract";
import { Problem, problemJson, type ProblemResponse } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// THE READS THE REVIEW SURFACE SITS ON: the corpus's documents as a filtered page, the reasons some of
// them are not in it, who else held each one, and what the search index still owes.
//
// Every one of them re-authorizes at read time through the review-set access list, and a review set a
// member is not on the list for is ABSENT rather than refused — no rows, no counts, and no error that
// names it. Material an opposing party produced is often under a protective order the matter team is
// not uniformly cleared for, so "there is a corpus here you may not see" is itself a disclosure.
//
// There is no UI on any of this yet, deliberately: the surfaces are the review slice's, and a read
// that is measured and paged is what that slice needs to exist before it can start.

const READ = "discovery:read";
const DEFAULT_PAGE_SIZE = 100;
const MAXIMUM_PAGE_SIZE = 200;

// How many reasons one document's pane shows. A document with more than this many named reasons is
// not a document anybody is going to read; the set-wide exception report is where that is counted.
const EXCEPTIONS_PER_DOCUMENT = 20;

const authErrors = {
  401: {
    description: "No valid session",
    content: { "application/problem+json": { schema: Problem } },
  },
  403: {
    description: "The session member lacks the discovery permission this route requires",
    content: { "application/problem+json": { schema: Problem } },
  },
  404: {
    description:
      "The firm is unreachable, the member is deactivated, or there is no such review set the " +
      "member may reach",
    content: { "application/problem+json": { schema: Problem } },
  },
  422: {
    description: "The request is well-formed but a rule refuses it",
    content: { "application/problem+json": { schema: Problem } },
  },
  429: {
    description: "Rate limit exceeded",
    content: { "application/problem+json": { schema: Problem } },
  },
};

function readMeta(action: string): RouteMeta {
  return {
    operationId: `discovery.${action}`,
    surface: "app",
    authenticated: true,
    permission: READ,
    // A review set IS one matter's corpus and cannot exist without one.
    resource: "matter",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };
}

// ---------------------------------------------------------------------------------------------
// Wire shapes

const ReviewDocumentListItem = z
  .object({
    id: z.string(),
    recordCustodianId: z.string(),
    discoveryLoadId: z.string(),
    familyId: z.string(),
    familyRole: z.enum(REVIEW_DOCUMENT_FAMILY_ROLES),
    familySequence: z.number(),
    sourceName: z.string().nullable(),
    sourcePath: z.string().nullable(),
    sizeBytes: z.number().nullable(),
    pageCount: z.number().nullable(),
    formatIdentified: z.string().nullable(),
    sortDate: z.string().nullable(),
    sortDateSource: z.string().nullable(),
    processingState: z.enum(REVIEW_DOCUMENT_PROCESSING_STATES),
    processingDeferredReason: z.string().nullable(),
    indexState: z.enum(REVIEW_DOCUMENT_INDEX_STATES).nullable(),
    isDedupPrimary: z.boolean(),
    extractionRoute: z.string().nullable(),
    pagesRecognized: z.number().nullable(),
    createdAt: z.string(),
  })
  .openapi("ReviewDocument");

// ONE DOCUMENT, as the reviewer's pane reads it — the list row plus what only this question needs:
// the digests a defensibility challenge asks for, the family it arrived in, the fingerprint the
// near-duplicate work will cluster on, and every reason it is not readable.
//
// IT CARRIES NO R2 KEY. The row holds two, and neither leaves: an object key is an internal address,
// and a client holding one has been handed something it can only misuse. Whether text exists is a
// boolean here, and the text itself is served by the route below, which re-authorizes.
const ReviewDocumentDetail = z
  .object({
    id: z.string(),
    reviewSetId: z.string(),
    recordCustodianId: z.string(),
    discoveryLoadId: z.string(),
    sourceKind: z.enum(["file_version", "email_message", "email_attachment"]),
    familyId: z.string(),
    familyRole: z.enum(REVIEW_DOCUMENT_FAMILY_ROLES),
    familySequence: z.number(),
    sourceName: z.string().nullable(),
    sourcePath: z.string().nullable(),
    sizeBytes: z.number().nullable(),
    pageCount: z.number().nullable(),
    formatIdentified: z.string().nullable(),
    sortDate: z.string().nullable(),
    sortDateSource: z.string().nullable(),
    processingState: z.enum(REVIEW_DOCUMENT_PROCESSING_STATES),
    processingDeferredReason: z.string().nullable(),
    indexState: z.enum(REVIEW_DOCUMENT_INDEX_STATES).nullable(),
    isDedupPrimary: z.boolean(),
    dedupGroupId: z.string().nullable(),
    extractionRoute: z.string().nullable(),
    pagesRecognized: z.number().nullable(),
    contentSha256: z.string().nullable(),
    contentMd5: z.string().nullable(),
    contentSha1: z.string().nullable(),
    textFingerprint: z.string().nullable(),
    hasExtractedText: z.boolean(),
    createdAt: z.string(),
    exceptions: z.array(
      z.object({
        id: z.string(),
        stage: z.enum(REVIEW_DOCUMENT_EXCEPTION_STAGES),
        code: z.enum(REVIEW_DOCUMENT_EXCEPTION_CODES),
        detail: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  })
  .openapi("ReviewDocumentDetail");

const ReviewSetExceptionItem = z
  .object({
    id: z.string(),
    reviewDocumentId: z.string(),
    discoveryLoadId: z.string(),
    stage: z.enum(REVIEW_DOCUMENT_EXCEPTION_STAGES),
    code: z.enum(REVIEW_DOCUMENT_EXCEPTION_CODES),
    detail: z.string().nullable(),
    recordCustodianId: z.string(),
    sourceName: z.string().nullable(),
    processingState: z.enum(REVIEW_DOCUMENT_PROCESSING_STATES),
    createdAt: z.string(),
  })
  .openapi("ReviewDocumentException");

const OccurrenceItem = z
  .object({
    id: z.string(),
    primaryReviewDocumentId: z.string(),
    duplicateReviewDocumentId: z.string(),
    recordCustodianId: z.string(),
    discoveryLoadId: z.string(),
    createdAt: z.string(),
  })
  .openapi("ReviewDocumentOccurrence");

const reviewSetIdParam = z.object({
  reviewSetId: identifierPathParam("reviewSet", "reviewSetId"),
});

const reviewDocumentParams = z.object({
  reviewSetId: identifierPathParam("reviewSet", "reviewSetId"),
  reviewDocumentId: identifierPathParam("reviewDocument", "reviewDocumentId"),
});

const pageSizeQuery = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAXIMUM_PAGE_SIZE)
  .optional()
  .openapi({ description: `How many documents to return, at most ${MAXIMUM_PAGE_SIZE}.` });

const reviewDocumentQuery = cursorQuery.extend({
  pageSize: pageSizeQuery,
  recordCustodianId: identifierField("recordCustodian").optional(),
  discoveryLoadId: identifierField("discoveryLoad").optional(),
  familyId: identifierField("reviewDocument").optional(),
  processingState: z.enum(REVIEW_DOCUMENT_PROCESSING_STATES).optional(),
  exceptionCode: z.enum(REVIEW_DOCUMENT_EXCEPTION_CODES).optional(),
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .openapi({
      description:
        "Narrows to documents whose name or path contains this text. It matches what a document " +
        "is CALLED and never what is inside it: searching a document's text is the review set's " +
        "own index, which is a different read returning a ranked answer rather than a page of " +
        "this listing.",
    }),
});

// ---------------------------------------------------------------------------------------------
// Routes

const listReviewDocumentsRoute = defineOpenAPIRoute(readMeta("listReviewDocuments"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/documents",
  description:
    "One page of the review set's documents, newest document first and documents with no known " +
    "date last. Filterable by Custodian of Record, by the load that brought the document in, by " +
    "family, by where the document got to in processing, by the reason it did not get further, and " +
    "by a search over what each document is called. " +
    "Paged by cursor rather than by page number: a corpus is added to while it is being read, and " +
    "a numbered page silently shows the same document twice or skips one.",
  request: { params: reviewSetIdParam, query: reviewDocumentQuery },
  responses: {
    200: {
      description: "A page of the review set's documents",
      content: {
        "application/json": {
          schema: z
            .object({
              data: z.array(ReviewDocumentListItem),
              nextCursor: z.string().nullable(),
            })
            .openapi("ReviewDocumentPage"),
        },
      },
    },
    ...authErrors,
  },
});

const getReviewDocumentRoute = defineOpenAPIRoute(readMeta("getReviewDocument"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/documents/{reviewDocumentId}",
  description:
    "One document as the reviewer reads it: what it was called where it came from, whose records " +
    "it was, the delivery it arrived on, the family it arrived in, how far it got, the digests " +
    "recorded for it, and every named reason it could not be read. A document in a review set the " +
    "member is not on the list for is absent, not refused.",
  request: { params: reviewDocumentParams },
  responses: {
    200: {
      description: "The document",
      content: { "application/json": { schema: ReviewDocumentDetail } },
    },
    ...authErrors,
  },
});

const getReviewDocumentTextRoute = defineOpenAPIRoute(readMeta("getReviewDocumentText"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/documents/{reviewDocumentId}/text",
  description:
    "The text the discovery engine extracted from this document, as plain text. 404 while none " +
    "exists, which is the ordinary state of a document that has not been read yet and the " +
    "permanent state of one that could not be. " +
    "SERVED THROUGH THIS ROUTE RATHER THAN AS A REDIRECT TO THE OBJECT, and gated by the review " +
    "set's own access list rather than by the file permissions the native bytes are gated by: a " +
    "reviewer brought in for one production is on that list and may hold no file permission at " +
    "all, and the extracted text is exactly what they need to code a document. The native file " +
    "stays behind its own gate, where it belongs.",
  request: { params: reviewDocumentParams },
  responses: {
    200: {
      description: "The extracted text",
      content: { "text/plain": { schema: z.string() } },
    },
    ...authErrors,
  },
});

const listReviewSetExceptionsRoute = defineOpenAPIRoute(readMeta("listReviewSetExceptions"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/exceptions",
  description:
    "Every document in this review set that could not be read, with the reason for each and the " +
    "Custodian of Record it came from — the live view of what a production's exception report will " +
    "say. The counts by reason come first because that is the shape of the answer: how many " +
    "documents are encrypted, how many are damaged, how many yielded no text at all. One document " +
    "may carry several reasons and is counted once in each, and the page walks the " +
    "document-and-reason pair so a reason is never dropped at a page boundary.",
  request: {
    params: reviewSetIdParam,
    query: cursorQuery.extend({ pageSize: pageSizeQuery }),
  },
  responses: {
    200: {
      description: "The reasons, counted and then listed",
      content: {
        "application/json": {
          schema: z
            .object({
              countsByCode: z.array(
                z.object({
                  code: z.enum(REVIEW_DOCUMENT_EXCEPTION_CODES),
                  documentCount: z.number(),
                }),
              ),
              data: z.array(ReviewSetExceptionItem),
              nextCursor: z.string().nullable(),
            })
            .openapi("ReviewSetExceptionPage"),
        },
      },
    },
    ...authErrors,
  },
});

const listOccurrencesRoute = defineOpenAPIRoute(readMeta("listReviewDocumentOccurrences"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/documents/{reviewDocumentId}/occurrences",
  description:
    "Every other copy of this document that the review set holds, each with the Custodian of " +
    "Record who held it and the load it arrived on. Deduplication decides which copy a reviewer " +
    "opens; it never decides who held one, so a suppressed copy keeps its own row and stays " +
    "reachable from here. This is the read behind 'which custodians held this document', which is " +
    "a question asked under oath.",
  request: { params: reviewDocumentParams, query: cursorQuery },
  responses: {
    200: {
      description: "One page of the document's other copies",
      content: {
        "application/json": {
          schema: paginated(OccurrenceItem).openapi("ReviewDocumentOccurrenceList"),
        },
      },
    },
    ...authErrors,
  },
});

const getIndexStatusRoute = defineOpenAPIRoute(readMeta("getReviewSetIndexStatus"), {
  method: "get",
  path: "/api/v1/review-sets/{reviewSetId}/index-status",
  description:
    "How much of this review set is searchable. A document that has been read but not yet indexed " +
    "is not an exception and never appears on a production's exception report — it is work the " +
    "platform still owes, and it is counted here so the firm can see it rather than having to " +
    "infer it. Only documents that were successfully read can be indexed at all, so the four " +
    "counts are over those.",
  request: { params: reviewSetIdParam },
  responses: {
    200: {
      description: "What the review set owes the index",
      content: {
        "application/json": {
          schema: z
            .object({
              indexed: z.number(),
              deferred: z.number(),
              failed: z.number(),
              unattempted: z.number(),
            })
            .openapi("ReviewSetIndexStatus"),
        },
      },
    },
    ...authErrors,
  },
});

// ---------------------------------------------------------------------------------------------
// Handlers

type DiscoveryApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

function accessFor(c: Context<{ Bindings: Bindings; Variables: AppVariables }>) {
  return reviewSetAccessPredicate(requireChokepointUserId(c));
}

// The 404 a member not on the list gets. It is the same answer as for a review set that does not
// exist, because the difference between the two is information about a corpus somebody may not know
// about. The wall itself is the predicate every statement carries; this only decides the status code.
function notOnTheList(c: Context): ProblemResponse<404> {
  return problemJson(c, {
    type: "not-found",
    title: "Not found",
    status: 404,
    detail: "No such review set in this firm.",
  });
}

// The list cursor on the wire, over the platform's own opaque encoding rather than a second one.
//
// The sort key is a document's date, which a production may simply not give — so the undated tail is
// encoded as an empty sort key. That is not a sentinel a caller can mistake for a date: the cursor is
// opaque, minted by this route and handed back to it, and an empty key decodes to "the tail" in the
// one place that reads it.
function decodeDocumentCursor(cursor: string | undefined): ReviewDocumentListCursor | undefined {
  const decoded = decodeCursor(cursor);
  if (decoded === undefined) return undefined;
  return { sortDate: decoded.createdAt === "" ? null : decoded.createdAt, id: decoded.id };
}

function encodeDocumentCursor(cursor: ReviewDocumentListCursor | null): string | null {
  return cursor === null ? null : encodeCursor(cursor.sortDate ?? "", cursor.id);
}

export function registerDiscoveryReviewReadRoutes(app: DiscoveryApp, chokepoint: Chokepoint): void {
  app.openapi(
    {
      ...getReviewDocumentRoute,
      middleware: chokepointMiddleware(chokepoint, getReviewDocumentRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewDocumentId } = c.req.valid("param");
      const access = accessFor(c);
      // ONE read carries the wall: the statement composes the access predicate against the
      // document's own review set, so a document in a corpus the member is not on is simply not
      // found — the address they used tells them nothing they did not already have.
      const document = await readVisibleReviewDocument(
        firm.firmDatabase,
        reviewDocumentId as ReviewDocumentId,
        access,
      );
      if (document === undefined) return notOnTheList(c);
      const exceptions = await readVisibleReviewDocumentExceptions(
        firm.firmDatabase,
        reviewDocumentId as ReviewDocumentId,
        access,
        EXCEPTIONS_PER_DOCUMENT,
      );
      return c.json(
        {
          id: document.id,
          reviewSetId: document.review_set_id,
          recordCustodianId: document.record_custodian_id,
          discoveryLoadId: document.discovery_load_id,
          sourceKind: document.source_kind as "file_version" | "email_message" | "email_attachment",
          familyId: document.family_id,
          familyRole: document.family_role,
          familySequence: document.family_sequence,
          sourceName: document.source_name,
          sourcePath: document.source_path,
          sizeBytes: document.size_bytes,
          pageCount: document.page_count,
          formatIdentified: document.format_identified,
          sortDate: document.sort_date,
          sortDateSource: document.sort_date_source,
          processingState: document.processing_state,
          processingDeferredReason: document.processing_deferred_reason,
          indexState: document.index_state,
          isDedupPrimary: document.is_dedup_primary === 1,
          dedupGroupId: document.dedup_group_id,
          extractionRoute: document.extraction_route,
          pagesRecognized: document.pages_recognized,
          contentSha256: document.content_sha256,
          contentMd5: document.content_md5,
          contentSha1: document.content_sha1,
          textFingerprint: document.text_fingerprint,
          // The key itself never leaves; whether there is one to serve does.
          hasExtractedText: document.text_r2_key !== null,
          createdAt: document.created_at,
          exceptions: exceptions.map((exception) => ({
            id: exception.id,
            stage: exception.stage,
            code: exception.code,
            detail: exception.detail,
            createdAt: exception.created_at,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    {
      ...getReviewDocumentTextRoute,
      middleware: chokepointMiddleware(chokepoint, getReviewDocumentTextRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewDocumentId } = c.req.valid("param");
      const document = await readVisibleReviewDocument(
        firm.firmDatabase,
        reviewDocumentId as ReviewDocumentId,
        accessFor(c),
      );
      if (document === undefined || document.text_r2_key === null) return notOnTheList(c);
      const { bucket } = resolveFirmBucket(c.env, firm.bucketName);
      const object = await bucket.get(document.text_r2_key);
      // The row says there is text and the object is not there. That is a real state — a review set
      // whose derived artifacts were released at close keeps its rows — and it is reported as an
      // absence rather than as a fault, because nothing is wrong with the record.
      if (object === null) return notOnTheList(c);
      // READ WHOLE RATHER THAN STREAMED, which is the one place this file departs from "stream,
      // don't buffer". The object is one document's extracted text and is bounded by construction:
      // the extraction pipeline refuses a document it would have to read past its own size limit
      // and records `oversize` against it instead, so nothing that reaches here is unbounded. The
      // contract says the response is text, and a caller reading a document into a pane wants it
      // whole; a stream would buy nothing and cost the contract its shape.
      return c.text(await object.text(), 200, {
        // Never cached by a shared cache: this is an opposing party's material behind a
        // per-review-set access list, and the response varies by who asked.
        "cache-control": "private, no-store",
        // The bytes came out of an untrusted document. Nothing should sniff them into anything
        // executable, and nothing should render them as a document of their own.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      });
    },
  );

  app.openapi(
    {
      ...listReviewDocumentsRoute,
      middleware: chokepointMiddleware(chokepoint, listReviewDocumentsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const query = c.req.valid("query");
      const access = accessFor(c);
      // One read decides both the wall and the 404, and it is the same predicate the page itself
      // composes — so a member off the list cannot learn a review set exists from an empty page
      // either.
      if (
        (await readVisibleReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId, access)) ===
        undefined
      ) {
        return notOnTheList(c);
      }
      const filters: ReviewDocumentListFilters = {
        ...(query.recordCustodianId === undefined
          ? {}
          : { recordCustodianId: query.recordCustodianId as RecordCustodianId }),
        ...(query.discoveryLoadId === undefined
          ? {}
          : { discoveryLoadId: query.discoveryLoadId as DiscoveryLoadId }),
        ...(query.familyId === undefined ? {} : { familyId: query.familyId as ReviewDocumentId }),
        ...(query.processingState === undefined ? {} : { processingState: query.processingState }),
        ...(query.exceptionCode === undefined ? {} : { exceptionCode: query.exceptionCode }),
        ...(query.search === undefined ? {} : { search: query.search }),
      };
      const page = await readReviewDocumentPage(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
        access,
        filters,
        decodeDocumentCursor(query.cursor),
        query.pageSize ?? DEFAULT_PAGE_SIZE,
      );
      return c.json(
        {
          data: page.documents.map((row) => ({
            id: row.id,
            recordCustodianId: row.record_custodian_id,
            discoveryLoadId: row.discovery_load_id,
            familyId: row.family_id,
            familyRole: row.family_role,
            familySequence: row.family_sequence,
            sourceName: row.source_name,
            sourcePath: row.source_path,
            sizeBytes: row.size_bytes,
            pageCount: row.page_count,
            formatIdentified: row.format_identified,
            sortDate: row.sort_date,
            sortDateSource: row.sort_date_source,
            processingState: row.processing_state,
            processingDeferredReason: row.processing_deferred_reason,
            indexState: row.index_state,
            isDedupPrimary: row.is_dedup_primary === 1,
            extractionRoute: row.extraction_route,
            pagesRecognized: row.pages_recognized,
            createdAt: row.created_at,
          })),
          nextCursor: encodeDocumentCursor(page.nextCursor),
        },
        200,
      );
    },
  );

  app.openapi(
    {
      ...listReviewSetExceptionsRoute,
      middleware: chokepointMiddleware(chokepoint, listReviewSetExceptionsRoute),
    },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const query = c.req.valid("query");
      const access = accessFor(c);
      if (
        (await readVisibleReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId, access)) ===
        undefined
      ) {
        return notOnTheList(c);
      }
      const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
      const decoded = decodeCursor(query.cursor);
      // The walk resumes from the (document, exception) PAIR, because several reasons on one document
      // is normal and a page boundary can fall inside one. `createdAt` carries the document half of
      // the pair here — the platform cursor is a (sort key, id) pair and this read's sort key is the
      // document id.
      const [countsByCode, exceptions] = await Promise.all([
        readVisibleExceptionCounts(firm.firmDatabase, reviewSetId as ReviewSetId, access),
        readReviewSetExceptionPage(
          firm.firmDatabase,
          reviewSetId as ReviewSetId,
          access,
          decoded?.createdAt ?? null,
          decoded?.id ?? null,
          pageSize + 1,
        ),
      ]);
      const hasMore = exceptions.length > pageSize;
      const rows = hasMore ? exceptions.slice(0, pageSize) : exceptions;
      const last = rows.at(-1);
      return c.json(
        {
          countsByCode: countsByCode.map((count) => ({
            code: count.code,
            documentCount: count.document_count,
          })),
          data: rows.map((row) => ({
            id: row.exception_id,
            reviewDocumentId: row.review_document_id,
            discoveryLoadId: row.discovery_load_id,
            stage: row.stage,
            code: row.code,
            detail: row.detail,
            recordCustodianId: row.record_custodian_id,
            sourceName: row.source_name,
            processingState: row.processing_state,
            createdAt: row.created_at,
          })),
          nextCursor:
            hasMore && last !== undefined
              ? encodeCursor(last.review_document_id, last.exception_id)
              : null,
        },
        200,
      );
    },
  );

  app.openapi(
    { ...listOccurrencesRoute, middleware: chokepointMiddleware(chokepoint, listOccurrencesRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId, reviewDocumentId } = c.req.valid("param");
      const access = accessFor(c);
      if (
        (await readVisibleReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId, access)) ===
        undefined
      ) {
        return notOnTheList(c);
      }
      const { cursor } = c.req.valid("query");
      const page = await readVisibleOccurrences(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
        reviewDocumentId as ReviewDocumentId,
        access,
        MAXIMUM_PAGE_SIZE,
        cursor,
      );
      return c.json(
        {
          nextCursor: page.nextCursor,
          data: page.data.map((row) => ({
            id: row.id,
            primaryReviewDocumentId: row.primary_review_document_id,
            duplicateReviewDocumentId: row.duplicate_review_document_id,
            recordCustodianId: row.record_custodian_id,
            discoveryLoadId: row.discovery_load_id,
            createdAt: row.created_at,
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    { ...getIndexStatusRoute, middleware: chokepointMiddleware(chokepoint, getIndexStatusRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const { reviewSetId } = c.req.valid("param");
      const access = accessFor(c);
      if (
        (await readVisibleReviewSet(firm.firmDatabase, reviewSetId as ReviewSetId, access)) ===
        undefined
      ) {
        return notOnTheList(c);
      }
      const backlog = await readReviewSetIndexBacklog(
        firm.firmDatabase,
        reviewSetId as ReviewSetId,
      );
      return c.json(backlog, 200);
    },
  );
}
