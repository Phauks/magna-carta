import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { createPangramAdapter } from "@magna-carta/ai-detection/adapters/pangram";
import { externalDetectionEnabledDefinition } from "@magna-carta/ai-detection/settings";
import { recordAiDetectionUsageStatement } from "@magna-carta/data-access/ai-detection-usage-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { fetchHttpClient } from "@magna-carta/integrations/http";
import type { Bindings } from "../bindings.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// AI-Text Detection: send pasted text to the platform-managed detector and return a calibrated
// likelihood band (a signal, never a boolean verdict). Firm consent (default off) is enforced here —
// the single gate — before any provider call; privileged text never egresses on an implicit yes.
// Backend only; the UI lands with the design-system shell. Nothing is stored except the usage meter.

const REALTIME_RATE_MINOR_PER_1000_WORDS = 5; // indicative snapshot; word_count is the billing unit

const detectMeta: RouteMeta = {
  operationId: "aiDetection.detect",
  surface: "app",
  authenticated: true,
  permission: "tools:aiTextDetection",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

const DetectRequest = z
  .object({
    text: z.string().min(1),
    languageHint: z.string().optional(),
    matterId: z.string().optional(),
  })
  .openapi("AiDetectionDetectRequest");

const SegmentSchema = z.object({
  startCharacter: z.number(),
  endCharacter: z.number(),
  score: z.number(),
  band: z.enum(["unlikely", "mixed", "likely", "inconclusive"]),
});
const DetectResponse = z
  .object({
    band: z.enum(["unlikely", "mixed", "likely", "inconclusive"]),
    score: z.number(),
    reliability: z.enum(["high", "moderate", "low"]),
    caveats: z.array(z.string()),
    segments: z.array(SegmentSchema).optional(),
    provenance: z.object({
      adapterId: z.string(),
      vendorModel: z.string().optional(),
      vendorVersion: z.string().optional(),
      detectedAt: z.string(),
      egressedTo: z.string(),
    }),
  })
  .openapi("AiDetectionReport");

const detectRoute = defineOpenAPIRoute(detectMeta, {
  method: "post",
  path: "/api/v1/ai-detection/detect",
  description:
    "Estimate the likelihood that pasted text was machine-generated. Returns a coarse likelihood " +
    "band with an explicit reliability grade and the reasons to hesitate — a signal, not proof. " +
    "Requires the firm to have enabled external detection; text is sent to the configured provider " +
    "and is not retained. Nothing is stored except a usage meter entry.",
  request: {
    body: { content: { "application/json": { schema: DetectRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The detection report",
      content: { "application/json": { schema: DetectResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks tools:aiTextDetection",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "External detection is disabled for this firm, or detection is unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    502: {
      description: "The detection provider rejected the request or is unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function registerAiDetectionRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...detectRoute, middleware: chokepointMiddleware(chokepoint, detectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const userId = requireChokepointUserId(c);
      const { text, languageHint, matterId } = c.req.valid("json");

      // Consent gate — the single enforcement point. Off (or unset) → refuse before any provider call.
      const enabled = await readFirmSetting(firm.firmDatabase, externalDetectionEnabledDefinition);
      if (!enabled) {
        return problemJson(c, {
          type: "validation",
          title: "External AI-text detection is disabled",
          status: 422,
          detail: "Enable external detection in firm settings before using this tool.",
        });
      }

      // No platform key configured → refuse honestly rather than construct a dead adapter or make a
      // network call. Deterministic in every environment without a PANGRAM_API_KEY secret.
      const apiKey = c.env.PANGRAM_API_KEY;
      if (apiKey === undefined || apiKey === "") {
        return problemJson(c, {
          type: "validation",
          title: "Detection unavailable",
          status: 422,
          detail: "AI-text detection is not currently available.",
        });
      }

      const mode = c.env.PANGRAM_MODE === "sync" ? ("sync" as const) : ("async-task" as const);
      const defaultBaseUrl =
        mode === "sync"
          ? "https://text.api.pangram.com/v3"
          : "https://text.external-api.pangram.com";
      const port = createPangramAdapter({
        http: fetchHttpClient(),
        apiKey,
        baseUrl: c.env.PANGRAM_BASE_URL ?? defaultBaseUrl,
        mode,
        now: () => new Date().toISOString(),
        // The poll delay lives here (the pure adapter is timer-free). A queued microtask timer is
        // enough — polling is I/O wait between fetches, not CPU.
        sleep: (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
      });

      const result = await port.detect({ text, languageHint, firmId });
      if (!result.ok) {
        if (result.reason === "capability-unsupported") {
          return problemJson(c, {
            type: "validation",
            title: "Detection unavailable",
            status: 422,
            detail: "AI-text detection is not currently available.",
          });
        }
        return problemJson(c, {
          type: "conflict",
          title: "The detection provider is unavailable",
          status: 502,
        });
      }

      // Meter one row per successful detection (word count is the billing-relevant unit). Off the
      // response's critical correctness path but committed before returning so the record is durable.
      const words = wordCount(text);
      const now = () => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            recordAiDetectionUsageStatement(firm.firmDatabase, {
              id: newIdentifier("aiDetectionUsage"),
              requestedBy: userId,
              wordCount: words,
              mode: "realtime",
              costMinor: Math.round((words * REALTIME_RATE_MINOR_PER_1000_WORDS) / 1000),
              adapterId: result.value.provenance.adapterId,
              vendorVersion: result.value.provenance.vendorVersion ?? null,
              resultBand: result.value.band,
              matterId: matterId ?? null,
              createdAt: now(),
            }),
          ],
          outboxMessages: [],
        },
        { now },
      );

      // Map the domain report onto the wire contract. DetectionReport's arrays are readonly (the pure
      // core never hands out mutable state); the response schema's inferred type is mutable, so copy
      // the arrays/objects at the boundary rather than leaking readonly types into the contract.
      const report = result.value;
      return c.json(
        {
          band: report.band,
          score: report.score,
          reliability: report.reliability,
          caveats: [...report.caveats],
          ...(report.segments !== undefined
            ? { segments: report.segments.map((segment) => ({ ...segment })) }
            : {}),
          provenance: { ...report.provenance },
        },
        200,
      );
    },
  );
}
