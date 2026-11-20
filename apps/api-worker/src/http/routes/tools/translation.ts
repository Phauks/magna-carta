import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import {
  TranslateRequest,
  TranslateResponse,
  TranslationLanguagesResponse,
} from "@magna-carta/translation/contract";
import {
  passagesOf,
  type Language,
  type TranslationFailure,
  type TranslationPort,
} from "@magna-carta/translation/port";
import type { Context } from "hono";
import type { Bindings } from "../../../bindings.ts";
import { resolveTranslationPort } from "../../../translation/translation-engine.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The Translate tool: a member pastes text, names a language, and gets each paragraph back beside its
// translation. One gate before any text leaves: the member's tools:translation, at the chokepoint,
// which a firm grants or withholds per role. Then a fact the firm does not control: whether this
// deployment has an engine at all (translation/translation-engine.ts). Translation is its own
// service, not one of the AI features, so the AI settings do not reach it.
//
// NOTHING OF THE TEXT IS KEPT. The firm's log records that a run happened: who, when, which engine,
// which languages, how many characters and for which matter, so the firm can answer what it sent to
// whom. The text and the translation are in the response and nowhere else.

type TranslationApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
type TranslationContext = Context<{ Bindings: Bindings; Variables: AppVariables }>;

export interface TranslationRouteDeps {
  /** Which engine a request gets. Tests inject a port; production reads the key from `env`. */
  readonly resolvePort?: (env: Bindings) => TranslationPort;
}

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: Problem } },
});

const translateMeta: RouteMeta = {
  operationId: "translation.translate",
  surface: "app",
  authenticated: true,
  permission: "tools:translation",
  resource: "firm",
  // Every run writes a row to the firm's log: the record of what was sent to the engine, without
  // the text.
  audited: true,
  idempotency: "optional",
  rateLimit: "expensive",
};

const languagesMeta: RouteMeta = {
  operationId: "translation.languages",
  surface: "app",
  authenticated: true,
  permission: "tools:translation",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const translateRoute = defineOpenAPIRoute(translateMeta, {
  method: "post",
  path: "/api/v1/translation/translate",
  description:
    "Translates pasted text with the firm's translation engine (Google Cloud Translation). The " +
    "text is split at blank lines and each paragraph comes back beside its translation. The firm " +
    "must have turned translation on. The text is sent to the engine and kept nowhere; the firm's " +
    "log records who ran it, the languages, the engine and the character count. The result is a " +
    "machine translation and not a certified one.",
  request: {
    body: { content: { "application/json": { schema: TranslateRequest } }, required: true },
  },
  responses: {
    200: {
      description: "Each paragraph beside its translation",
      content: { "application/json": { schema: TranslateResponse } },
    },
    401: problem("No valid session"),
    403: problem("The session member lacks tools:translation"),
    422: problem(
      "No engine is set up, the text has nothing to translate, a paragraph is too long, or the " +
        "engine refused the request",
    ),
    429: problem("Rate limit exceeded"),
    502: problem("The translation engine did not answer"),
  },
});

const languagesRoute = defineOpenAPIRoute(languagesMeta, {
  method: "get",
  path: "/api/v1/translation/languages",
  description:
    "The languages the firm's translation engine can translate between, named in the display " +
    "language asked for (English by default).",
  request: {
    query: z.object({
      display: z
        .string()
        .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u)
        .optional(),
    }),
  },
  responses: {
    200: {
      description: "The engine's languages, sorted by name",
      content: { "application/json": { schema: TranslationLanguagesResponse } },
    },
    401: problem("No valid session"),
    403: problem("The session member lacks tools:translation"),
    422: problem("No translation engine is set up"),
    429: problem("Rate limit exceeded"),
    502: problem("The translation engine did not answer"),
  },
});

// The engine's language list is public reference data, the same for every firm, so it is kept per
// isolate for a day rather than asked for on every page open. It carries nothing of any firm's.
const LANGUAGES_KEPT_MILLISECONDS = 24 * 60 * 60 * 1000;
const keptLanguages = new Map<
  string,
  { readonly at: number; readonly value: readonly Language[] }
>();

function failureProblem(c: TranslationContext, failure: TranslationFailure) {
  switch (failure.reason) {
    case "not-configured":
      return problemJson(c, {
        type: "validation",
        title: "Translation is not set up",
        status: 422,
        detail: "No translation engine is set up yet.",
      });
    case "too-long":
      return problemJson(c, {
        type: "validation",
        title: "A paragraph is too long",
        status: 422,
        detail: "Split the longest paragraph and translate again.",
      });
    case "refused":
      return problemJson(c, {
        type: "validation",
        title: "The translation service refused the request",
        status: 422,
        detail: failure.detail,
      });
    case "unavailable":
      return problemJson(c, {
        type: "conflict",
        title: "The translation service did not answer",
        status: 502,
      });
  }
}

export function registerTranslationRoutes(
  app: TranslationApp,
  chokepoint: Chokepoint,
  deps: TranslationRouteDeps = {},
): void {
  const portFor = deps.resolvePort ?? resolveTranslationPort;

  app.openapi(
    { ...languagesRoute, middleware: chokepointMiddleware(chokepoint, languagesRoute) },
    async (c) => {
      const display = c.req.valid("query").display ?? "en";
      const kept = keptLanguages.get(display);
      if (kept !== undefined && Date.now() - kept.at < LANGUAGES_KEPT_MILLISECONDS) {
        return c.json({ languages: kept.value.map((language) => ({ ...language })) }, 200);
      }
      const result = await portFor(c.env).languages(display);
      if (!result.ok) return failureProblem(c, result);
      keptLanguages.set(display, { at: Date.now(), value: result.value });
      return c.json({ languages: result.value.map((language) => ({ ...language })) }, 200);
    },
  );

  app.openapi(
    { ...translateRoute, middleware: chokepointMiddleware(chokepoint, translateRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { text, target, source, matterId } = c.req.valid("json");

      const passages = passagesOf(text);
      if (passages.length === 0) {
        return problemJson(c, {
          type: "validation",
          title: "There is nothing to translate",
          status: 422,
        });
      }

      const result = await portFor(c.env).translate({
        passages,
        target,
        ...(source === undefined ? {} : { source }),
      });
      if (!result.ok) return failureProblem(c, result);

      // Google charges by the characters it is sent, so that is the figure the log keeps.
      const characters = passages.reduce((sum, passage) => sum + passage.length, 0);
      const resolvedSource = source ?? result.value.detectedSource ?? null;
      const now = () => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "translation.translated",
              actorUserId: userId,
              subjectId: null,
              // Languages, counts, the engine and the matter named: nothing the member pasted.
              metadata: {
                engine: result.value.engine,
                source: resolvedSource,
                target,
                characters,
                paragraphs: passages.length,
                matterId: matterId ?? null,
              },
              now: now(),
            }),
          ],
          outboxMessages: [],
        },
        { now },
      );

      return c.json(
        {
          passages: passages.map((original, index) => ({
            original,
            translation: result.value.passages[index] ?? "",
          })),
          source: resolvedSource,
          target,
          engine: result.value.engine,
          characters,
        },
        200,
      );
    },
  );
}
