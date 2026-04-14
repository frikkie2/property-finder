import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function analyseImageWithPrompt(
  imageUrl: string,
  prompt: string
): Promise<string> {
  const client = getClient();

  // Fetch image and convert to base64
  const response = await fetch(imageUrl);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  // Determine media type from URL or response
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const mediaType = contentType.split(";")[0].trim() as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock ? textBlock.text : "";
}

export async function analyseMultipleImagesWithPrompt(
  imageUrls: string[],
  prompt: string
): Promise<string> {
  const client = getClient();

  // Fetch all images in parallel
  const imageBlocks = await Promise.all(
    imageUrls.map(async (url) => {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const contentType = response.headers.get("content-type") || "image/jpeg";
      const mediaType = contentType.split(";")[0].trim() as
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp";

      return {
        type: "image" as const,
        source: { type: "base64" as const, media_type: mediaType, data: base64 },
      };
    })
  );

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [...imageBlocks, { type: "text" as const, text: prompt }],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock ? textBlock.text : "";
}

export async function analyseBase64ImageWithPrompt(
  base64Data: string,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
  prompt: string
): Promise<string> {
  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock ? textBlock.text : "";
}
