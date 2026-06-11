/**
 * Network layer that survives restrictive corporate networks.
 *
 * On some networks (e.g. office), direct outbound HTTPS to most hosts times
 * out — only googleapis.com, api.anthropic.com and api.firecrawl.dev get
 * through. So every fetch of an arbitrary site goes: direct first (fast,
 * works at home), then falls back to the Firecrawl scrape API which fetches
 * from its own cloud (also defeats Cloudflare bot checks on Property24).
 */

const DIRECT_TIMEOUT_MS = 12_000;

export interface FetchedPage {
  html: string;
  status: number;
  via: "direct" | "firecrawl";
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  // Attempt 1: direct fetch with a browser-like UA
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    const html = await response.text();
    // Cloudflare challenge pages come back 403/503 with tiny bodies — treat as failure
    const looksBlocked =
      !response.ok || /just a moment|cf-challenge|captcha/i.test(html.slice(0, 2000));
    if (!looksBlocked) {
      console.log(`[NET] direct fetch OK: ${url} (${html.length} bytes)`);
      return { html, status: response.status, via: "direct" };
    }
    console.warn(`[NET] direct fetch blocked (${response.status}), falling back to Firecrawl: ${url}`);
  } catch (err) {
    console.warn(`[NET] direct fetch failed (${(err as Error).message}), falling back to Firecrawl: ${url}`);
  }

  return fetchViaFirecrawl(url);
}

async function fetchViaFirecrawl(url: string): Promise<FetchedPage> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Direct fetch failed and FIRECRAWL_API_KEY is not set — cannot reach " + url
    );
  }

  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["rawHtml"], maxAge: 3_600_000 }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firecrawl scrape failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    success: boolean;
    data?: { rawHtml?: string; metadata?: { statusCode?: number } };
    error?: string;
  };

  if (!data.success || !data.data?.rawHtml) {
    throw new Error(`Firecrawl scrape returned no content for ${url}: ${data.error || "unknown"}`);
  }

  console.log(`[NET] firecrawl fetch OK: ${url} (${data.data.rawHtml.length} bytes)`);
  return {
    html: data.data.rawHtml,
    status: data.data.metadata?.statusCode ?? 200,
    via: "firecrawl",
  };
}

/** Fetch a URL that returns JSON, with the same direct→Firecrawl fallback. */
export async function fetchJson<T>(url: string): Promise<T> {
  const page = await fetchPage(url);
  // Firecrawl wraps some JSON responses in minimal HTML — strip tags if present
  let text = page.html.trim();
  if (text.startsWith("<")) {
    const match = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i) || text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (match) text = match[1].trim();
  }
  return JSON.parse(text) as T;
}
