/*
 * The CORS policy every bucket a browser uploads to must carry — the one home for its rules.
 *
 * The file-manager upload PUTs bytes from the browser straight to a presigned URL on the firm's
 * bucket. That is a cross-origin request, so the bucket has to answer the preflight, and a bucket
 * with no policy refuses it before a byte moves: the app can then only report that nothing
 * answered. Provisioning applies this set to every new firm bucket (firm-resource-provider.ts);
 * a bucket that predates that step takes it by hand, pasted from `pnpm run emit-r2-cors`, which
 * prints this array as the JSON the R2 dashboard accepts (docs/conventions/operations.md, §15).
 *
 * Kept in R2's DASHBOARD shape (AllowedOrigins, AllowedMethods, …) rather than the REST API's,
 * because the by-hand path is the one a person reads; the translation to the API's shape is below.
 */

export interface BrowserUploadCorsRule {
  readonly AllowedOrigins: readonly string[];
  readonly AllowedMethods: readonly string[];
  readonly AllowedHeaders: readonly string[];
  readonly ExposeHeaders: readonly string[];
  readonly MaxAgeSeconds: number;
}

export const BROWSER_UPLOAD_CORS_RULES: readonly BrowserUploadCorsRule[] = [
  {
    // Every origin a browser uploads from: the custom-domain origins, and the two workers.dev serving
    // origins wrangler keeps live (`workers_dev: true`). A preview environment used for the upload
    // acceptance gate is added here. No wildcard — the presigned URL already scopes the credential,
    // and the origin allow-list is a second wall.
    AllowedOrigins: [
      "https://magnacarta.esq",
      "https://app.magnacarta.esq",
      "https://magna-carta.trevordgoldsmith.workers.dev",
      "https://magna-carta-web.trevordgoldsmith.workers.dev",
    ],
    // GET for presigned download and preview fetches; PUT for the single-shot and multipart part
    // uploads. Multipart create/complete/abort are Worker-to-R2 and never preflighted.
    AllowedMethods: ["GET", "PUT"],
    // The presigned PUT SIGNS these (files/presign.ts), so the browser must send them, and a policy
    // that does not allow them fails every upload at the preflight. A new signed dimension header is
    // added here in the same change.
    AllowedHeaders: ["content-type", "x-amz-meta-matter", "x-amz-meta-object_class"],
    // Multipart cannot complete without the client reading each part's ETag.
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3600,
  },
];

/**
 * The rule set in the REST API's shape, extra origins (the deployment's own APP_BASE_URL) folded in
 * once. What `PUT /accounts/{account}/r2/buckets/{bucket}/cors` takes under `rules`.
 */
export function browserUploadCorsRules(extraOrigins: readonly string[] = []) {
  return BROWSER_UPLOAD_CORS_RULES.map((rule, at) => ({
    id: at === 0 ? "browser-direct-upload" : `browser-direct-upload-${String(at + 1)}`,
    allowed: {
      origins: [...new Set([...rule.AllowedOrigins, ...extraOrigins])],
      methods: [...rule.AllowedMethods],
      headers: [...rule.AllowedHeaders],
    },
    exposeHeaders: [...rule.ExposeHeaders],
    maxAgeSeconds: rule.MaxAgeSeconds,
  }));
}
