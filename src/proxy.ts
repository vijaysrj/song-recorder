import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth";

// Everything except the landing page, the sign-in page, the sign-in routes and static files
// needs a valid Google session for an allowed account.
export async function proxy(request: NextRequest) {
  // The landing page is public.
  if (request.nextUrl.pathname === "/") return NextResponse.next();

  // Until the Google keys are added, Vercel's own login guards the app.
  if (!process.env.GOOGLE_CLIENT_ID) return NextResponse.next();

  const email = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (email) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "Please sign in" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
