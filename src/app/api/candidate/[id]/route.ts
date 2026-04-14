import { NextRequest, NextResponse } from "next/server";
import { updateCandidateStatus } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { status } = body;

  if (!["confirmed", "rejected"].includes(status)) {
    return NextResponse.json(
      { error: "Status must be 'confirmed' or 'rejected'" },
      { status: 400 }
    );
  }

  updateCandidateStatus(id, status);
  return NextResponse.json({ success: true });
}
