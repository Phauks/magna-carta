import { Container, ContainerProxy } from "@cloudflare/containers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddressBuildContainer } from "../src/address-build-container.ts";
import { AddressIndexContainer } from "../src/address-index-container.ts";
import { ADDRESS_OBJECT_HOST } from "../src/object-host.ts";
import { ADDRESS_SOURCE_HOST } from "../src/source-host.ts";
import { memoryBucket, type MemoryBucket } from "./fakes/memory-bucket.ts";

// The containers' intercepted hosts, run through the library's own dispatch. A handler declared as a
// static field rather than assigned through Container's setter is intercepted by the runtime yet
// invisible to the proxy, which then refuses every call with a 520 — only the library's dispatch, run
// against these classes, tells the two registrations apart.

type ProxyArguments = ConstructorParameters<typeof ContainerProxy>;

function proxyFor(
  containerClass: typeof AddressIndexContainer | typeof AddressBuildContainer,
  storage: MemoryBucket,
): ContainerProxy {
  const props = {
    className: containerClass.name,
    containerId: "address-under-test",
    enableInternet: false,
    interceptAll: false,
  };
  return new ContainerProxy(
    { props } as unknown as ProxyArguments[0],
    { ADDRESS_INDEX: storage.bucket } as unknown as ProxyArguments[1],
  );
}

function registeredHosts(containerClass: object): string[] {
  const registered = Object.getOwnPropertyDescriptor(Container, "outboundByHost")?.get?.call(
    containerClass,
  ) as Record<string, unknown> | undefined;
  return Object.keys(registered ?? {}).toSorted();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registration", () => {
  it("files each class's hosts through Container's setter, not an own property that shadows it", () => {
    for (const containerClass of [AddressIndexContainer, AddressBuildContainer]) {
      expect(Object.getOwnPropertyDescriptor(containerClass, "outboundByHost")).toBeUndefined();
    }
    expect(registeredHosts(AddressIndexContainer)).toEqual([ADDRESS_OBJECT_HOST]);
    expect(registeredHosts(AddressBuildContainer)).toEqual(
      [ADDRESS_OBJECT_HOST, ADDRESS_SOURCE_HOST].toSorted(),
    );
  });

  it("names the same internal object host the container calls", () => {
    // Duplicated in containers/address on purpose; pinned here so a rename on one side fails a test
    // rather than turning every engine read into blocked egress.
    expect(ADDRESS_OBJECT_HOST).toBe("addresses.magna-carta.internal");
  });
});

describe("the query container", () => {
  it("reads the index through the object host", async () => {
    const storage = memoryBucket();
    storage.put("us/build-1/west.split", new Uint8Array(64));
    const response = await proxyFor(AddressIndexContainer, storage).fetch(
      new Request(`http://${ADDRESS_OBJECT_HOST}/objects/us/build-1/west.split`, {
        headers: { range: "bytes=0-15" },
      }),
    );
    expect(response.status).toBe(206);
    expect((await response.arrayBuffer()).byteLength).toBe(16);
  });

  it("cannot write through the object host", async () => {
    const storage = memoryBucket();
    const response = await proxyFor(AddressIndexContainer, storage).fetch(
      new Request(`http://${ADDRESS_OBJECT_HOST}/objects/us/current.json`, {
        method: "PUT",
        body: "{}",
      }),
    );
    expect(response.status).toBe(404);
    expect(storage.objects.size).toBe(0);
  });

  it("has no source host and no internet", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const proxy = proxyFor(AddressIndexContainer, memoryBucket());
    for (const url of [`http://${ADDRESS_SOURCE_HOST}/api/data`, "https://example.com/"]) {
      const response = await proxy.fetch(new Request(url));
      // 520 is the library's own refusal for a host nothing handles.
      expect(response.status, url).toBe(520);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the build container", () => {
  it("publishes through the object host", async () => {
    const storage = memoryBucket();
    const response = await proxyFor(AddressBuildContainer, storage).fetch(
      new Request(`http://${ADDRESS_OBJECT_HOST}/objects/us/current.json`, {
        method: "PUT",
        body: '{"build":"build-1"}',
      }),
    );
    expect(response.status).toBe(204);
    expect(storage.objects.has("us/current.json")).toBe(true);
  });

  it("reaches OpenAddresses through the source host, and nowhere else", async () => {
    const fetchSpy = vi.fn((input: string) => Promise.resolve(Response.json({ fetched: input })));
    vi.stubGlobal("fetch", fetchSpy);
    const proxy = proxyFor(AddressBuildContainer, memoryBucket());

    const allowed = await proxy.fetch(new Request(`http://${ADDRESS_SOURCE_HOST}/api/data`));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ fetched: "https://batch.openaddresses.io/api/data" });

    const refusedPath = await proxy.fetch(new Request(`http://${ADDRESS_SOURCE_HOST}/api/login`));
    expect(refusedPath.status).toBe(404);
    const refusedHost = await proxy.fetch(new Request("https://batch.openaddresses.io/api/data"));
    expect(refusedHost.status).toBe(520);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
