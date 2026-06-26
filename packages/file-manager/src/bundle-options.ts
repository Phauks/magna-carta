import { z } from "zod";

// The serializable description of a bundle the user asked for. The encryption PASSWORD is intentionally
// absent: it is supplied per request and never stored or hashed, so it can never leak through an options
// value persisted in a queue message, a cache key, or a log line.

export const BUNDLE_FORMATS = ["zip", "sevenZip"] as const;
export type BundleFormat = (typeof BUNDLE_FORMATS)[number];

export const COMPRESSION_LEVELS = ["store", "normal", "maximum"] as const;
export type CompressionLevel = (typeof COMPRESSION_LEVELS)[number];

export const bundleOptionsSchema = z.object({
  format: z.enum(BUNDLE_FORMATS),
  compression: z.enum(COMPRESSION_LEVELS),
  encryption: z
    .object({ algorithm: z.literal("aes-256"), encryptFileNames: z.boolean() })
    .nullable(),
  split: z.object({ maxPartBytes: z.number().int().positive() }).nullable(),
  outputName: z.string().min(1).max(255),
  wrapperFolder: z.object({ name: z.string().min(1) }).nullable(),
  layout: z.enum(["preserveTree", "flatten"]),
  manifest: z.boolean(),
});

export type BundleOptions = z.infer<typeof bundleOptionsSchema>;

export const DEFAULT_BUNDLE_OPTIONS: BundleOptions = {
  format: "zip",
  compression: "store",
  encryption: null,
  split: null,
  outputName: "bundle.zip",
  wrapperFolder: null,
  layout: "preserveTree",
  manifest: false,
};

export function parseBundleOptions(input: unknown): BundleOptions {
  return bundleOptionsSchema.parse(input);
}
