import { config } from "./config.js";
import { getTokens, saveTokens, type JobberTokens } from "./store.js";

const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_URL = "https://api.getjobber.com/api/graphql";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

async function tokenRequest(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  const body = await response.json() as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) throw new Error(`Jobber OAuth failed: ${body.error_description ?? body.error ?? response.status}`);
  return body;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<JobberTokens> {
  const body = await tokenRequest(new URLSearchParams({
    client_id: config.JOBBER_CLIENT_ID,
    client_secret: config.JOBBER_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  }));
  const tokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000 - 60_000
  };
  await saveTokens(tokens);
  return tokens;
}

async function freshTokens(): Promise<JobberTokens> {
  const current = await getTokens();
  if (!current) throw new Error("Jobber is not connected. Visit the private setup URL first.");
  if (current.expiresAt > Date.now()) return current;
  const body = await tokenRequest(new URLSearchParams({
    client_id: config.JOBBER_CLIENT_ID,
    client_secret: config.JOBBER_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: current.refreshToken
  }));
  const next = {
    ...current,
    accessToken: body.access_token,
    refreshToken: body.refresh_token || current.refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000 - 60_000
  };
  await saveTokens(next);
  return next;
}

export async function jobberGraphql(query: string, variables: Record<string, unknown> = {}) {
  let tokens = await freshTokens();
  const send = () => fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "X-JOBBER-GRAPHQL-VERSION": config.JOBBER_GRAPHQL_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  let response = await send();
  if (response.status === 401) {
    tokens = { ...tokens, expiresAt: 0 };
    await saveTokens(tokens);
    tokens = await freshTokens();
    response = await send();
  }
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Jobber API HTTP ${response.status}: ${JSON.stringify(payload)}`);
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`Jobber GraphQL error: ${JSON.stringify(payload.errors)}`);
  }
  return payload;
}
