import { NextRequest, NextResponse } from "next/server";

// Single-user password gate. Validates against APP_PASSWORD and, on success,
// sets an httpOnly cookie holding APP_ACCESS_TOKEN which the middleware checks.
export async function POST(request: NextRequest) {
  const { password } = await request.json().catch(() => ({ password: "" }));
  const expected = process.env.APP_PASSWORD;
  const token = process.env.APP_ACCESS_TOKEN;

  if (!expected || !token) {
    return NextResponse.json({ error: "Auth not configured on the server." }, { status: 500 });
  }
  if (typeof password !== "string" || password !== expected) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("pf_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("pf_auth");
  return res;
}
