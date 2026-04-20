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
NEXT_PUBLIC_METRICS_API_PATH=https://picbind-api.example.workers.dev/api/metrics
NEXT_PUBLIC_PAGE_VIEW_ENABLED=true
NEXT_PUBLIC_PAGE_VIEW_API_PATH=https://picbind-api.example.workers.dev/api/site/view
```
