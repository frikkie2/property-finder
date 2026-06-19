import { NextRequest, NextResponse } from "next/server";

// Single-password access gate.
//   - Disabled entirely when APP_PASSWORD is unset (local dev stays open).
//   - Otherwise every page/API requires the pf_auth cookie set by /api/login.
export function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const token = process.env.APP_ACCESS_TOKEN;
  if (!password || !token) return NextResponse.next(); // gate off

  const { pathname } = request.nextUrl;
  // Always allow the login page and its API, plus Next internals/assets.
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/nutun-mark.png"
  ) {
    return NextResponse.next();
  }

  if (request.cookies.get("pf_auth")?.value === token) {
    return NextResponse.next();
  }

  // Unauthenticated: APIs get 401, pages redirect to /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
