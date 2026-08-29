/*
 * The one place the password-reset mail's link is built.
 *
 * The mail links STRAIGHT at the screen that spends the token (/login/reset-password?token=...),
 * never at Better Auth's own /api/auth/reset-password/{token} redirect hop: that hop spends the
 * token on a bare GET — which a mail client's link preview or a security scanner performs without
 * anyone asking — and with no callback URL it strands the visitor on the library's error page. The
 * screen instead reads `?token=` into a form and spends it only when a new password is submitted.
 *
 * The origin is taken from the request when there is one (request-serving paths derive their own
 * origin), and from APP_BASE_URL for the paths that have no request — the firm-provision consumer's
 * owner-activation mail is the one that matters, since a queue consumer serves nobody. When neither
 * exists (local development with no APP_BASE_URL set), the link degrades to the bare path plus the
 * token, which the dev logging email adapter prints to the terminal — still enough to complete the
 * flow by hand.
 */

const PASSWORD_RESET_SCREEN_PATH = "/login/reset-password";

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === "/".charCodeAt(0)) end -= 1;
  return value.slice(0, end);
}

export function passwordResetScreenLink(input: {
  token: string;
  /** The URL of the request that asked for the reset, when one exists. */
  requestUrl?: string;
  /** The deployment's public origin, for the background paths that have no request. */
  appBaseUrl?: string;
}): string {
  const origin =
    input.requestUrl !== undefined
      ? new URL(input.requestUrl).origin
      : input.appBaseUrl !== undefined && input.appBaseUrl !== ""
        ? trimTrailingSlashes(input.appBaseUrl)
        : "";
  return `${origin}${PASSWORD_RESET_SCREEN_PATH}?token=${encodeURIComponent(input.token)}`;
}

/** The reset mail's whole body. The link works once; Better Auth expires the token after an hour. */
export function passwordResetEmailText(link: string): string {
  return (
    `Set your Magna Carta password here:\n\n${link}\n\n` +
    `The link works once and expires in one hour. If you did not ask for it, no action is needed.`
  );
}
