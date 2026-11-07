import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { shell } from "electron";
import type { AddressInfo } from "node:net";

/** What the renderer gets back after a successful sign-in — the profile fields Settings → Account
 * displays. Tokens deliberately never cross the IPC boundary. */
export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPES = "openid email profile";

/** Abandon the flow if the user never finishes it in the browser, so a forgotten tab doesn't leave
 * a loopback listener open for the rest of the session. */
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Google sign-in for the desktop app: the OAuth 2.0 authorization-code flow with PKCE against a
 * loopback redirect, which is what RFC 8252 prescribes for native apps — the system browser does
 * the authenticating (so the app never sees the password, and the user sees a real google.com
 * address bar), and PKCE means no client secret has to ship inside the binary.
 *
 * The client id comes from the user's own Google Cloud OAuth client ("Desktop app" type), entered
 * in Settings → Account: Astro has no hosted backend to own one, and hard-coding somebody else's
 * would be both broken and a lie about who the app is.
 *
 * ponytail: the access token lives in this module for the session and is dropped on quit — no
 * refresh token is requested and nothing is written to disk. That's enough to prove identity and
 * show the account; when the remote vault lands and actually needs offline access, this is the one
 * place to add `access_type=offline` plus a safeStorage-encrypted refresh token.
 */
let accessToken: string | null = null;
let profile: GoogleProfile | null = null;

export function currentGoogleProfile(): GoogleProfile | null {
  return profile;
}

export function googleSignOut(): void {
  accessToken = null;
  profile = null;
}

export async function googleSignIn(clientId: string): Promise<GoogleProfile> {
  if (!clientId.trim()) throw new Error("尚未填写 Google 登录应用编号。");

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const { code, redirectUri } = await awaitAuthorizationCode(clientId, challenge, state);

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`登录凭据获取失败（${tokenRes.status}): ${await tokenRes.text()}`);
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("未能获取登录凭据。");

  const userRes = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!userRes.ok) throw new Error(`无法读取 Google 账号信息（${userRes.status}).`);
  const info = (await userRes.json()) as { email?: string; name?: string; picture?: string };

  accessToken = token.access_token;
  profile = { email: info.email ?? "", name: info.name ?? info.email ?? "", picture: info.picture };
  return profile;
}

/**
 * Opens the consent screen in the system browser and resolves with the authorization code Google
 * redirects back to a one-shot loopback server. The server binds port 0 (the OS picks a free one)
 * on 127.0.0.1 only — never 0.0.0.0 — so nothing outside this machine can reach it, and it closes
 * the moment the redirect arrives, times out, or fails.
 */
function awaitAuthorizationCode(
  clientId: string,
  challenge: string,
  state: string,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        code && returnedState === state
          ? "<p>登录成功。你可以关闭此页面，返回 Astro。</p>"
          : "<p>登录失败。你可以关闭此页面后重试。</p>",
      );

      finish();
      // A mismatched state means the redirect didn't come from the request this flow started —
      // reject rather than exchanging somebody else's code.
      if (error) reject(new Error(`Google 返回：“${error}".`));
      else if (!code) reject(new Error("Google 未返回登录授权码。"));
      else if (returnedState !== state) reject(new Error("登录验证信息不一致，请重新登录。"));
      else resolve({ code, redirectUri });
    });

    let redirectUri = "";
    const timer = setTimeout(() => {
      finish();
      reject(new Error("登录超时，请重试。"));
    }, SIGN_IN_TIMEOUT_MS);

    function finish() {
      clearTimeout(timer);
      server.close();
    }

    server.on("error", (err) => {
      finish();
      reject(err);
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = new URL(AUTH_ENDPOINT);
      authUrl.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      }).toString();
      void shell.openExternal(authUrl.toString());
    });
  });
}

/** Whether a session is currently signed in — used by main.ts to answer the renderer on reload. */
export function hasGoogleSession(): boolean {
  return accessToken !== null;
}
