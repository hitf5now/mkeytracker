/**
 * Blizzard Battle.net API client.
 *
 * Uses OAuth2 client credentials flow for server-to-server calls.
 * Tokens are cached for 23 hours (they last 24h from Blizzard).
 *
 * Primary use: fetching character media (portraits/renders) for
 * display on the website and Discord embeds.
 */

import { env } from "../config/env.js";

const TOKEN_URL = "https://us.battle.net/oauth/token";
const API_BASE: Record<string, string> = {
  us: "https://us.api.blizzard.com",
  eu: "https://eu.api.blizzard.com",
  kr: "https://kr.api.blizzard.com",
  tw: "https://tw.api.blizzard.com",
};

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 1hr buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 3600_000) {
    return cachedToken.token;
  }

  const clientId = env.BLIZZARD_CLIENT_ID;
  const clientSecret = env.BLIZZARD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Blizzard OAuth failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.token;
}

// ─── Character Media ─────────────────────────────────────────────────

export interface CharacterMedia {
  avatar: string | null;
  inset: string | null;
  mainRaw: string | null;
}

/**
 * Fetch character portrait/render URLs from Blizzard's Character Media API.
 *
 * Returns publicly-embeddable CDN URLs — no auth needed to display them.
 * Returns null values if the character doesn't exist or has no renders.
 */
export async function fetchCharacterMedia(
  region: string,
  realmSlug: string,
  characterName: string,
): Promise<CharacterMedia | null> {
  const clientId = env.BLIZZARD_CLIENT_ID;
  if (!clientId) return null; // Blizzard API not configured

  try {
    const token = await getAccessToken();
    const apiBase = API_BASE[region] ?? API_BASE.us!;
    const namespace = `profile-${region}`;
    const name = characterName.toLowerCase();

    const url = `${apiBase}/profile/wow/character/${encodeURIComponent(realmSlug)}/${encodeURIComponent(name)}/character-media?namespace=${namespace}&locale=en_US`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return null; // Character not found or not public
    }

    const data = (await res.json()) as {
      assets?: Array<{ key: string; value: string }>;
    };

    if (!data.assets) return null;

    const assetMap = new Map(data.assets.map((a) => [a.key, a.value]));

    return {
      avatar: assetMap.get("avatar") ?? null,
      inset: assetMap.get("inset") ?? null,
      mainRaw: assetMap.get("main-raw") ?? null,
    };
  } catch {
    return null; // Don't fail hard if Blizzard API is down
  }
}
