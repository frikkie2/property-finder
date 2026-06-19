import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

let _client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
  return _client;
}

/**
 * Model tiers for the pipeline. The satellite sweep makes hundreds of calls
 * per search, the comparisons dozens, the final adjudication exactly one —
 * so capability is allocated accordingly.
 */
export const MODELS = {
  sweep: "claude-sonnet-4-6",
  compare: "claude-sonnet-4-6",
  fingerprint: "claude-sonnet-4-6",
  adjudicate: "claude-opus-4-8",
  prefilter: "claude-haiku-4-5", // cheap text-only shortlisting over a whole suburb
} as const;

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export type ImageInput =
  | { kind: "url"; url: string }
  | { kind: "base64"; data: string; mediaType: ImageMediaType };

export function urlImage(url: string): ImageInput {
  return { kind: "url", url };
}

export function base64Image(data: string, mediaType: ImageMediaType): ImageInput {
  return { kind: "base64", data, mediaType };
}

function detectMediaType(buf: Buffer): ImageMediaType {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

/**
 * Resolve a listing photo reference to an image input.
 * - http(s) URL → URL source (Anthropic fetches it server-side; works even
 *   when this machine can't reach the image host, e.g. images.prop24.com).
 * - "/api/uploads/<searchId>/<file>" → read the uploaded file from disk and
 *   send as base64 (Anthropic can't fetch localhost).
 */
export function listingImage(url: string): ImageInput {
  if (/^https?:\/\//i.test(url)) return urlImage(url);
  const m = url.match(/\/api\/uploads\/([^/]+)\/(.+)$/);
  if (m) {
    const file = path.join(process.cwd(), ".cache", "uploads", m[1], decodeURIComponent(m[2]));
    const buf = fs.readFileSync(file);
    return base64Image(buf.toString("base64"), detectMediaType(buf));
  }
  // Fallback: treat as a URL and let Anthropic try.
  return urlImage(url);
}

function toImageBlock(img: ImageInput): Anthropic.ImageBlockParam {
  if (img.kind === "url") {
    return { type: "image", source: { type: "url", url: img.url } };
  }
  return { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } };
}

/**
 * Run a vision prompt over a set of images and return Claude's text reply.
 * Images can be URLs (fetched by Anthropic's servers — works even when this
 * machine's network blocks the image host) or base64 buffers.
 * Optional labels are interleaved before each image so the prompt can refer
 * to "Photo 3" or "Tile A" unambiguously.
 */
export async function visionRequest(options: {
  model: string;
  images: ImageInput[];
  labels?: string[];
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const client = getClient();

  const content: Anthropic.ContentBlockParam[] = [];
  options.images.forEach((img, i) => {
    if (options.labels?.[i]) {
      content.push({ type: "text", text: options.labels[i] });
    }
    content.push(toImageBlock(img));
  });
  content.push({ type: "text", text: options.prompt });

  // When images are URL sources, Anthropic fetches them server-side and a
  // single slow host (images.prop24.com) can 400 the whole request with a
  // "timed out while trying to download the file" error. The SDK does not
  // retry 400s, so retry that specific transient case ourselves.
  const maxDownloadRetries = 4;
  for (let attempt = 0; ; attempt++) {
    try {
      const message = await client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 2048,
        messages: [{ role: "user", content }],
      });
      const textBlock = message.content.find((b) => b.type === "text");
      return textBlock && textBlock.type === "text" ? textBlock.text : "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDownloadTimeout = /timed out while trying to download|failed to (?:download|fetch) the file|unable to (?:download|fetch)/i.test(msg);
      if (!isDownloadTimeout || attempt >= maxDownloadRetries) throw err;
      const backoff = 1500 * (attempt + 1);
      console.warn(`[CLAUDE] image download timeout (attempt ${attempt + 1}/${maxDownloadRetries}), retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

/**
 * Same as visionRequest but parses a JSON object out of the reply,
 * tolerating markdown fences and leading prose.
 */
export async function visionJson<T>(options: {
  model: string;
  images: ImageInput[];
  labels?: string[];
  prompt: string;
  maxTokens?: number;
}): Promise<T> {
  const text = await visionRequest(options);
  return parseJsonReply<T>(text);
}

/** Text-only request that parses a JSON object from the reply. */
export async function textJson<T>(model: string, prompt: string, maxTokens = 1500): Promise<T> {
  const client = getClient();
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return parseJsonReply<T>(textBlock && textBlock.type === "text" ? textBlock.text : "");
}

export function parseJsonReply<T>(text: string): T {
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // If there's prose around the JSON, find the outermost object/array
  if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
    const objStart = jsonStr.indexOf("{");
    const arrStart = jsonStr.indexOf("[");
    const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
    if (start === -1) throw new Error(`No JSON found in model reply: ${text.slice(0, 200)}`);
    const open = jsonStr[start];
    const close = open === "{" ? "}" : "]";
    const end = jsonStr.lastIndexOf(close);
    jsonStr = jsonStr.slice(start, end + 1);
  }
  return JSON.parse(jsonStr) as T;
}

/** Run async tasks with a concurrency cap; failed tasks resolve to null. */
export async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  task: (item: TIn, index: number) => Promise<TOut>,
  onSettled?: (done: number, total: number) => void
): Promise<(TOut | null)[]> {
  const results: (TOut | null)[] = new Array(items.length).fill(null);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await task(items[i], i);
      } catch (err) {
        console.warn(`[CONCURRENCY] task ${i} failed: ${(err as Error).message}`);
        results[i] = null;
      }
      done++;
      onSettled?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
