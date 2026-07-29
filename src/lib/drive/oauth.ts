/**
 * NIZAM · Google OAuth (GIS token client) — scope drive.file ONLY
 * Implemented by: KIRO Contract 2 / Phase 2.1
 * Depends on: none
 *
 * Uses the Google Identity Services token model for SPAs:
 * https://developers.google.com/identity/oauth2/web/guides/use-token-model
 * The access token lives in MEMORY ONLY (steering: tokens never persisted/committed).
 * INVARIANT: the requested + granted scope is exactly drive.file — never broader.
 */

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// --- Minimal GIS type surface (no @types/google.accounts dependency) -------
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
  revoke(accessToken: string, done: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

// --- Session state (memory only) -------------------------------------------
export interface DriveSession {
  accessToken: string;
  /** Epoch ms after which the token is stale. */
  expiresAt: number;
  grantedScope: string;
}

let session: DriveSession | null = null;
let gisLoadPromise: Promise<GoogleOAuth2> | null = null;

function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!id) {
    throw new Error(
      'NIZAM: VITE_GOOGLE_CLIENT_ID is not set. Copy .env.example to .env.local and fill it.',
    );
  }
  return id;
}

/** Inject the GIS script once and resolve with the oauth2 namespace. */
function loadGis(): Promise<GoogleOAuth2> {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = window.google?.accounts?.oauth2;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error('NIZAM: GIS script loaded but oauth2 namespace missing'));
    };
    script.onerror = () => reject(new Error('NIZAM: failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

/** Assert the granted scope is drive.file and nothing broader. */
export function assertDriveFileScopeOnly(grantedScope: string): void {
  const scopes = grantedScope.split(/\s+/).filter(Boolean);
  const forbidden = scopes.filter(
    (s) =>
      s.startsWith('https://www.googleapis.com/auth/drive') && s !== DRIVE_FILE_SCOPE,
  );
  if (forbidden.length > 0) {
    throw new Error(
      `NIZAM: token granted broader Drive scope than allowed: ${forbidden.join(', ')}`,
    );
  }
  if (!scopes.includes(DRIVE_FILE_SCOPE)) {
    throw new Error('NIZAM: token is missing the drive.file scope');
  }
}

/**
 * Interactive sign-in. Requests EXACTLY drive.file.
 * Resolves with the in-memory session; rejects if the user closes the popup.
 */
export function signIn(options?: { prompt?: 'consent' | '' }): Promise<DriveSession> {
  return loadGis().then(
    (oauth2) =>
      new Promise<DriveSession>((resolve, reject) => {
        const client = oauth2.initTokenClient({
          client_id: getClientId(),
          scope: DRIVE_FILE_SCOPE,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(
                new Error(
                  `NIZAM: sign-in failed: ${response.error ?? 'no token'} ${response.error_description ?? ''}`,
                ),
              );
              return;
            }
            try {
              const granted = response.scope ?? DRIVE_FILE_SCOPE;
              assertDriveFileScopeOnly(granted);
              session = {
                accessToken: response.access_token,
                expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 - 60_000,
                grantedScope: granted,
              };
              resolve(session);
            } catch (e) {
              session = null;
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          },
          error_callback: (err) => {
            reject(new Error(`NIZAM: sign-in aborted: ${err.type ?? ''} ${err.message ?? ''}`));
          },
        });
        client.requestAccessToken({ prompt: options?.prompt ?? '' });
      }),
  );
}

/** Current access token, or null when signed out / expired. */
export function getAccessToken(): string | null {
  if (!session) return null;
  if (Date.now() >= session.expiresAt) return null;
  return session.accessToken;
}

/** Current session (memory only). */
export function getSession(): DriveSession | null {
  return session && Date.now() < session.expiresAt ? session : null;
}

/** Revoke the token and clear the in-memory session. */
export async function signOut(): Promise<void> {
  const current = session;
  session = null;
  if (!current) return;
  try {
    const oauth2 = await loadGis();
    await new Promise<void>((resolve) => oauth2.revoke(current.accessToken, resolve));
  } catch {
    // Best-effort: token expires on its own within the hour.
  }
}

/** Test hook — inject a fake session (unit tests only). */
export function __setSessionForTests(fake: DriveSession | null): void {
  session = fake;
}
