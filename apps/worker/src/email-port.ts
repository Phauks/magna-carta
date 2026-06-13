// The outbound-email seam: Better Auth's verification/reset senders call through this port,
// and slice 0·6 swaps in real transactional email (Cloudflare Email Service) behind the same signature.
export interface SendEmail {
  (message: { to: string; subject: string; text: string }): Promise<void>;
}

// Dev adapter: logs the message so verification/reset links land in the terminal.
// The text intentionally carries auth links — dev terminal only; nothing beyond the message fields is logged.
export function createLoggingEmailAdapter(log: (line: string) => void = console.log): SendEmail {
  return (message) => {
    log(`[email] to=${message.to} subject=${message.subject}\n${message.text}`);
    return Promise.resolve();
  };
}
