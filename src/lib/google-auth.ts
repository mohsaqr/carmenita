/**
 * Google OAuth 2.0 with PKCE for static-site (no server/secret needed).
 *
 * Ported from the tnashiny pattern (server-side OAuth + googledrive R package)
 * but adapted for browser-only PKCE flow with drive.appdata scope.
 *
 * Prerequisites:
 *   1. Google Cloud project with OAuth 2.0 client (Web application)
 *   2. Google Drive API enabled
 *   3. Authorized redirect URI: {origin}/auth/callback/ (trailing slash)
 *   4. Paste client ID below
 */

// ── Configuration ─────────────────────────────────────────────────────
// Replace with your Google Cloud OAuth 2.0 client ID.
// No client secret needed — PKCE handles the security.
const GOOGLE_CLIENT_ID = "";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.appdata",
].join(" ");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

const STORAGE_KEY = "carmenita-google-auth";
const VERIFIER_KEY = "carmenita-pkce-verifier";

// ── Types ─────────────────────────────────────────────────────────────
export interface GoogleUser {
  email: string;
  name: string;
  picture: string;
}

export interface AuthState {
  user: GoogleUser;
  accessToken: string;
  refreshToken?: string; // undefined for public PKCE clients (Google doesn't issue refresh tokens without a client_secret)
  expiresAt: number; // epoch ms
  expired?: boolean; // set when token expired and no refresh is possible
}

// ── PKCE helpers ──────────────────────────────────────────────────────
function generateVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
}

async function generateChallenge(verifier: string): Promise<string> {
  const hash = await sha256(verifier);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ── Public API ────────────────────────────────────────────────────────

/** True when a client ID is configured (non-empty). */
export function isGoogleAuthConfigured(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}

/** Build the redirect URI from the current origin + base path. */
function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${window.location.origin}${base}/auth/callback/`;
}

/** Redirect the browser to Google's consent screen. */
export async function loginWithGoogle(): Promise<void> {
  const verifier = generateVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await generateChallenge(verifier);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });

  window.location.href = `${AUTH_ENDPOINT}?${params}`;
}

/** Exchange the authorization code for tokens (called from /auth/callback). */
export async function handleOAuthCallback(code: string): Promise<AuthState> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error("Missing PKCE verifier — login flow was interrupted.");
  sessionStorage.removeItem(VERIFIER_KEY);

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${err.error_description ?? res.statusText}`);
  }

  const data = await res.json();
  const user = await fetchUserInfo(data.access_token);

  const auth: AuthState = {
    user,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  saveAuth(auth);
  notifyListeners();
  return auth;
}

/** Refresh the access token using the stored refresh token. */
export async function refreshAccessToken(): Promise<AuthState | null> {
  const auth = loadAuth();
  if (!auth?.refreshToken) return null;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      refresh_token: auth.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    // Refresh token revoked or expired — force re-login
    clearAuth();
    notifyListeners();
    return null;
  }

  const data = await res.json();
  const updated: AuthState = {
    ...auth,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  saveAuth(updated);
  notifyListeners();
  return updated;
}

/** Get a valid access token, refreshing if possible. Marks session expired if not. */
export async function getValidToken(): Promise<string | null> {
  const auth = loadAuth();
  if (!auth) return null;

  // Token still fresh
  if (Date.now() <= auth.expiresAt - 60_000) {
    return auth.accessToken;
  }

  // Try refresh (only works if a refresh token was issued)
  if (auth.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return refreshed.accessToken;
  }

  // No refresh token or refresh failed — mark expired so UI can react
  saveAuth({ ...auth, expired: true });
  notifyListeners();
  return null;
}

/** Get current auth state from localStorage. */
export function getAuthState(): AuthState | null {
  return loadAuth();
}

/** Clear auth state and sign out. */
export function logout(): void {
  clearAuth();
  notifyListeners();
}

// ── Persistence ───────────────────────────────────────────────────────
function saveAuth(auth: AuthState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

function loadAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function fetchUserInfo(accessToken: string): Promise<GoogleUser> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch user info");
  const data = await res.json();
  return { email: data.email, name: data.name, picture: data.picture };
}

// ── Subscription (same pattern as password-gate.ts) ───────────────────
const listeners = new Set<() => void>();

export function subscribeAuth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn());
}
