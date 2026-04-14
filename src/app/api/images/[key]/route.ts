import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "maps");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  // Serve cached satellite/streetview image
  const filePath = path.join(CACHE_DIR, `${key}.jpg`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);

  // Detect content type from file bytes
  let contentType = "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = "image/png";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
