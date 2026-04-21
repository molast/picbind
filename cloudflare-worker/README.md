# PicBind Cloudflare Worker

This Worker replaces the old Next.js API routes when deploying the web app to Cloudflare Pages.

## Routes

- `GET /api/metrics`
- `POST /api/metrics`
- `POST /api/site/view`
- `GET /api/admin/state?key=...`
- `POST /api/admin/state?key=...`
- `POST /api/seo/baidu/push?key=...`

Notes:

- `GET /api/metrics` is public read.
- `POST /api/metrics` and `POST /api/site/view` require an allowed `Origin` header.
- Admin endpoints require `ADMIN_KEY` via query `key` or request header `x-admin-key`.

## Required binding

- `METRICS_KV`: Cloudflare KV namespace for low-frequency admin display config.
- `METRICS_COUNTER`: Durable Object for high-frequency counters (`totalCompressed`, `totalViews`, `totalSavedBytes`, `formatStats`).
- `GLOBAL_LIMITER`: Worker Rate Limiting binding (global limiter).
- `ROUTE_LIMITER`: Worker Rate Limiting binding (route-level limiter).

## Optional environment variables

- `ADMIN_KEY`: enables admin endpoints.
- `SITE_URL`: canonical site URL.
- `ALLOWED_ORIGINS`: comma-separated allowed origins.
- `BAIDU_PUSH_SITE`: Baidu site URL. Defaults to `SITE_URL`.
- `BAIDU_PUSH_TOKEN`: Baidu push token.

`ADMIN_KEY` is a Worker env variable/secret, not a KV entry.

The current Pages app has API calls disabled by default. When this Worker is deployed, set the Pages env vars to point to it, for example:

```text
NEXT_PUBLIC_METRICS_ENABLED=true
NEXT_PUBLIC_METRICS_API_PATH=https://api.picbind.com/api/metrics
NEXT_PUBLIC_PAGE_VIEW_ENABLED=true
NEXT_PUBLIC_PAGE_VIEW_API_PATH=https://api.picbind.com/api/site/view
NEXT_PUBLIC_ADMIN_STATE_API_PATH=https://api.picbind.com/api/admin/state
```

Recommended Worker env values:

```text
SITE_URL=https://picbind.com
ALLOWED_ORIGINS=https://picbind.com,https://www.picbind.com
BAIDU_PUSH_SITE=https://picbind.com
ADMIN_KEY=<your-admin-key>
BAIDU_PUSH_TOKEN=<your-baidu-token>
```

Storage strategy:

- High-frequency writes (compression metrics + page view): Durable Object (`METRICS_COUNTER`)
- Low-frequency config writes (admin display toggles): KV (`METRICS_KV`)
- Summary cache sync (DO -> KV): dual trigger
  - Count trigger: sync every `100` writes
  - Time trigger: force sync every `60s`

Read strategy:

- Homepage `/api/metrics` GET: reads KV summary cache (fast path)
- Admin `/api/admin/state` GET: reads Durable Object (accurate real-time counters)

Rate limit strategy:

- Layer 1 (global): `ip + key` (key means admin key or `public`)
- Layer 2 (per route): `ip + key + pathname`

In `wrangler.toml`, replace the `namespace_id` placeholders with your real Rate Limiting namespace IDs.

Quick check:

```bash
curl -i https://api.picbind.com/api/metrics
curl -i -X POST https://api.picbind.com/api/site/view
curl -i "https://api.picbind.com/api/admin/state?key=<your-admin-key>"
```
