# PicBind Messaging Service Current Architecture

This document describes the messaging behavior implemented in the current
repository. Weixin iLink is a Desktop-only capability. The browser application
and Cloudflare Worker do not connect to, proxy, or persist Weixin messaging.

## 1. Current Boundary

Implemented:

- A shared messaging model, Provider interface, event dispatcher, and Provider
  lifecycle in Room SDK.
- Weixin iLink QR login and login status polling in the Tauri Rust backend.
- Direct HTTPS calls from Desktop to the Tencent iLink API.
- A local Tokio long-poll task for `getupdates`.
- Text send/receive and image send/receive.
- Local AES image encryption/decryption and iLink CDN transfer.
- Local account persistence with `0600` file permissions on Unix.
- Room chat UI, local image cache, image preview, and moving an incoming image
  into the workspace library.

Not implemented:

- Weixin Bot in the regular Web application.
- Worker routes, Durable Objects, or R2 bindings for Weixin messaging.
- Video, voice, or general file messages.
- Multiple Weixin contacts with a dedicated contact manager.
- Persistent text-message history.
- Telegram, Discord, or Slack providers.

The `file` normalized message type remains reserved for future providers and
does not imply that Weixin file messages are supported.

## 2. Runtime Architecture

```text
Weixin user
   |
Tencent iLink Bot API / iLink CDN
   |
Tauri Rust backend
   |-- local account file: token, sync cursor, context tokens
   |-- Tokio task: getupdates long polling
   |-- AES media encryption/decryption
   `-- in-memory incoming media buffer
   |
Tauri commands
   |
IlinkTauriTransport
   |
Room SDK Messaging Core and Room UI
```

The regular Web runtime configures no messaging Provider. Consequently the
Room header does not show the messaging entry, and the messaging and Weixin
chat dialogs are not rendered.

The Cloudflare Worker continues to provide Room signaling, WebSocket fallback,
metrics, and R2 room-transfer services. It has no Weixin route and does not need
to understand messaging payloads.

## 3. Code Ownership

```text
desktop/src-tauri/src/messaging/
|-- commands.rs       Tauri IPC commands
|-- models.rs         IPC request, response, and event models
|-- repository.rs     account state, login sessions, poller, event queue
`-- ilink.rs          iLink HTTP, normalization, crypto, and CDN media

sdk/room/src/messaging/
|-- core/             normalized model and Provider contracts
|-- providers/weixin/
|   |-- provider.ts
|   `-- tauri-transport.ts
`-- router/           MessagingService dispatch

sdk/room/src/components/share/
|-- messaging-service-dialog.tsx
|-- weixin-chat-dialog.tsx
`-- share-room-page.tsx
```

## 4. Account and Session Storage

After QR confirmation, Desktop stores the following fields in
`messaging/weixin-account.json` under the Tauri application data directory:

- iLink Bot account ID and token.
- Redirected iLink base URL.
- iLink user ID, when supplied.
- `getupdates` sync buffer.
- Per-conversation context tokens required for replies.

The temporary file is created with mode `0600` on Unix before it atomically
replaces the account file. Credentials are never returned to TypeScript and are
never written to browser storage, Worker storage, D1, Durable Objects, or R2.

Incoming and outgoing Weixin image metadata still uses the Room SDK local image
repository. Text chat remains in React runtime state and is lost on refresh.

## 5. Desktop IPC

The Tauri backend exposes:

| Command | Purpose |
| --- | --- |
| `messaging_status` | Read the current gateway snapshot |
| `messaging_start_login` | Request an iLink QR login session |
| `messaging_login_status` | Poll QR scan/confirmation state |
| `messaging_connect` | Start the local `getupdates` task |
| `messaging_disconnect` | Stop the local task |
| `messaging_send_text` | Send text through iLink |
| `messaging_send_image` | Encrypt, upload, and send an image |
| `messaging_download_image` | Consume a downloaded image from local memory |
| `messaging_take_events` | Drain status, message, and error events |

`IlinkTauriTransport` polls the event queue serially every 250 ms while the
Provider is active. It converts QR payloads to data URLs in TypeScript and maps
Rust events back to normalized SDK events.

## 6. Connection Lifecycle

1. Desktop reads the local account file during Tauri setup.
2. If no account exists, the user starts QR login from the messaging dialog.
3. Desktop polls QR status and saves credentials only after confirmation.
4. Provider start invokes `messaging_connect`.
5. A dedicated reqwest client without a short total timeout runs iLink long
   polling. Ordinary login/send calls use a separate 35-second API client.
6. Each successful response updates the sync buffer and context tokens, then
   persists the account.
7. Stale context-token responses are retried after refreshing the token.
8. Session expiration removes the account file and emits an error snapshot.
9. Provider stop cancels the poll task and stops TypeScript event polling.

Starting the Tokio poll task marks the gateway connected immediately because
an idle iLink long poll can remain quiet for roughly 30 seconds.

## 7. Media Rules

- Maximum media size: 20 MiB.
- Outbound images use AES-128-ECB with PKCS7 padding and the iLink CDN upload
  protocol.
- Incoming images are downloaded only from the approved iLink CDN host,
  decrypted locally, MIME-sniffed, and held in memory until the UI consumes
  them.
- JPEG, PNG, GIF, and WebP signatures are accepted.
- AVIF is rejected because iLink does not currently support it in this flow.
- Unknown or invalid image data is rejected instead of being silently stored.

This media path is separate from Room R2 transfer and does not use Worker R2
credentials or browser-facing upload URLs.

## 8. Verification

Automated checks cover iLink response handling, stale context recognition,
message normalization, stable identities, media-key decoding, PKCS7 padding,
and image-type detection. The migration must also keep these checks passing:

```bash
cargo test --manifest-path desktop/src-tauri/Cargo.toml
pnpm --dir sdk/room check
pnpm --dir sdk/room test:storage
pnpm --dir web build
pnpm --dir cloudflare-worker check
```

Real QR scan, account confirmation, long polling, and end-to-end image exchange
require a signed Desktop build and a real Weixin account, so they remain manual
acceptance checks.
