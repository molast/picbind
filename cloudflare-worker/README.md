# PicBind Cloudflare Worker

This Worker replaces the old Next.js API routes when deploying the web app to Cloudflare Pages.

## Routes

- `GET /api/metrics`
- `POST /api/metrics`
- `POST /api/site/view`
- `GET /api/admin/state?key=...`
- `POST /api/admin/state?key=...`
- `POST /api/seo/baidu/push?key=...`

## Required binding

- `METRICS_KV`: Cloudflare KV namespace for metrics and UI state.

## Optional environment variables

- `ADMIN_KEY`: enables admin endpoints.
- `SITE_URL`: canonical site URL.
- `ALLOWED_ORIGINS`: comma-separated allowed origins.
- `BAIDU_PUSH_SITE`: Baidu site URL. Defaults to `SITE_URL`.
- `BAIDU_PUSH_TOKEN`: Baidu push token.

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

Quick check:

```bash
curl -i https://api.picbind.com/api/metrics
curl -i -X POST https://api.picbind.com/api/site/view
curl -i "https://api.picbind.com/api/admin/state?key=<your-admin-key>"
```
