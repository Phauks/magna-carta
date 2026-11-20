/*
 * The bot check's plumbing for the signed-out screens: where its public site key comes from, how
 * the Cloudflare Turnstile script is loaded, and the two headers a solution travels in.
 *
 * The site key is asked of the server rather than baked into the build, because the server answers
 * one only when it will also check the solution (apps/api-worker/src/http/routes/session/
 * human-verification-settings.ts). A `null` key means the bot check is not set up: no widget is
 * drawn, no header is sent, and the server asks for none. So the screen and the server can never
 * disagree about whether a solution is needed.
 */

import { humanVerificationSettings } from "@magna-carta/api-client";

/** The header the platform's own joining endpoints read a solution from. */
export const HUMAN_VERIFICATION_TOKEN_HEADER = "x-human-verification-token";

/** The problem type the server answers a missing or rejected solution with. */
export const HUMAN_VERIFICATION_REQUIRED_PROBLEM_TYPE =
  "https://api.magnacarta.esq/problems/human-verification-required";

/** What a screen says when the server refused the solution, or the check never finished. */
export const HUMAN_CHECK_FAILED =
  "The security check didn't finish. Wait a moment for it to complete, then try again.";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The part of the Turnstile browser API this app calls. */
export interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let siteKeyRequest: Promise<string | null> | null = null;

/**
 * The site key, or `null` when the bot check is not set up. Asked once per page load; a request
 * that got no answer is not remembered, so the next screen asks again.
 */
export function loadSiteKey(fetchImplementation: typeof fetch): Promise<string | null> {
  siteKeyRequest ??= humanVerificationSettings({ fetch: fetchImplementation, throwOnError: true })
    .then(({ data }) => data.siteKey)
    .catch(() => {
      siteKeyRequest = null;
      return null;
    });
  return siteKeyRequest;
}

let scriptRequest: Promise<TurnstileApi | null> | null = null;

/** Load Cloudflare's widget script once per page. Resolves `null` if it cannot be loaded. */
export function loadTurnstile(): Promise<TurnstileApi | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.turnstile !== undefined) return Promise.resolve(window.turnstile);
  scriptRequest ??= new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () => resolve(window.turnstile ?? null));
    script.addEventListener("error", () => {
      scriptRequest = null;
      script.remove();
      resolve(null);
    });
    document.head.append(script);
  });
  return scriptRequest;
}

/** The headers a solution travels in on the platform's own endpoints, or none without one. */
export function humanVerificationHeaders(solution: string | null): Record<string, string> {
  return solution === null ? {} : { [HUMAN_VERIFICATION_TOKEN_HEADER]: solution };
}

/**
 * Whether a refusal is the bot check's own, as opposed to any other 403. Takes the platform's
 * problem record and Better Auth's client error alike: the client spreads the response body into
 * its error, so the problem's `type` is on both.
 */
export function isHumanCheckRefusal(refusal: object | null | undefined): boolean {
  return (
    refusal !== null &&
    refusal !== undefined &&
    "type" in refusal &&
    refusal.type === HUMAN_VERIFICATION_REQUIRED_PROBLEM_TYPE
  );
}
