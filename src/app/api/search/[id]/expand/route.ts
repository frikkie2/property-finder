import { NextRequest, NextResponse } from "next/server";
import { expandSearchToAdjacent } from "@/lib/search-pipeline";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { suburbs } = await expandSearchToAdjacent(id);
    return NextResponse.json({
      message: `Expanding search to: ${suburbs.join(", ")}`,
      suburbs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "Search not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
