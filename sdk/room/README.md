# @picbind/room

PicBind Room is a reusable React SDK. It can be imported by the main Web app or deployed as the standalone Vite preview in `index.html`.

```bash
pnpm install
pnpm dev
pnpm build
```

Consumers import the component and its generated Tailwind stylesheet:

```tsx
import { ShareRoomPage } from "@picbind/room";
import "@picbind/room/styles.css";
```

The monorepo Web application uses the `@picbind/room/source` export so a clean Web build does not require committed SDK build artifacts. External consumers should use the package root and `styles.css` exports shown above.

The browser always connects to the online realtime Worker at `https://api.picbind.com`. Placeholder and thumbnail generation use the shared artifacts in `sdk/wasm/image-wasm`; consumers may still set `wasmBaseUrl` to load an externally hosted build.

During `pnpm dev`, the preview directly requests the online Worker at `https://api.picbind.com`. Both local and deployed Room pages always use that online Worker; Room never connects to the local Worker runtime. The Worker must allow the local preview origin in `ALLOWED_ORIGINS`. Set `VITE_ROOM_API_URL` only when the preview should use a different Worker URL.

Set `VITE_ROOM_APP_URL` and the Worker's optional `ROOM_URL` to the standalone Room entry URL when generated invite links should point to that deployment. Also allow its origin in R2 CORS. Without `ROOM_URL`, the Worker keeps generating the existing `${SITE_URL}/share` links.
