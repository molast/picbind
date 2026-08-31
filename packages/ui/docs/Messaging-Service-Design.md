# PicBind Messaging Service Current Architecture

This document describes the messaging behavior implemented in the current
repository. Weixin iLink is a Desktop-only capability. The browser application
and Cloudflare Worker do not connect to, proxy, or persist Weixin messaging.

## 1. Current Boundary

Implemented:

- A shared messaging model, Provider interface, event dispatcher, and Provider
  lifecycle in Workspace.
- Weixin iLink QR login and login status polling in the Tauri Rust backend.
- Direct HTTPS calls from Desktop to the Tencent iLink API.
- A local Tokio long-poll task for `getupdates`.
- Text send/receive and image send/receive.
- Local AES image encryption/decryption and iLink CDN transfer.
- Local account persistence with `0600` file permissions on Unix.
- Desktop Workspace chat UI with text, the packaged official Unicode Emoji
  picker, Workspace image sending, local image cache, image preview, and moving
  an incoming image into the workspace library.

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
Workspace Messaging Core, Hook, and dialogs
```

The Workspace creates the Provider only when its `desktop` runtime flag is
true. Consequently the regular Web application does not render messaging
controls. On Desktop, iLink configuration and connection controls live in
Workspace Settings; the Weixin chat entry lives in the Working panel header.
Neither control occupies the global Workspace header.

The Cloudflare Worker continues to provide Room signaling, WebSocket fallback,
metrics, and R2 room-transfer services. It has no Weixin route and does not need
to understand messaging payloads.

## 3. Code Ownership

```text
apps/desktop/src-tauri/src/messaging/
|-- commands.rs       Tauri IPC commands
|-- models.rs         IPC request, response, and event models
|-- repository.rs     account state, login sessions, poller, event queue
`-- ilink.rs          iLink HTTP, normalization, crypto, and CDN media

packages/ui/src/messaging/
|-- core/             normalized model and Provider contracts
|-- providers/weixin/
|   |-- provider.ts
|   `-- tauri-transport.ts
`-- router/           MessagingService dispatch

packages/ui/src/workspace/
|-- components/workspace-gallery.tsx
|-- components/workspace-gallery-card.tsx
|-- dialogs/workspace-image-picker-dialog.tsx
|                         reusable Workspace image-picker presentation
|-- dialogs/workspace-messaging-image-picker-dialog.tsx
|                         Weixin-specific data filtering and send controls
|-- dialogs/workspace-messaging-quick-send-dialog.tsx
|                         decoded compressed preview and send confirmation
|-- dialogs/workspace-messaging-service-dialog.tsx
|                         iLink controls embedded in Workspace Settings
|-- dialogs/workspace-weixin-chat-dialog.tsx
|-- hooks/use-workspace-messaging.ts
`-- page/workspace-page.tsx
```

`WorkspaceImagePickerDialog` is a new reusable Workspace picker, not a wrapper
around a previously existing image selector. It owns the responsive image-card
grid, selection state presentation, empty state, footer slots, pending overlay,
and stable dialog layout. Feature-specific callers supply the images, labels,
footer controls, and confirm behavior. The Weixin wrapper is its first caller;
future Workspace features that need image selection should reuse this dialog
instead of recreating the card layout.

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

Incoming Weixin image metadata uses the shared local messaging image repository,
scoped by Workspace ID. Text chat remains in React runtime state and is lost on
refresh. An Owner can move a received image into the current Workspace Library;
that action uses the normal Workspace import path and creates the thumbnail and
initial Commit there.

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
2. On each Desktop Workspace entry, the UI reads the iLink gateway status. If
   cached account credentials are configured, it starts the Provider
   automatically without opening the QR login flow.
3. If no account exists, the user starts QR login from Workspace Settings.
4. Desktop polls QR status and saves credentials only after confirmation.
5. Provider start invokes `messaging_connect`.
6. A dedicated reqwest client without a short total timeout runs iLink long
   polling. Ordinary login/send calls use a separate 35-second API client.
7. Each successful response updates the sync buffer and context tokens, then
   persists the account.
8. Stale context-token responses are retried after refreshing the token.
9. Session expiration removes the account file and emits an error snapshot.
10. Leaving the Desktop Workspace stops the Provider, cancels the poll task, and
   releases chat image object URLs.

Starting the Tokio poll task marks the gateway connected immediately because
an idle iLink long poll can remain quiet for roughly 30 seconds.

## 7. Media Rules

- Maximum media size: 20 MiB.
- The outbound picker initially lists only Working images that are not currently
  collaborating. Each card shows its thumbnail, name, byte size, and dimensions.
- If no eligible Working image exists, the picker shows an empty state. The user
  can switch to Library, select an image, move it into Working through the normal
  Workspace command, and then send it.
- Every non-collaborating Working card exposes a Desktop quick-send button. It is
  enabled only while Weixin iLink is connected and the local source is available.
  Clicking it runs `messaging-fast` while the existing card thumbnail remains
  unchanged and a screen-centered compression loading overlay blocks competing
  actions. The confirmation dialog opens only after the compressed image has
  decoded successfully and shows the actual send payload, dimensions, original
  size, and send size.
- Confirming a Working-card quick send uploads directly through the connected
  iLink Provider without opening the chat dialog. The outgoing message is still
  inserted into the same Workspace message list, persisted through the existing
  image-message repository, and appears when chat is opened later.
- The footer includes a reusable segmented compression-mode control. `Fast` is
  selected by default and invokes the Desktop-only `messaging-fast` profile;
  `Standard` invokes the existing full-size Planner flow. `Send original image`
  has higher priority and disables both compression choices.
- Fast mode follows the classic Luban dimension bands, skips compatible images
  at or below 100 KiB, downsamples larger images when the band requires it, and
  performs one encode. Opaque images become JPEG quality 60; transparent images
  become fast WebP quality 75 instead of flattening Alpha. A compatible original
  is retained when the encoded candidate is not smaller.
- Standard mode uses same-format Planner compression for JPEG, PNG, and WebP,
  preventing Predictor from selecting a payload format that iLink cannot
  accept. AVIF and JPEG XL are converted to WebP for iLink compatibility. GIF
  cannot use either compression path and therefore requires `Send original
  image`.
- Outbound images use AES-128-ECB with PKCS7 padding and the iLink CDN upload
  protocol.
- Incoming images are downloaded only from the approved iLink CDN host,
  decrypted locally, MIME-sniffed, and held in memory until the UI consumes
  them.
- JPEG, PNG, GIF, and WebP signatures are accepted.
- Original AVIF and JPEG XL files are rejected because iLink does not support
  those payload formats in this flow.
- Unknown or invalid image data is rejected instead of being silently stored.

This media path is separate from Room R2 transfer and does not use Worker R2
credentials or browser-facing upload URLs.

## 8. Verification

Automated checks cover iLink response handling, stale context recognition,
message normalization, stable identities, media-key decoding, PKCS7 padding,
and image-type detection. The migration must also keep these checks passing:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --dir packages/ui check
pnpm --dir packages/ui test:storage
pnpm --dir web build
pnpm --dir services/cloudflare-worker check
```

Real QR scan, account confirmation, long polling, Working-card preview
confirmation, and end-to-end image exchange require a signed Desktop build and
a real Weixin account, so they remain manual acceptance checks.
