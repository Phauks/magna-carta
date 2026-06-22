export interface RedirectHop {
  readonly url: string;
  readonly status: number;
  readonly location?: string;
}

export interface SafeView {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly RedirectHop[];
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly screenshotBase64: string;
  readonly title?: string;
  readonly markdown?: string;
  readonly links: readonly string[];
}

// Follows redirects with a raw fetch (no JS execution), one hop at a time, guarded per hop.
export interface RedirectProbe {
  follow(url: string): Promise<{
    chain: readonly RedirectHop[];
    finalUrl: string;
    headers: Readonly<Record<string, string>>;
  }>;
}

// Renders a URL in the isolated remote browser and returns inert artifacts. Worker backs it with
// env.BROWSER.quickAction("snapshot", ...) + ("links", ...); tests pass a fake.
export interface BrowserRenderer {
  snapshot(url: string): Promise<{
    screenshotBase64: string;
    content?: string;
    markdown?: string;
    title?: string;
    links?: readonly string[];
  }>;
}

export interface SafeBrowseDeps {
  readonly probe: RedirectProbe;
  readonly renderer: BrowserRenderer;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
}
