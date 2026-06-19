import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const UPLOAD_ROOT = path.join(process.cwd(), ".cache", "uploads");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  const { id, file } = await params;
  // Guard against path traversal — only allow flat filenames within the id dir.
  const safeId = path.basename(id);
  const safeFile = path.basename(decodeURIComponent(file));
  const filePath = path.join(UPLOAD_ROOT, safeId, safeFile);

  if (!filePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  let contentType = "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) contentType = "image/png";
  else if (buffer[0] === 0x52 && buffer[1] === 0x49) contentType = "image/webp";
  else if (buffer[0] === 0x47 && buffer[1] === 0x49) contentType = "image/gif";

  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
  });
}
