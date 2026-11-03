import { decodeJwt } from "jose";
import { NextResponse, type NextRequest } from "next/server";
import {
  allowedEmails,
  createSession,
  redirectUri,
  SESSION_COOKIE,
  sessionCookieOptions,
  STATE_COOKIE,
} from "@/lib/auth";

// Google sends the browser back here after sign-in.
export async function GET(request: NextRequest) {
  const fail = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state || state !== request.cookies.get(STATE_COOKIE)?.value) {
    return fail("expired");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("setup");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(request.nextUrl.origin),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("google");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  if (!id_token) return fail("google");

  // The ID token came straight from Google's token endpoint over TLS in
  // exchange for our client secret, so its claims can be trusted without
  // re-checking the signature. We still check who it was issued for.
  const claims = decodeJwt(id_token);
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issuerOk || claims.aud !== clientId || claims.email_verified !== true) return fail("google");
  if (!allowedEmails().includes(email)) return fail("denied");

  const res = NextResponse.redirect(new URL("/studio", request.url));
  res.cookies.set(SESSION_COOKIE, await createSession(email), sessionCookieOptions);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
