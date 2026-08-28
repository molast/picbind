# @picbind/ui

Reusable PicBind React UI, Image Workspace, and realtime collaboration package.

```bash
pnpm install
pnpm build
```

The monorepo Web application imports source modules through `@picbind/ui/source`.
Published consumers can use the package root and generated stylesheet:

```tsx
import { WorkspacePage } from "@picbind/ui";
import "@picbind/ui/styles.css";
```

The monorepo Web application uses the `@picbind/ui/source` export so a clean Web build does not require committed SDK build artifacts. External consumers should use the package root and `styles.css` exports shown above.

Placeholder and thumbnail generation use the shared artifacts in
`packages/wasm/image-wasm`; consumers may still set `wasmBaseUrl` to load an
externally hosted build. Realtime transports are injected through the package's
`RealtimeProvider`; platform adapters remain owned by the application.
