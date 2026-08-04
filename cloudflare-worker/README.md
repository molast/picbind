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
- Every non-WebSocket API response exposes the deployed Worker version through
  `x-picbind-worker-version`. `cloudflare-worker/package.json` is the single
  version source. Worker builds import it directly; Room and Web development or
  build commands generate the SDK-side expected version automatically.

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
- `ROOM_URL`: optional standalone Room SDK entry URL used for generated invite links.
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
- `QINIU_ACCESS_KEY`: Qiniu server access key. Configure as a Worker secret.
- `QINIU_SECRET_KEY`: Qiniu server secret key. Configure as a Worker secret.
- `QINIU_BUCKET`: Qiniu bucket used for future room file storage.
- `QINIU_UPLOAD_URL`: Qiniu upload endpoint for the bucket region.
- `QINIU_DOWNLOAD_URL`: Qiniu download/CDN domain used to build download URLs.

`ADMIN_KEY` is a Worker env variable/secret, not a KV entry.

## Fully local development

Local development does not call the deployed Worker, Cloudflare TURN, or R2.
Wrangler runs the Worker code, Durable Objects, KV, and WebSocket signaling on
the local machine. Local state is persisted in `.wrangler/state`.

The launcher checks the local API dependencies and automatically runs
`pnpm install --frozen-lockfile` when required commands are missing. Start both the
local API and Next.js app from the repository root:

```bash
# macOS / Linux / Git Bash / WSL
./dev-local.sh

# Windows CMD
dev-local.cmd

# Windows PowerShell
.\dev-local.cmd
```

Open `http://localhost:3000`. The frontend always requests the deployed Worker
at `https://api.picbind.com`, including during local Web development. Use two
browser profiles or an incognito window to test owner and guest. Worker changes
must be deployed before the frontend can use them. Wrangler may still be run
manually for isolated Worker development, but `dev-local.sh` does not start it.

For production, store the API tokens as Worker secrets:

```bash
npx wrangler secret put TURN_API_TOKEN
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put QINIU_ACCESS_KEY
npx wrangler secret put QINIU_SECRET_KEY
```

The Worker uses the Qiniu server SDK signing utilities to create short-lived
upload tokens. The full SDK entrypoint is intentionally not bundled because its
Node HTTP stack is incompatible with Cloudflare Workers. AK/SK must never be
exposed through `NEXT_PUBLIC_*` variables or returned to the browser. The
browser will receive only an object key, upload endpoint, and short-lived upload
token when Qiniu room storage is enabled.

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
ROOM_URL=https://room.picbind.com
ALLOWED_ORIGINS=https://picbind.com,https://www.picbind.com,https://room.picbind.com
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
