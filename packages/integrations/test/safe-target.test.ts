import { test, expect } from "vitest";
import { classifyHost, assertPublicTarget, SsrfRejection } from "../src/safe-target.ts";

test("classifies private and loopback IP literals", () => {
  expect(classifyHost("127.0.0.1")).toBe("loopback");
  expect(classifyHost("10.0.0.5")).toBe("private");
  expect(classifyHost("192.168.1.1")).toBe("private");
  expect(classifyHost("172.16.0.1")).toBe("private");
  expect(classifyHost("169.254.169.254")).toBe("link-local");
  expect(classifyHost("::1")).toBe("loopback");
  expect(classifyHost("fc00::1")).toBe("private"); // IPv6 unique-local
  expect(classifyHost("ff02::1")).toBe("reserved"); // IPv6 multicast
  expect(classifyHost("8.8.8.8")).toBe("public");
  expect(classifyHost("example.com")).toBe("public");
});

test("assertPublicTarget rejects non-http schemes", async () => {
  await expect(assertPublicTarget("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfRejection);
  await expect(assertPublicTarget("ftp://example.com")).rejects.toBeInstanceOf(SsrfRejection);
});

test("assertPublicTarget rejects a literal private IP URL", async () => {
  await expect(assertPublicTarget("http://169.254.169.254/latest/meta-data")).rejects.toMatchObject(
    {
      targetClass: "link-local",
    },
  );
});

test("assertPublicTarget upgrades a bare host and accepts a public name", async () => {
  const parsed = await assertPublicTarget("example.com");
  expect(parsed.url.protocol).toBe("https:");
  expect(parsed.host).toBe("example.com");
});

test("assertPublicTarget rejects when the resolver returns a private IP (DNS-rebinding defense)", async () => {
  const resolve = async () => ["10.1.2.3"];
  await expect(assertPublicTarget("https://evil.example", resolve)).rejects.toMatchObject({
    targetClass: "private",
  });
});
