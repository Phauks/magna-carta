// The outbound-email seam: Better Auth's verification/reset senders call through this port,
// and slice 0·6's Cloudflare Email Service adapter implements it behind the same signature.
// messageClass is an optional non-content tag (e.g. "password-reset") the telemetry email.sent
// event records — never the body. Defaults to "unspecified" at the adapter when omitted.
export interface SendEmail {
  (message: { to: string; subject: string; text: string; messageClass?: string }): Promise<void>;
}

// Dev adapter: logs the message so verification/reset links land in the terminal.
// The text intentionally carries auth links — dev terminal only; nothing beyond the message fields is logged.
export function createLoggingEmailAdapter(log: (line: string) => void = console.log): SendEmail {
  return (message) => {
    log(`[email] to=${message.to} subject=${message.subject}\n${message.text}`);
    return Promise.resolve();
  };
}
