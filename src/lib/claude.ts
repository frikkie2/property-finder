import Anthropic from "@anthropic-ai/sdk";

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

  const message = await client.messages.create({
    model: options.model,
    max_tokens: options.maxTokens ?? 2048,
    messages: [{ role: "user", content }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
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
