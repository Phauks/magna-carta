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

test("classifies IPv4-embedding IPv6 forms by the embedded address (hex and dotted)", () => {
  // The WHATWG URL parser canonicalizes IPv4-mapped IPv6 to hex hextets (::ffff:7f00:1), so a
  // dotted-only check would let loopback/metadata tunnel through as "public".
  expect(classifyHost("::ffff:7f00:1")).toBe("loopback"); // 127.0.0.1, hex
  expect(classifyHost("::ffff:127.0.0.1")).toBe("loopback"); // 127.0.0.1, dotted
  expect(classifyHost("::ffff:a9fe:a9fe")).toBe("link-local"); // 169.254.169.254 (cloud metadata)
  expect(classifyHost("::ffff:0a00:0001")).toBe("private"); // 10.0.0.1
  expect(classifyHost("::ffff:0808:0808")).toBe("public"); // 8.8.8.8
  expect(classifyHost("2002:7f00:1::")).toBe("loopback"); // 6to4 embedding 127.0.0.1
  expect(classifyHost("64:ff9b::a9fe:a9fe")).toBe("link-local"); // NAT64 embedding metadata
});

test("assertPublicTarget rejects a bracketed IPv4-mapped-IPv6 metadata/loopback URL", async () => {
  await expect(
    assertPublicTarget("http://[::ffff:169.254.169.254]/latest/meta-data"),
  ).rejects.toMatchObject({ targetClass: "link-local" });
  await expect(assertPublicTarget("http://[::ffff:127.0.0.1]/")).rejects.toMatchObject({
    targetClass: "loopback",
  });
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
