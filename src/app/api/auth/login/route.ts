import { NextResponse, type NextRequest } from "next/server";
import { redirectUri, STATE_COOKIE } from "@/lib/auth";

// Sends the browser to Google's sign-in page.
export function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=setup", request.url));
  }
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(request.nextUrl.origin),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  }).toString();

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
