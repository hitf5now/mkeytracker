/**
 * Download redirect endpoint.
 *
 * Two routes (registered OUTSIDE the /api/v1 prefix so the URLs stay
 * short and user-facing):
 *
 *   GET /download        — 302 redirect to the latest .exe on GitHub
 *   GET /download/info   — JSON metadata for clients that want to display
 *                          "Download v0.1.2 (95 MB)" before linking
 *
 * Implementation:
 *   - Queries GitHub's Releases API for the latest release
 *   - Picks the first asset whose name ends in .exe (there's only one)
 *   - Caches the resolved URL in Redis for 5 minutes to avoid hitting
 *     GitHub's unauthenticated rate limit (60 req/hr per IP)
 *   - On cache miss + GitHub unreachable, returns 503 with a helpful
 *     message that points at the GitHub releases page as a fallback
 *
 * Why not use /api/v1/download? Because user-facing short URLs matter.
 * `api.mythicplustracker.com/download` is memorable; tacking on /api/v1
 * doesn't earn its complexity for a plain redirect.
 */

import type { FastifyInstance } from "fastify";
import { redis } from "../lib/redis.js";

const GITHUB_REPO = "hitf5now/mkeytracker";
const GITHUB_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const FALLBACK_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
const CACHE_KEY = "download:latest-exe";
const CACHE_TTL_SEC = 300; // 5 minutes

interface ReleaseInfo {
  /** Tag name, e.g. "v0.1.2" */
  version: string;
  /** Direct download URL of the .exe asset */
  url: string;
  /** File size in bytes */
  size: number;
  /** ISO publish timestamp */
  publishedAt: string;
  /** Filename, e.g. "MKeyTracker-Setup.exe" */
  fileName: string;
}

interface GitHubReleaseResponse {
  tag_name: string;
  name: string;
  published_at: string;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
  }>;
}

async function fetchLatestFromGitHub(): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(GITHUB_LATEST_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        // User-Agent is required by GitHub's unauthenticated API
        "User-Agent": "mkeytracker-api/1.0 (+https://mythicplustracker.com)",
      },
    });
    if (!response.ok) return null;

    const release = (await response.json()) as GitHubReleaseResponse;
    // Prefer an unversioned "MKeyTracker-Setup.exe" if present (future releases),
    // otherwise fall back to any .exe asset (legacy versioned filenames).
    const preferred = release.assets.find((a) => a.name === "MKeyTracker-Setup.exe");
    const exeAsset =
      preferred ??
      release.assets.find((a) => a.name.toLowerCase().endsWith(".exe"));
    if (!exeAsset) return null;

    return {
      version: release.tag_name,
      url: exeAsset.browser_download_url,
      size: exeAsset.size,
      publishedAt: release.published_at,
      fileName: exeAsset.name,
    };
  } catch {
    return null;
  }
}

async function getLatestRelease(): Promise<ReleaseInfo | null> {
  // Redis cache hit path — keeps us well under GitHub's 60/hr unauth limit
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) return JSON.parse(cached) as ReleaseInfo;
  } catch {
    // Redis unreachable — degrade gracefully by fetching fresh
  }

  const fresh = await fetchLatestFromGitHub();
  if (fresh) {
    try {
      await redis.setex(CACHE_KEY, CACHE_TTL_SEC, JSON.stringify(fresh));
    } catch {
      // Cache write failed — still return the fresh value
    }
    return fresh;
  }

  return null;
}

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  // ─── Redirect endpoint — the hot path ──────────────────────────
  app.get("/download", async (req, reply) => {
    const release = await getLatestRelease();
    if (!release) {
      req.log.warn("download: could not resolve latest release — returning 503");
      return reply.code(503).send({
        error: "download_unavailable",
        message: `The download service is temporarily unavailable. Please try again in a minute, or browse releases at ${FALLBACK_RELEASES_URL}`,
      });
    }
    req.log.info(
      { version: release.version, file: release.fileName },
      "download: redirecting to latest release",
    );
    return reply.redirect(release.url, 302);
  });

  // ─── JSON info endpoint — used by future web frontend ─────────
  app.get("/download/info", async (_req, reply) => {
    const release = await getLatestRelease();
    if (!release) {
      return reply.code(503).send({
        error: "download_unavailable",
        message: "Could not fetch latest release info. Try again shortly.",
      });
    }
    return reply.code(200).send(release);
  });
}
