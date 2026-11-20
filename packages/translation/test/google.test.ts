import { describe, expect, it } from "vitest";
import {
  MOST_BYTES_PER_REQUEST,
  MOST_PASSAGES_PER_REQUEST,
  batchesOf,
  googleTranslationPort,
  type GoogleFetch,
} from "../src/google.ts";
import { passagesOf, unconfiguredTranslationPort } from "../src/port.ts";

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function scriptedFetch(answer: (call: Call) => Response): { fetch: GoogleFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: (url, init) => {
      const call = { url, init };
      calls.push(call);
      return Promise.resolve(answer(call));
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bodyOf(call: Call): { q: string[]; target: string; source?: string; format: string } {
  return JSON.parse(String(call.init?.body)) as {
    q: string[];
    target: string;
    source?: string;
    format: string;
  };
}

/** Answers each passage with its upper-case form, as a stand-in for a translation. */
function echoUpper(call: Call, detected = "es"): Response {
  const { q } = bodyOf(call);
  return json({
    data: {
      translations: q.map((text) => ({
        translatedText: text.toUpperCase(),
        detectedSourceLanguage: detected,
      })),
    },
  });
}

describe("passagesOf", () => {
  it("splits at blank lines and keeps line breaks inside a paragraph", () => {
    expect(passagesOf("Estimado Sr. Ortega:\r\n\r\nCalle 4\nMadrid\n\n\n  \nFin.")).toEqual([
      "Estimado Sr. Ortega:",
      "Calle 4\nMadrid",
      "Fin.",
    ]);
  });

  it("answers nothing for text that is only whitespace", () => {
    expect(passagesOf(" \n\n \t ")).toEqual([]);
  });
});

describe("batchesOf", () => {
  it("starts a new batch at Google's passage ceiling", () => {
    const batches = batchesOf(Array.from({ length: MOST_PASSAGES_PER_REQUEST + 1 }, () => "a"));
    expect(batches?.map((batch) => batch.length)).toEqual([MOST_PASSAGES_PER_REQUEST, 1]);
  });

  it("starts a new batch before the byte ceiling, counting bytes and not characters", () => {
    // Each passage is two bytes per character in UTF-8.
    const half = "é".repeat(MOST_BYTES_PER_REQUEST / 4 + 1);
    expect(batchesOf([half, half])?.map((batch) => batch.length)).toEqual([1, 1]);
  });

  it("refuses a single passage over the byte ceiling", () => {
    expect(batchesOf(["a".repeat(MOST_BYTES_PER_REQUEST + 1)])).toBeUndefined();
  });
});

describe("googleTranslationPort.translate", () => {
  it("sends the key in a header and the text in the body, never in the URL", async () => {
    const { fetch, calls } = scriptedFetch((call) => echoUpper(call));
    const port = googleTranslationPort("secret-key", fetch);
    await port.translate({ passages: ["hola"], target: "en" });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe("https://translation.googleapis.com/language/translate/v2");
    expect(call?.url).not.toContain("secret-key");
    expect(call?.url).not.toContain("hola");
    expect(new Headers(call?.init?.headers).get("x-goog-api-key")).toBe("secret-key");
    expect(call && bodyOf(call)).toMatchObject({ q: ["hola"], target: "en", format: "text" });
  });

  it("answers one translation per passage, in order, across batches", async () => {
    const { fetch, calls } = scriptedFetch((call) => echoUpper(call));
    const passages = Array.from({ length: 130 }, (_, index) => `p${String(index)}`);
    const result = await googleTranslationPort("k", fetch).translate({ passages, target: "en" });
    expect(calls).toHaveLength(2);
    expect(result).toEqual({
      ok: true,
      value: {
        passages: passages.map((passage) => passage.toUpperCase()),
        detectedSource: "es",
        engine: "google",
      },
    });
  });

  it("passes a named source language and reports no detected one", async () => {
    const { fetch, calls } = scriptedFetch((call) => echoUpper(call, "fr"));
    const result = await googleTranslationPort("k", fetch).translate({
      passages: ["bonjour"],
      target: "en",
      source: "fr",
    });
    expect(calls[0] && bodyOf(calls[0]).source).toBe("fr");
    expect(result.ok && result.value.detectedSource).toBeUndefined();
  });

  it("answers refused, with no text and no key, when Google turns the request down", async () => {
    const { fetch } = scriptedFetch(() => json({ error: { message: "hola secret-key" } }, 403));
    const result = await googleTranslationPort("secret-key", fetch).translate({
      passages: ["hola"],
      target: "en",
    });
    expect(result).toEqual({
      ok: false,
      reason: "refused",
      detail: "The translation service refused the request (status 403).",
    });
  });

  it("answers unavailable when Google answers a different number of passages", async () => {
    const { fetch } = scriptedFetch(() => json({ data: { translations: [] } }));
    const result = await googleTranslationPort("k", fetch).translate({
      passages: ["hola"],
      target: "en",
    });
    expect(result.ok ? undefined : result.reason).toBe("unavailable");
  });

  it("answers unavailable when the request fails to reach Google", async () => {
    const port = googleTranslationPort("k", () => Promise.reject(new Error("offline")));
    const result = await port.translate({ passages: ["hola"], target: "en" });
    expect(result.ok ? undefined : result.reason).toBe("unavailable");
  });

  it("answers too-long without calling Google when one passage is over the ceiling", async () => {
    const { fetch, calls } = scriptedFetch((call) => echoUpper(call));
    const result = await googleTranslationPort("k", fetch).translate({
      passages: ["a".repeat(MOST_BYTES_PER_REQUEST + 1)],
      target: "en",
    });
    expect(calls).toHaveLength(0);
    expect(result.ok ? undefined : result.reason).toBe("too-long");
  });
});

describe("googleTranslationPort.languages", () => {
  it("lists Google's languages by name and drops entries that are not language codes", async () => {
    const { fetch, calls } = scriptedFetch(() =>
      json({
        data: {
          languages: [
            { language: "es", name: "Spanish" },
            { language: "de", name: "German" },
            { language: "<script>", name: "Bad" },
          ],
        },
      }),
    );
    const result = await googleTranslationPort("k", fetch).languages("en");
    expect(calls[0]?.url).toBe(
      "https://translation.googleapis.com/language/translate/v2/languages?target=en&model=nmt",
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { code: "de", name: "German" },
        { code: "es", name: "Spanish" },
      ],
    });
  });
});

describe("unconfiguredTranslationPort", () => {
  it("answers not-configured to everything", async () => {
    const port = unconfiguredTranslationPort();
    expect((await port.translate({ passages: ["hola"], target: "en" })).ok).toBe(false);
    const languages = await port.languages("en");
    expect(languages.ok ? undefined : languages.reason).toBe("not-configured");
  });
});
