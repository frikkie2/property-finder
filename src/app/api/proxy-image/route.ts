import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const CACHE_DIR = path.join(process.cwd(), ".cache", "listing-photos");

/**
 * Proxies listing photos for the browser. On restrictive networks
 * images.prop24.com is unreachable from this machine entirely — in that case
 * we serve a labelled placeholder rather than a broken image. Successful
 * fetches are cached so photos keep working after a network change.
 */
export async function GET(request: NextRequest) {
  const imageUrl = request.nextUrl.searchParams.get("url");
  if (!imageUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Locally uploaded photos: read straight from disk (no network).
  const uploadMatch = imageUrl.match(/\/api\/uploads\/([^/]+)\/(.+)$/);
  if (uploadMatch) {
    const file = path.join(
      process.cwd(), ".cache", "uploads",
      path.basename(uploadMatch[1]), path.basename(decodeURIComponent(uploadMatch[2]))
    );
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      let ct = "image/jpeg";
      if (buf[0] === 0x89 && buf[1] === 0x50) ct = "image/png";
      else if (buf[0] === 0x52 && buf[1] === 0x49) ct = "image/webp";
      return new NextResponse(new Uint8Array(buf), {
        headers: { "Content-Type": ct, "Cache-Control": "public, max-age=86400" },
      });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const cacheFile = path.join(
    CACHE_DIR,
    crypto.createHash("md5").update(imageUrl).digest("hex") + ".img"
  );
  if (fs.existsSync(cacheFile)) {
    return new NextResponse(new Uint8Array(fs.readFileSync(cacheFile)), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
    });
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.property24.com/",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`upstream ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, buffer);
    } catch { /* cache write is best-effort */ }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    // Network-blocked: serve a labelled placeholder (the AI pipeline is
    // unaffected — it reads these photos via Anthropic's servers).
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
  <rect width="100%" height="100%" fill="#f3f4f6"/>
  <text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9ca3af">photo blocked on</text>
  <text x="50%" y="58%" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9ca3af">this network</text>
</svg>`;
    return new NextResponse(svg, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    });
  }
}
