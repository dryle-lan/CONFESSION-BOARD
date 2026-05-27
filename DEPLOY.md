# CONFESSIONAL — Deployment Guide
Step-by-step: zero to live on Cloudflare free tier.

---

## Prerequisites

- Node.js 18+ installed
- A Cloudflare account (free) at https://dash.cloudflare.com
- Git installed

---

## Step 1 — Install Wrangler CLI

```bash
npm install -g wrangler
```

Verify:
```bash
wrangler --version
```

---

## Step 2 — Log In to Cloudflare

```bash
wrangler login
```

This opens a browser window. Authorize Wrangler with your Cloudflare account.

---

## Step 3 — Create the D1 Database

```bash
wrangler d1 create confessional-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:
```toml
[[d1_databases]]
binding       = "DB"
database_name = "confessional-db"
database_id   = "PASTE_YOUR_ID_HERE"
```

---

## Step 4 — Run the Database Schema

```bash
wrangler d1 execute confessional-db --file=./schema.sql
```

Verify tables were created:
```bash
wrangler d1 execute confessional-db --command="SELECT name FROM sqlite_master WHERE type='table';"
```

You should see: `confessions` and `votes`.

---

## Step 5 — Create the KV Namespace

```bash
wrangler kv:namespace create RATELIMIT
wrangler kv:namespace create RATELIMIT --preview
```

Copy both IDs into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding    = "RATELIMIT"
id         = "PASTE_PROD_ID_HERE"
preview_id = "PASTE_PREVIEW_ID_HERE"
```

---

## Step 6 — Deploy the Worker

```bash
wrangler deploy
```

Note the Worker URL from the output, e.g.:
`https://confessional-api.YOUR_SUBDOMAIN.workers.dev`

---

## Step 7 — Deploy Frontend via Cloudflare Pages

### Option A — CLI deploy (simplest)

```bash
wrangler pages deploy public --project-name=confessional
```

On first run, Wrangler will create the Pages project and give you a URL:
`https://confessional.pages.dev`

### Option B — Git-connected deploy

1. Push your project to a GitHub repo
2. In Cloudflare Dashboard → Pages → Create a project → Connect to Git
3. Select your repo
4. Build settings:
   - Build command: (leave empty)
   - Build output directory: `public`
5. Deploy

---

## Step 8 — Connect Worker to Pages

In `wrangler.toml`, update the ALLOWED_ORIGIN and route:

```toml
[vars]
ALLOWED_ORIGIN = "https://confessional.pages.dev"

[[routes]]
pattern = "confessional.pages.dev/api/*"
```

Then redeploy the Worker:
```bash
wrangler deploy
```

---

## Step 9 — Enable Workers AI (for moderation)

1. Go to Cloudflare Dashboard → Workers & Pages → your Worker
2. Click Settings → Bindings → Add binding
3. Choose "Workers AI" → save as binding name `AI`

Or add to `wrangler.toml`:
```toml
[ai]
binding = "AI"
```

Then redeploy:
```bash
wrangler deploy
```

---

## Step 10 — Test It

```bash
# Test the API Worker directly
curl https://confessional-api.YOUR_SUBDOMAIN.workers.dev/api/confessions

# Should return: {"confessions":[],"sort":"newest"}
```

Then open your Pages URL in the browser and submit a confession.

---

## Local Development

Run the Worker locally with live D1/KV:
```bash
wrangler dev --remote
```

Then open `http://localhost:8787` in your browser.

For the static frontend locally, use any static server:
```bash
npx serve public
```

---

## Environment Summary

| Resource         | Name               | Binding     |
|------------------|--------------------|-------------|
| D1 Database      | confessional-db    | DB          |
| KV Namespace     | RATELIMIT          | RATELIMIT   |
| Workers AI       | (auto)             | AI          |
| Pages Project    | confessional       | —           |
| Worker Name      | confessional-api   | —           |

---

## Free Tier Limits (Cloudflare)

| Service      | Free Limit                      | Your usage at scale         |
|--------------|---------------------------------|-----------------------------|
| Pages        | Unlimited requests              | No concern                  |
| Workers      | 100,000 req/day                 | ~3 req per page load        |
| D1           | 5GB storage, 5M reads/day       | Plenty for a confession board |
| KV           | 100k reads/day, 1k writes/day   | Only hits on submissions    |
| Workers AI   | 10,000 neurons/day (free beta)  | ~1 moderation per post      |

---

## Common Issues

**CORS errors in browser:**
- Make sure ALLOWED_ORIGIN in wrangler.toml matches your exact Pages URL (no trailing slash)
- Redeploy Worker after changing

**AI binding not found:**
- Add `[ai] binding = "AI"` to wrangler.toml and redeploy

**D1 queries failing:**
- Confirm schema was applied: run Step 4 again (it's idempotent with IF NOT EXISTS)

**KV rate limit not working locally:**
- Use `wrangler dev --remote` to test KV; local mode uses in-memory KV

---

You're live. ∎
