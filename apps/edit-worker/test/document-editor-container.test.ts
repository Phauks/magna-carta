import { Container, ContainerProxy } from "@cloudflare/containers";
import { describe, expect, it } from "vitest";
import { DocumentEditorContainer, WOPI_HOST } from "../src/document-editor-container.ts";

// This is the one test that imports the Container class: it exists because the defect it holds against
// cannot be seen from outside the class. The WOPI handler was once declared as a static field, which
// under this repository's class-field semantics defines an own property that shadows Container's static
// setter — so the runtime intercepted the host (read off the property) while the library's proxy found
// no handler (read off the registry the setter fills) and answered coolwsd 520 for every CheckFileInfo.
// Only the library's own dispatch, run against this class, tells the two registrations apart.

// A token in the shape the editor carries, so the forwarded URL under test is the real shape of coolwsd's
// callback. Synthetic: the signature is not a MAC.
const TOKEN =
  "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJmaXh0dXJlIiwiZmlybUlkIjoiZmlybV9maXh0dXJlIiwiY2FwYWJpbGl0eSI6ImVkaXQifQ.fixture-signature-not-a-real-mac-0000000000";

type ProxyArguments = ConstructorParameters<typeof ContainerProxy>;

function fakeAppWorker() {
  const received: Request[] = [];
  return {
    received,
    fetch(request: Request): Promise<Response> {
      received.push(request);
      return Promise.resolve(
        new Response('{"BaseFileName":"brief.docx"}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  };
}

// The proxy the runtime hands an intercepted request to, built the way the library builds it for this
// class: the props name the class, and the class name is the key the handler registry is read under.
// `enableInternet` false and no allow-list, exactly as the class declares them.
function proxyFor(appWorker: ReturnType<typeof fakeAppWorker>): ContainerProxy {
  const props = {
    className: DocumentEditorContainer.name,
    containerId: "document-editor-under-test",
    enableInternet: false,
    interceptAll: false,
  };
  return new ContainerProxy(
    { props } as unknown as ProxyArguments[0],
    { APP_WORKER: appWorker } as unknown as ProxyArguments[1],
  );
}

describe("DocumentEditorContainer.outboundByHost", () => {
  it("is registered through Container's setter, not defined as an own property that shadows it", () => {
    // A static field would leave an own property here. The registry the proxy reads is filled only by
    // the inherited setter, and Container's own getter is the one read that goes to that registry.
    expect(
      Object.getOwnPropertyDescriptor(DocumentEditorContainer, "outboundByHost"),
    ).toBeUndefined();
    const registered = Object.getOwnPropertyDescriptor(Container, "outboundByHost")?.get?.call(
      DocumentEditorContainer,
    ) as Record<string, unknown> | undefined;
    expect(registered?.[WOPI_HOST]).toBeTypeOf("function");
  });

  it("forwards coolwsd's CheckFileInfo to the app worker through the library's own dispatch", async () => {
    const appWorker = fakeAppWorker();
    const callback = new Request(
      `http://${WOPI_HOST}/wopi/files/file_abc?access_token=${TOKEN}&access_token_ttl=0`,
    );

    const response = await proxyFor(appWorker).fetch(callback);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ BaseFileName: "brief.docx" });
    expect(appWorker.received).toHaveLength(1);
    // Forwarded verbatim: the app worker re-verifies the token it finds on the URL, so the URL is the
    // callback's own, query included.
    expect(appWorker.received[0]?.url).toBe(callback.url);
  });

  it("refuses every other host, because the container has no general egress", async () => {
    const appWorker = fakeAppWorker();

    const response = await proxyFor(appWorker).fetch(new Request("https://example.com/"));

    // 520 is the library's own refusal — the answer coolwsd was getting for the WOPI host itself
    // before the handler was registered where the proxy reads.
    expect(response.status).toBe(520);
    expect(appWorker.received).toEqual([]);
  });
});
