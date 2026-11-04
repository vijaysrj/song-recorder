import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "sr_session";
export const STATE_COOKIE = "sr_oauth_state";
const SESSION_DAYS = 30;

// Only these Google accounts may use the app (comma-separated to add more).
export function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "vijay.srj@gmail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Key that signs the session cookie. AUTH_SECRET if set; otherwise the
// Google client secret, which is already private to the server.
function secret() {
  const s = process.env.AUTH_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error("AUTH_SECRET or GOOGLE_CLIENT_SECRET must be set");
  return new TextEncoder().encode(`song-recorder-session:${s}`);
}

export async function createSession(email: string) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

// Returns the signed-in email, or null if the cookie is missing, forged,
// expired, or belongs to an account that is no longer allowed.
export async function readSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
    return email && allowedEmails().includes(email) ? email : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60,
};

export function redirectUri(origin: string) {
  return `${process.env.APP_URL ?? origin}/api/auth/callback`;
}
