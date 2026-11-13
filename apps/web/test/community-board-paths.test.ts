import { describe, expect, it } from "vitest";
import { boardPath, boardRouteFor, isCommunityHost } from "../src/lib/community/board-paths.ts";
import { reroute } from "../src/hooks.ts";

describe("the community board's paths", () => {
  it("treats only a community. host as the board's own", () => {
    expect(isCommunityHost("community.magnacarta.esq")).toBe(true);
    expect(isCommunityHost("magnacarta.esq")).toBe(false);
    expect(isCommunityHost("localhost")).toBe(false);
  });

  it("links by the short path on the board's host and by the route elsewhere", () => {
    expect(boardPath("/posts/12", "community.magnacarta.esq")).toBe("/posts/12");
    expect(boardPath("/posts/12", "localhost")).toBe("/community-board/posts/12");
    expect(boardPath("/", "localhost")).toBe("/community-board");
    expect(boardRouteFor("/")).toBe("/community-board");
  });

  it("reroutes the board's host to the board's routes and leaves the app alone", () => {
    const at = (href: string) =>
      reroute({ url: new URL(href), fetch } as Parameters<typeof reroute>[0]);
    expect(at("https://community.magnacarta.esq/")).toBe("/community-board");
    expect(at("https://community.magnacarta.esq/questions")).toBe("/community-board/questions");
    expect(at("https://magnacarta.esq/matters")).toBeUndefined();
    expect(at("https://changelog.magnacarta.esq/")).toBe("/community-board/changelog");
  });

  it("links from the changelog's own address back to the board's", () => {
    expect(boardPath("/changelog", "changelog.magnacarta.esq")).toBe("/");
    expect(boardPath("/questions", "changelog.magnacarta.esq")).toBe(
      "https://community.magnacarta.esq/questions",
    );
  });
});
