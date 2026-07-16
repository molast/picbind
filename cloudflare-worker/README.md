# PicBind Cloudflare Worker

This Worker replaces the old Next.js API routes when deploying the web app to Cloudflare Pages.

## Routes

- `GET /api/metrics`
- `POST /api/metrics`
- `POST /api/site/view`
- `GET /api/admin/state?key=...`
- `POST /api/admin/state?key=...`
- `POST /api/seo/baidu/push?key=...`
- `POST /api/realtime/room/create`

Notes:

- `GET /api/metrics` is public read.
- `POST /api/metrics` and `POST /api/site/view` require an allowed `Origin` header.
- Admin endpoints require `ADMIN_KEY` via query `key` or request header `x-admin-key`.

## Required binding

- `METRICS_KV`: Cloudflare KV namespace for low-frequency admin display config.
- `METRICS_COUNTER`: Durable Object for high-frequency counters (`totalCompressed`, `totalViews`, `totalSavedBytes`, `formatStats`).
- `GLOBAL_LIMITER`: Worker Rate Limiting binding (global limiter).
- `ROUTE_LIMITER`: Worker Rate Limiting binding (route-level limiter).
- `REALTIME_ROOMS`: Durable Object namespace for temporary share-room metadata.
- `SHARE_IMAGES_R2`: R2 bucket used for high-latency file-transfer fallback.

## Optional environment variables

- `DEV_MODE`: set to `1` to enable Worker and browser Realtime logs; use `0` in production.
- `ADMIN_KEY`: enables admin endpoints.
- `SITE_URL`: canonical site URL.
- `ALLOWED_ORIGINS`: comma-separated allowed origins.
- `BAIDU_PUSH_SITE`: Baidu site URL. Defaults to `SITE_URL`.
- `BAIDU_PUSH_TOKEN`: Baidu push token.
- `TURN_TOKEN_ID`: Cloudflare TURN token ID. Kept Worker-side.
- `TURN_API_TOKEN`: Cloudflare TURN API token used to generate short-lived ICE credentials.
- `FILE_TRANSFER_MODE`: `r2`, `p2p`, or `auto`. `auto` uses R2 above the RTT threshold.
- `R2_RTT_THRESHOLD_MS`: auto-mode R2 threshold. Defaults to `200`.
- `R2_FILE_TTL_SECONDS`: object lifetime before Worker deletion. Defaults to `1800`.
- `R2_BUCKET_NAME`: S3 API bucket name. Defaults to the configured bucket name.
- `R2_ACCOUNT_ID`: Cloudflare account ID used for the R2 S3 endpoint.
- `R2_ACCESS_KEY_ID`: R2 S3 API access key ID.
- `R2_SECRET_ACCESS_KEY`: R2 S3 API secret access key.

`ADMIN_KEY` is a Worker env variable/secret, not a KV entry.

For local development, copy `.env.example` to `.env` and fill in the TURN
values. Do not prefix either value with `NEXT_PUBLIC_`. For production, store the
API token as a Worker secret:

```bash
npx wrangler secret put TURN_API_TOKEN
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Set `TURN_TOKEN_ID` as a Worker environment variable. The Worker generates
one-hour ICE credentials and relays SDP signaling through the room Durable
Object. Image bytes travel over a browser-to-browser WebRTC DataChannel; TURN is
used only when a direct ICE candidate pair cannot connect.

R2 hybrid transfer uses presigned S3 PUT/GET URLs, so image bytes do not pass
through the Worker. Set `FILE_TRANSFER_MODE="r2"` to force R2 during testing,
`"p2p"` to force DataChannel transfer, or `"auto"` to select R2 when the RTT
reported at Send time exceeds `R2_RTT_THRESHOLD_MS`.

The R2 bucket must allow browser uploads and downloads. Configure bucket CORS
for the deployed site origin, including preview origins when needed:

```json
[
  {
    "AllowedOrigins": ["https://picbind.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Configure an R2 lifecycle rule as a final cleanup fallback. The room Durable
Object also tracks `uploaded -> shared -> downloading -> downloaded -> expired
-> deleted` and deletes the object when its TTL alarm fires.

The current Pages app has API calls disabled by default. When this Worker is deployed, set the Pages env vars to point to it, for example:

```text
NEXT_PUBLIC_METRICS_ENABLED=true
NEXT_PUBLIC_METRICS_API_PATH=https://api.picbind.com/api/metrics
NEXT_PUBLIC_PAGE_VIEW_ENABLED=true
NEXT_PUBLIC_PAGE_VIEW_API_PATH=https://api.picbind.com/api/site/view
NEXT_PUBLIC_ADMIN_STATE_API_PATH=https://api.picbind.com/api/admin/state
NEXT_PUBLIC_SHARE_ROOM_API_PATH=https://api.picbind.com/api/realtime/room/create
```

Recommended Worker env values:

```text
SITE_URL=https://picbind.com
ALLOWED_ORIGINS=https://picbind.com,https://www.picbind.com
BAIDU_PUSH_SITE=https://picbind.com
ADMIN_KEY=<your-admin-key>
BAIDU_PUSH_TOKEN=<your-baidu-token>
TURN_TOKEN_ID=<your-cloudflare-turn-token-id>
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
## update
