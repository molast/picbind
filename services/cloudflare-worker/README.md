# PicBind Cloudflare Worker

This Worker provides PicBind API, authentication, Workspace Realtime V2
signaling and WebSocket fallback for Web and Desktop clients.

## Routes

- `GET /api/metrics`
- `POST /api/metrics`
- `POST /api/site/view`
- `GET /api/admin/state?key=...`
- `POST /api/admin/state?key=...`
- `POST /api/seo/baidu/push?key=...`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `POST /api/auth/exchange`
- `GET /api/auth/oauth/google/start`
- `GET /api/auth/oauth/google/callback`
- `GET /api/auth/oauth/github/start`
- `GET /api/auth/oauth/github/callback`
- `POST /api/workspaces`
- `POST /api/workspace-links/:shareId/join`
- `POST /api/workspace-links/:shareId/realtime-ticket`
- `GET /api/workspaces/:workspaceId`
- `GET /api/workspaces/:workspaceId/ice-servers`
- `POST /api/workspaces/:workspaceId/share-link`
- `POST /api/workspaces/:workspaceId/realtime-ticket`
- `GET /api/workspaces/:workspaceId/realtime` (WebSocket upgrade)
- `GET /api/workspaces/:workspaceId/realtime-v2` (one-time Ticket WebSocket upgrade)

Registration and every successful login ensure that the User has one stable
default Workspace. The authentication response includes that Workspace and its
Owner Capability so Web and Desktop clients can restore the same Workspace
without waiting for the first visit to `/workspace`. Migration
`0009_user_default_workspaces.sql` stores the one-to-one provisioning mapping.
This mapping is not a realtime permission or Workspace membership system.
Restoring an older default Workspace automatically replaces its legacy long
Share ID with the compact format and invalidates the old share link.

Anyone can join a Workspace by opening its unguessable `shareId` link or by
entering the same `shareId` in the Desktop client; no login, Session Cookie,
user membership, or account permission is involved. A Share ID uses the compact
`share_` plus 12-character Base64URL format. D1 stores
only persistent Workspace identity and its replaceable share link. Image previews
remain on the owner's device and are relayed only while peers are connected. The Workspace Durable Object
uses WebSocket hibernation for connection fan-out and does not persist image
messages in D1, R2, or Durable Object storage. Source-data requests, proposals,
decisions, previews, and future Workspace features use the same generic relay
and are never persisted by the Worker.

Workspace realtime business messages use the versioned `workspaceRelay`
transport envelope. The Worker validates only its `workspace`, `owner`, or
`user` route; `ephemeral`, `reliable`, or `bulk` delivery; target; frame size;
and reserved infrastructure message boundary. The nested `event.type` is
opaque to the Worker, so adding a new Workspace feature does not require a
Worker change. The Worker overwrites sender identity and transport metadata
from the ephemeral socket attachment before forwarding. Reliable events
receive a generic `eventAck` or `eventNack`; business interpretation and payload
validation belong to the clients. The previous top-level business message
handlers remain frozen only for cached V1/early-V2 clients.

The Workspace WebSocket also carries WebRTC offer, answer, and ICE candidate
signaling. Peers can fetch short-lived Cloudflare TURN credentials without a
login. Preview and
Source Data messages prefer an ordered WebRTC DataChannel and fall back to the
deployed Worker WebSocket when peer connectivity is unavailable. Commit and
other reliable metadata continue through the generic Worker relay. Neither path writes
Workspace image bytes to D1, R2, KV, or Durable Object storage.

Commit creation messages contain metadata and structured operations only. They
are broadcast to currently connected workspace collaborators and are not stored
by the Worker; version image data remains on the owner's device and still uses
the approved Source Data flow when a collaborator chooses Update. Manual
conflict decisions may include merge-parent commit IDs in that metadata; the
Worker forwards them without storing Commit graphs or merge state.

Workspace header styles use the versioned `styleSnapshot` and `styleUpdated`
events. The receiving client requires a trusted Owner sender role and validates
the supported fields and revision before applying them. The Worker treats Style
as opaque relay data and does not persist Style JSON in D1, R2, or Durable
Object storage. Connected clients keep their own workspace-scoped local cache.

Sessions expire after 30 days. Login removes expired sessions for that user and
keeps at most the 20 newest sessions. `last_seen_at` is written at most once per
15 minutes per active session. The daily `03:17 UTC` cron removes all expired
sessions from D1.

Notes:

- `GET /api/metrics` is public read.
- `POST /api/metrics` and `POST /api/site/view` require an allowed `Origin` header.
- Admin endpoints require `ADMIN_KEY` via query `key` or request header `x-admin-key`.
- Every non-WebSocket API response exposes the deployed Worker version through
  `x-picbind-worker-version`. `services/cloudflare-worker/package.json` is the single
  version source. Worker builds import it directly; Dioxus clients use the
  response header for compatibility diagnostics.

## Required binding

- `METRICS_KV`: Cloudflare KV namespace for low-frequency admin display config.
- `METRICS_COUNTER`: Durable Object for high-frequency counters (`totalCompressed`, `totalViews`, `totalSavedBytes`, `formatStats`).
- `GLOBAL_LIMITER`: Worker Rate Limiting binding (global limiter).
- `ROUTE_LIMITER`: Worker Rate Limiting binding (route-level limiter).
- `WORKSPACE_REALTIME`: Durable Object namespace for ephemeral Workspace WebSocket relay.
- `SHARE_IMAGES_R2`: R2 bucket used for OAuth avatar storage.
- `USER_DB`: D1 database for independent user profiles/sessions and persistent Workspace link records.
- `AUTH_LIMITER`: stricter per-IP limiter for registration and login attempts.

## Optional environment variables

- `DEV_MODE`: set to `1` to enable Worker and browser Realtime logs; use `0` in production.
- `ADMIN_KEY`: enables admin endpoints.
- `SITE_URL`: canonical site URL.
- `OAUTH_CALLBACK_ORIGIN`: public Worker origin used to build OAuth callback URLs.
- `ALLOWED_ORIGINS`: comma-separated allowed origins.
- `BAIDU_PUSH_SITE`: Baidu site URL. Defaults to `SITE_URL`.
- `BAIDU_PUSH_TOKEN`: Baidu push token.
- `TURN_TOKEN_ID`: Cloudflare TURN token ID. Kept Worker-side.
- `TURN_API_TOKEN`: Cloudflare TURN API token used to generate short-lived ICE credentials.
- `QINIU_ACCESS_KEY`: Qiniu server access key. Configure as a Worker secret.
- `QINIU_SECRET_KEY`: Qiniu server secret key. Configure as a Worker secret.
- `QINIU_BUCKET`: Qiniu bucket reserved for future Workspace file storage.
- `QINIU_UPLOAD_URL`: Qiniu upload endpoint for the bucket region.
- `QINIU_DOWNLOAD_URL`: Qiniu download/CDN domain used to build download URLs.

`ADMIN_KEY` is a Worker env variable/secret, not a KV entry.

## Fully local development

Local development does not call the deployed Worker, Cloudflare TURN, or R2.
Wrangler runs the Worker code, Durable Objects, KV, and WebSocket signaling on
the local machine. Local state is persisted in `.wrangler/state`.

Run Wrangler locally only for isolated Worker and migration verification:

```bash
cd services/cloudflare-worker
pnpm install --frozen-lockfile
pnpm run d1:migrate:local
pnpm run dev
```

The Dioxus application always uses the deployed authentication Worker at
`https://api.picbind.com/api`, including when the frontend runs locally. Do not
set `PICBIND_API_URL` to a localhost Worker for application development.
Production uses the `picbind-users` D1 database bound as `USER_DB` in
`wrangler.toml`.

The Web Session Cookie remains `HttpOnly; Secure; SameSite=None` for user
profile login state and default Workspace restoration. OAuth callbacks also
create a 60-second, one-time Handoff Code. Link resolution, link rotation, TURN
configuration, and realtime connections do not read the login Cookie or Auth
Session; they continue to use the Owner Capability or public share link.

Run every pending D1 migration before deploying a Worker version that uses the
new schema. Migration `0007_decouple_users_from_workspaces.sql` removes the
historical user ownership and membership relationship. Use the guarded
production command so migrations complete before the Worker is uploaded:

```bash
pnpm run deploy
```

Cloudflare Workers Builds must also use `pnpm run deploy` as its deploy command,
instead of invoking `wrangler deploy` directly. Its API token needs Workers
Scripts edit and D1 edit permissions.

The Dioxus Web application defaults to `http://127.0.0.1:3000`; Wrangler defaults
to `http://127.0.0.1:8787`. Client endpoints are controlled by the Dioxus platform
configuration. When they still point at `https://api.picbind.com`, local Worker
changes are not used until deployment.

For production, store the API tokens as Worker secrets:

```bash
npx wrangler secret put TURN_API_TOKEN
npx wrangler secret put QINIU_ACCESS_KEY
npx wrangler secret put QINIU_SECRET_KEY
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

Configure the provider callback URLs exactly as follows:

```text
https://api.picbind.com/api/auth/oauth/google/callback
https://api.picbind.com/api/auth/oauth/github/callback
```

OAuth state and PKCE verifiers are one-time records in D1. Google and GitHub
identities are keyed only by the provider and its stable user ID. The Worker
does not request, read, or store provider email addresses and never links
accounts by email. Each provider identity creates an independent User profile
only. `users.email` is populated only by email-and-password registration.
Migration `0004_provider_isolated_users.sql` separates previously linked
provider identities and invalidates existing Sessions before Worker `3.4.0` is
deployed.

The Web client opens provider authorization in a separate popup and uses
`/auth-callback.html` as its same-origin return page. The callback publishes the
one-time Handoff Code over a request-scoped `BroadcastChannel`, closes the
popup, and lets the unchanged main page exchange the code. The main page does
not navigate or reload when OAuth completes; only its account control updates.

The Tauri client binds a random IPv4 loopback port for each OAuth request and
starts OAuth with
`return_to=http://127.0.0.1:<port>/picbind/oauth/callback`. After provider
authorization, the Worker redirects the system browser to that exact callback
with a 60-second, one-time Handoff Code. The code is bound to the exact loopback
origin, including its port, and can be consumed once by
`POST /api/auth/exchange`; Session tokens are never placed in the callback URL.
The Desktop application does not register or accept a custom URL scheme.

No OAuth provider callback registration changes are needed: Google and GitHub
still return to the HTTPS Worker callback URLs listed above.

Migration `0005_auth_handoff_codes.sql` must be applied before deploying OAuth
handoff routes. Handoff rows contain only hashed one-time
codes and authentication metadata; expired rows are removed by the existing
scheduled cleanup.

The Worker uses the Qiniu server SDK signing utilities to create short-lived
upload tokens. The full SDK entrypoint is intentionally not bundled because its
Node HTTP stack is incompatible with Cloudflare Workers. AK/SK must never be
exposed through client build variables or returned to the browser. The
browser will receive only an object key, upload endpoint, and short-lived upload
token when Qiniu Workspace storage is enabled.

Set `TURN_TOKEN_ID` as a Worker environment variable. The Worker generates
one-hour ICE credentials and relays SDP signaling through the Workspace Durable
Object. Image bytes prefer the client-to-client WebRTC DataChannel and fall back
to the Workspace WebSocket; TURN is used when a direct ICE candidate pair cannot
connect.

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
