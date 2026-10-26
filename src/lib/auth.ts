/**
 * "Mit OpenRouter anmelden": OpenRouter's OAuth PKCE flow creates a key for this app
 * in the user's own account, so nobody has to copy a key by hand.
 *
 * Served from a web address (localhost or a website), OpenRouter sends the user back
 * with a code. Opened as a file from the desktop there is no address to return to;
 * OpenRouter then shows the code and the user pastes it.
 */

const AUTH = "https://openrouter.ai/auth";
const EXCHANGE = "https://openrouter.ai/api/v1/auth/keys";
const PENDING = "router.login";
const KEY_LABEL = "Leuchtfeuer";

/** Credits page on OpenRouter; paying happens there, never inside the app. */
export const CREDITS_URL = "https://openrouter.ai/settings/credits";
/** Where keys are made by hand (checked 2026-10-26). */
export const KEYS_URL = "https://openrouter.ai/settings/keys";

export const canRedirect = () => location.protocol === "http:" || location.protocol === "https:";

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function randomString(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Where OpenRouter sends the user back: this page, without any query. */
const callbackUrl = () => `${location.origin}${location.pathname}`;

async function authUrl(withCallback: boolean) {
  const verifier = randomString();
  const state = randomString(16);
  const params = new URLSearchParams({
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
    key_label: KEY_LABEL,
  });
  if (withCallback) {
    params.set("callback_url", callbackUrl());
    params.set("state", state);
  }
  // localStorage, not sessionStorage: a code pasted from another tab must still find the verifier.
  localStorage.setItem(PENDING, JSON.stringify({ verifier, state, at: Date.now() }));
  return `${AUTH}?${params}`;
}

/** Leave for OpenRouter's login page; it returns to this page with a code. */
export async function startLogin() {
  location.assign(await authUrl(true));
}

/**
 * Desktop-file variant: the address of OpenRouter's login page, which shows a code to paste
 * back here. Prepared ahead and used as a plain link, so no pop-up blocker gets in the way.
 */
export function prepareCodeLogin() {
  return authUrl(false);
}

function pending(): { verifier: string; state: string; at: number } | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? "null");
    // Codes expire after 10 minutes; keep the verifier a little longer for slow typists.
    return p && Date.now() - p.at < 30 * 60 * 1000 ? p : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(code: string): Promise<string> {
  const p = pending();
  if (!p) throw new Error("Die Anmeldung ist abgelaufen. Bitte starte sie noch einmal.");
  const res = await fetch(EXCHANGE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), code_verifier: p.verifier, code_challenge_method: "S256" }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 403
        ? "Der Code ist ungültig oder abgelaufen. Bitte starte die Anmeldung noch einmal."
        : `Die Anmeldung ist fehlgeschlagen (HTTP ${res.status}).`,
    );
  }
  const key = (await res.json())?.key;
  if (typeof key !== "string" || !key) throw new Error("OpenRouter hat keinen Schlüssel geliefert.");
  localStorage.removeItem(PENDING);
  return key;
}

let handled = false;

/**
 * Finish a login that came back to this page. Returns the new key, null when there is
 * nothing to finish. Cleans the code out of the address bar either way.
 */
export async function completeLogin(): Promise<string | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (!code || handled) return null;
  handled = true;
  const state = url.searchParams.get("state");
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  history.replaceState(null, "", url.toString());
  const p = pending();
  // An old link with a used code (e.g. from the history): nothing to finish.
  if (!p) return null;
  if (state !== null && state !== p.state) throw new Error("Die Anmeldung passt nicht zu dieser Seite. Bitte starte sie noch einmal.");
  return exchangeCode(code);
}
