import { describe, expect, it } from "vitest";
import { citationHtml } from "../src/lib/components/formatted-citation/citation-html.ts";

describe("citationHtml", () => {
  it("italicizes italic runs and escapes every run", () => {
    expect(
      citationHtml([
        { text: "Smith & Sons <Ltd.> v. Jones", italic: true },
        { text: ', 1 U.S. 2 ("quoted") (1800).', italic: false },
      ]),
    ).toBe("<i>Smith &amp; Sons &lt;Ltd.&gt; v. Jones</i>, 1 U.S. 2 (&quot;quoted&quot;) (1800).");
  });
});
