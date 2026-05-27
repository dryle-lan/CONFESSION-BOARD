// =============================================
// CONFESSIONAL — Cloudflare Worker
// =============================================

const RATE_LIMIT_MAX    = 3;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in ms
const TITLE_MAX         = 100;
const BODY_MAX          = 1000;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function hashIP(ip) {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + "confessional-salt-v1");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function sanitize(str) {
  return String(str)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

function corsHeaders(origin, allowedOrigin) {
  const allowed = origin === allowedOrigin ? origin : allowedOrigin;
  return {
    "Access-Control-Allow-Origin":  allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function securityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options":        "DENY",
    "Referrer-Policy":        "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'none'; style-src 'none';",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...securityHeaders(),
      ...extraHeaders,
    },
  });
}

function error(message, status = 400, extraHeaders = {}) {
  return json({ error: message }, status, extraHeaders);
}

// ── Rate Limiting ──────────────────────────────────────────────────────────────

async function checkRateLimit(env, ipHash) {
  const key   = `ratelimit:${ipHash}`;
  const now   = Date.now();
  const raw   = await env.RATELIMIT.get(key);

  if (raw) {
    const record = JSON.parse(raw);
    const elapsed = now - record.window_start;

    if (elapsed < RATE_LIMIT_WINDOW) {
      if (record.count >= RATE_LIMIT_MAX) return false;
      await env.RATELIMIT.put(key, JSON.stringify({
        count: record.count + 1,
        window_start: record.window_start,
      }), { expirationTtl: Math.ceil((RATE_LIMIT_WINDOW - elapsed) / 1000) + 10 });
      return true;
    }
  }

  // New window
  await env.RATELIMIT.put(key, JSON.stringify({
    count: 1,
    window_start: now,
  }), { expirationTtl: Math.ceil(RATE_LIMIT_WINDOW / 1000) });

  return true;
}

// ── Content Moderation ─────────────────────────────────────────────────────────

async function moderate(env, title, body) {
  try {
    const prompt = `You are a content moderation system for an anonymous confession board.
Analyze the following submission and determine if it is safe to publish.

REJECT if the content contains: hate speech, slurs, threats of violence, self-harm encouragement, sexual content, personal identifying information of others, spam, or illegal activity.
ALLOW if the content is a personal confession, venting, opinion, embarrassing story, or general life experience — even if emotionally raw.

Title: ${title}
Body: ${body}

Respond ONLY with valid JSON in this exact format, nothing else:
{"safe": true, "reason": ""}
or
{"safe": false, "reason": "brief reason"}`;

    const response = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 60,
    });

    const text = response?.response || "";
    // Extract JSON from response
    const match = text.match(/\{[^}]+\}/);
    if (!match) return { safe: true }; // fail open if parse error

    const result = JSON.parse(match[0]);
    return { safe: result.safe !== false };
  } catch {
    return { safe: true }; // fail open on AI errors
  }
}

// ── Route Handlers ─────────────────────────────────────────────────────────────

// GET /api/confessions?sort=newest|popular
async function getConfessions(request, env) {
  const url    = new URL(request.url);
  const sort   = url.searchParams.get("sort") === "popular" ? "popular" : "newest";
  const limit  = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);

  const orderBy = sort === "popular"
    ? "(upvotes - downvotes) DESC, created_at DESC"
    : "created_at DESC";

  const { results } = await env.DB.prepare(`
    SELECT id, title, body, upvotes, downvotes, created_at
    FROM confessions
    WHERE is_visible = 1
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  return json({ confessions: results || [], sort });
}

// POST /api/confessions
async function createConfession(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body");
  }

  const title = (body.title || "").trim();
  const text  = (body.body  || "").trim();

  if (!title) return error("Title is required");
  if (!text)  return error("Confession body is required");
  if (title.length > TITLE_MAX) return error(`Title must be ${TITLE_MAX} characters or fewer`);
  if (text.length  > BODY_MAX)  return error(`Confession must be ${BODY_MAX} characters or fewer`);

  const ip     = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hashIP(ip);

  // Rate limit
  const allowed = await checkRateLimit(env, ipHash);
  if (!allowed) {
    return error("You've confessed too much recently. Try again later.", 429);
  }

  // Content moderation
  const { safe } = await moderate(env, title, text);
  if (!safe) {
    return error("Your confession couldn't be posted. Please keep it respectful.", 422);
  }

  const safeTitle = sanitize(title);
  const safeBody  = sanitize(text);

  const result = await env.DB.prepare(`
    INSERT INTO confessions (title, body, upvotes, downvotes, is_visible)
    VALUES (?, ?, 0, 0, 1)
    RETURNING id, title, body, upvotes, downvotes, created_at
  `).bind(safeTitle, safeBody).first();

  return json({ confession: result }, 201);
}

// POST /api/confessions/:id/vote
async function voteConfession(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body");
  }

  const voteType = body.vote;
  if (voteType !== "up" && voteType !== "down") {
    return error("Vote must be 'up' or 'down'");
  }

  const confessionId = parseInt(id);
  if (isNaN(confessionId)) return error("Invalid confession ID");

  // Check confession exists
  const confession = await env.DB.prepare(
    "SELECT id FROM confessions WHERE id = ? AND is_visible = 1"
  ).bind(confessionId).first();

  if (!confession) return error("Confession not found", 404);

  const ip     = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hashIP(ip);

  // Check existing vote
  const existing = await env.DB.prepare(
    "SELECT vote_type FROM votes WHERE confession_id = ? AND ip_hash = ?"
  ).bind(confessionId, ipHash).first();

  if (existing) {
    // Allow vote change: remove old vote, apply new one
    if (existing.vote_type === voteType) {
      return error("You have already cast this vote", 409);
    }

    // Switching vote
    const decCol = existing.vote_type === "up" ? "upvotes" : "downvotes";
    const incCol = voteType === "up" ? "upvotes" : "downvotes";

    await env.DB.batch([
      env.DB.prepare(`UPDATE confessions SET ${decCol} = MAX(0, ${decCol} - 1), ${incCol} = ${incCol} + 1 WHERE id = ?`).bind(confessionId),
      env.DB.prepare("UPDATE votes SET vote_type = ? WHERE confession_id = ? AND ip_hash = ?").bind(voteType, confessionId, ipHash),
    ]);
  } else {
    const incCol = voteType === "up" ? "upvotes" : "downvotes";

    await env.DB.batch([
      env.DB.prepare(`UPDATE confessions SET ${incCol} = ${incCol} + 1 WHERE id = ?`).bind(confessionId),
      env.DB.prepare("INSERT INTO votes (confession_id, ip_hash, vote_type) VALUES (?, ?, ?)").bind(confessionId, ipHash, voteType),
    ]);
  }

  const updated = await env.DB.prepare(
    "SELECT upvotes, downvotes FROM confessions WHERE id = ?"
  ).bind(confessionId).first();

  return json({
    upvotes:   updated.upvotes,
    downvotes: updated.downvotes,
    voted:     voteType,
  });
}

// ── Main Handler ───────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    const origin        = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const cors          = corsHeaders(origin, allowedOrigin);

    // Preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Only handle /api/* routes
    if (!path.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    try {
      let response;

      if (path === "/api/confessions" && method === "GET") {
        response = await getConfessions(request, env);
      } else if (path === "/api/confessions" && method === "POST") {
        response = await createConfession(request, env);
      } else if (path.match(/^\/api\/confessions\/(\d+)\/vote$/) && method === "POST") {
        const id = path.match(/^\/api\/confessions\/(\d+)\/vote$/)[1];
        response = await voteConfession(request, env, id);
      } else {
        response = error("Route not found", 404);
      }

      // Attach CORS to all responses
      const newHeaders = new Headers(response.headers);
      Object.entries(cors).forEach(([k, v]) => newHeaders.set(k, v));
      return new Response(response.body, {
        status:  response.status,
        headers: newHeaders,
      });
    } catch (err) {
      console.error("Worker error:", err);
      return json({ error: "Internal server error" }, 500, cors);
    }
  },
};
