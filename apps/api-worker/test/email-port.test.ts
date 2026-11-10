// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";

import { createLoggingEmailAdapter } from "../src/email-port";

describe("createLoggingEmailAdapter", () => {
  it("logs to, subject, and text so dev links land visibly in the terminal", async () => {
    const lines: string[] = [];
    const sendEmail = createLoggingEmailAdapter((line) => lines.push(line));

    await sendEmail({
      to: "practitioner@example.com",
      subject: "Verify your email",
      text: "Click here: https://example.com/verify?token=abc123",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("practitioner@example.com");
    expect(lines[0]).toContain("Verify your email");
    expect(lines[0]).toContain("https://example.com/verify?token=abc123");
  });
});
