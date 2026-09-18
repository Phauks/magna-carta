/*
 * Which Worker is minting. One deployment is several Workers — the API, the editor, the scanner,
 * the converter — and an Error ID a member quotes says nothing about which of them failed unless
 * the id carries it.
 *
 * Why this is module state rather than an argument threaded to every mint site. A Worker isolate
 * serves one script, so the value is a constant per isolate and there is nothing for concurrent
 * requests to race: the alternative is passing a code through two dozen call sites that have no
 * other reason to know it, where the failure mode is a site that quietly passes the wrong one.
 * Here the only failure mode is a Worker that never announced itself, and that mints `unk`, which
 * is legible in a log and impossible to mistake for a real service.
 *
 * It is announced from the module a Worker's events actually pass through, NOT from the entrypoint:
 * `apps/api-worker/src/index.ts` is held to a startup CPU budget that a static import of this
 * package would spend, so the call belongs in the lazily-imported dispatch module beside it.
 */

// Three characters, because the Error ID body is a fixed 21 and every character spent here is one
// taken from the random part. The full name is beside each code so a reader never has to guess.
export const SERVICE_CODES = {
  /** apps/api-worker — the API and the platform's background machinery. */
  api: "api",
  /** apps/edit-worker — the document-editing session host. */
  edt: "edt",
  /** apps/scan-worker — the malware-scan engine host. */
  scn: "scn",
  /** apps/convert-worker — the file-conversion engine host. */
  cnv: "cnv",
  /** apps/search-worker — the keyword-search engine host. */
  sch: "sch",
  /** No Worker announced itself. Never minted on purpose; it means a service is missing its call. */
  unk: "unk",
} as const;

export type ServiceCode = keyof typeof SERVICE_CODES;

export const SERVICE_CODE_LENGTH = 3;

let announced: ServiceCode = "unk";

/** Announce which Worker this isolate is. Called once, from the module a Worker's events pass through. */
export function setServiceIdentity(code: ServiceCode): void {
  announced = code;
}

/** The announced Worker, or `unk` where none announced itself. */
export function serviceIdentity(): ServiceCode {
  return announced;
}
