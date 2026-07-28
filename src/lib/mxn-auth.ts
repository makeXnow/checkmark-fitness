/**
 * MakeXNow Google auth client (dormant until enabled).
 *
 * Identity only — MakeXNow Accounts connects Google and returns a user/token.
 * Your app decides access (whitelist, roles, etc.).
 *
 * Enable with VITE_MXN_AUTH=1 and optional VITE_MXN_ACCOUNTS_URL.
 * Ignore this module unless auth is turned on for the app.
 */

export type MxnUser = {
  sub: string;
  email: string;
  name: string;
  picture: string;
};

export type MxnSession = {
  token: string;
  user: MxnUser;
  app: string;
};

const STORAGE_KEY = "mxn_auth_session";

export function isMxnAuthEnabled(): boolean {
  const flag = String(import.meta.env.VITE_MXN_AUTH || "").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function getAccountsBaseUrl(): string {
  const fromEnv = String(import.meta.env.VITE_MXN_ACCOUNTS_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8999";
    }
  }
  return "https://accounts.makexnow.com";
}

export function getStoredSession(): MxnSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MxnSession;
    if (!parsed?.token || !parsed?.user?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  authBootstrap = null;
}

export function storeSession(session: MxnSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/** Clean return URL — never send a leftover mxn_code back into OAuth. */
function defaultReturnTo(): string {
  if (typeof window === "undefined") return "";
  const u = new URL(window.location.href);
  u.searchParams.delete("mxn_code");
  u.searchParams.delete("mxn_app");
  return `${u.origin}${u.pathname}${u.search}${u.hash}`;
}

/** Start Google sign-in via MakeXNow accounts. `appId` is a label for the JWT only. */
export function startMxnLogin(appId: string, returnTo?: string): void {
  // Next login should run a fresh bootstrap (do not clear a just-exchanged session mid-flight).
  authBootstrap = null;
  const base = getAccountsBaseUrl();
  const ret = returnTo || defaultReturnTo();
  const url = new URL(`${base}/login`);
  url.searchParams.set("app", appId);
  url.searchParams.set("return_to", ret);
  window.location.assign(url.toString());
}

/** In-flight dedupe: React Strict Mode mounts twice and would burn a one-time code. */
let consumeInflight: { code: string; promise: Promise<MxnSession> } | null = null;

/**
 * Single shared bootstrap for the page lifetime so Strict Mode remounts
 * wait on the same exchange instead of treating a stripped URL as "logged out".
 */
let authBootstrap: Promise<MxnSession | null> | null = null;

export function bootstrapMxnSession(appId: string): Promise<MxnSession | null> {
  if (!authBootstrap) {
    authBootstrap = (async () => {
      const fromCode = await consumeMxnCodeFromUrl(appId);
      return fromCode || getStoredSession();
    })().catch((err) => {
      authBootstrap = null;
      throw err;
    });
  }
  return authBootstrap;
}

/** If URL has mxn_code, exchange it for a session and strip the query params. */
export async function consumeMxnCodeFromUrl(appId: string): Promise<MxnSession | null> {
  if (typeof window === "undefined") return null;

  // Remount after URL strip: still wait for the in-flight exchange.
  if (consumeInflight) {
    const session = await consumeInflight.promise;
    if (session.app && session.app !== appId) {
      console.warn(`[mxn-auth] token app ${session.app} !== expected ${appId}`);
    }
    return session;
  }

  const url = new URL(window.location.href);
  const code = url.searchParams.get("mxn_code");
  if (!code) return null;

  // Strip immediately so a remount does not start a second independent exchange.
  url.searchParams.delete("mxn_code");
  url.searchParams.delete("mxn_app");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);

  const promise = exchangeMxnCode(code)
    .then((session) => {
      storeSession(session);
      return session;
    })
    .finally(() => {
      if (consumeInflight?.code === code) consumeInflight = null;
    });

  consumeInflight = { code, promise };
  const session = await promise;

  if (session.app && session.app !== appId) {
    console.warn(`[mxn-auth] token app ${session.app} !== expected ${appId}`);
  }
  return session;
}

export async function exchangeMxnCode(code: string): Promise<MxnSession> {
  const base = getAccountsBaseUrl();
  const res = await fetch(`${base}/api/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = (await res.json()) as MxnSession & { error?: string };
  if (!res.ok) throw new Error(data.error || "Exchange failed");
  return {
    token: data.token,
    user: data.user,
    app: data.app,
  };
}

/** Validate a stored JWT with MakeXNow Accounts (identity check only). */
export async function fetchMxnMe(token: string): Promise<{ user: MxnUser; app: string }> {
  const base = getAccountsBaseUrl();
  const res = await fetch(`${base}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { user?: MxnUser; app?: string; error?: string };
  if (!res.ok || !data.user) throw new Error(data.error || "Session invalid");
  return { user: data.user, app: data.app || "" };
}
