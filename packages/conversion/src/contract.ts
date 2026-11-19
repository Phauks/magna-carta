import { z } from "zod";
import { MAX_DIMENSION_LIMITS, QUALITY_LIMITS } from "./options.ts";

// The conversion contract: what the conversion routes accept in a request body and return in a
// response, as plain zod named with `.meta({ id })`. Path parameters stay with the routes in
// apps/api-worker/src/http/routes/documents/conversions.ts.

export const ConversionUploadResponse = z
  .object({
    jobId: z.string(),
    uploadUrl: z.string(),
    // The headers the upload must carry. They are covered by the URL's signature, so an upload that
    // sends anything less is rejected by storage rather than landing an object nothing can classify.
    uploadHeaders: z.record(z.string(), z.string()),
    sourceKey: z.string(),
  })
  .meta({ id: "ConversionUploadResponse" });

// A member's choices for the copy. Each is optional, and the set a conversion accepts depends on the
// engine that writes the copy (./options.ts): the raster engine reads all three, every other engine
// reads none. The route refuses a choice the conversion cannot honour rather than dropping it.
export const ConversionOptions = z
  .object({
    maxDimension: z
      .number()
      .int()
      .min(MAX_DIMENSION_LIMITS.minimum)
      .max(MAX_DIMENSION_LIMITS.maximum)
      .optional()
      .describe(
        "Shrink the image so its longest side is at most this many pixels. Never enlarges.",
      ),
    quality: z
      .number()
      .int()
      .min(QUALITY_LIMITS.minimum)
      .max(QUALITY_LIMITS.maximum)
      .optional()
      .describe("JPEG quality from 1 to 100. Only a JPEG target accepts it."),
    grayscale: z.boolean().optional().describe("Drop the colour and keep the lightness."),
  })
  .strict()
  .meta({ id: "ConversionOptions" });

export const ConversionSubmitRequest = z
  .object({
    jobId: z.string().min(1),
    sourceKey: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    options: ConversionOptions.optional(),
  })
  .meta({ id: "ConversionSubmitRequest" });

export const ConversionSubmitResponse = z
  .object({ jobId: z.string(), status: z.literal("queued") })
  .meta({ id: "ConversionSubmitResponse" });

export const ConversionStatusResponse = z
  .object({
    status: z.string(),
    url: z.string().optional(),
    mediaType: z.string().optional(),
    reason: z.string().optional(),
  })
  .meta({ id: "ConversionStatus" });
