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

The browser connects to the existing realtime Worker. Set `VITE_API_BASE_URL` for the standalone preview. Host `/wasm/image_wasm.js` and `/wasm/image_wasm_bg.wasm` with the application so placeholders and thumbnails can be generated.

Set `VITE_ROOM_APP_URL` and the Worker's optional `ROOM_URL` to the standalone Room entry URL when generated invite links should point to that deployment. Also allow its origin in R2 CORS. Without `ROOM_URL`, the Worker keeps generating the existing `${SITE_URL}/share` links.
