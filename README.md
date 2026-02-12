### WASM 环境

- 创建wasm lib
cargo new image_wasm --lib

- wasm-pack 命令安装
- wasm-opt

> 下载：https://github.com/WebAssembly/binaryen/releases/download/version_117/binaryen-version_117-x86_64-windows.tar.gz
>
-- 打包
> wasm-pack build --target web --out-dir ../../web/public/wasm

-- 使用

```ts
// 定义wasm 的入口
"use client";

let cached: any = null;

export async function initWasm() {
    if (!cached) {
        try {
            const mod = await import("@wasm/image_wasm");

            const wasmBinary = await fetch("/wasm/image_wasm_bg.wasm").then(r => r.arrayBuffer());
            cached = await mod.default({wasmBinary});
        } catch (err) {
            console.error("WASM load failed:", err);
        }
    }
    return cached;
}
```

```ts
// 使用处
const [wasm, setWasm] = useState<any>(null);
const [loading, setLoading] = useState(false);

useEffect(() => {
    initWasm().then(setWasm);
}, []);

if (!wasm) return;

setLoading(true);

const resp = wasm.xxxxxxx(aaa, bbb);    // wasm方法调用

setLoading(false);
```