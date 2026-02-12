### 各类功能提炼

🟡 基础处理类

图片压缩（PNG/JPEG/WEBP/AVIF）

图片裁剪 / 旋转 / 缩放

格式转换

🟡 增强处理类

图片滤镜（亮度/对比度/饱和度）

颜色调整

模糊 / 锐化

水印加/去

🟡 AI类

背景自动去除

自动抠图

人像增强

AI 批量修图

🟡 高级编辑类

图层叠加

模板设计

文字/字体编辑

路径/矢量工具

🟡 组合型

PDF 转图片 / 图片转 PDF

动图处理（GIF/WebP）

抠图换背景

主题模板化图片设计

### 产品阶段规划
🟢 短期（0–3 个月）

核心目标：快速上线 MVP，验证需求

要做的功能
✔ 单图压缩（PNG/JPEG/WEBP）
✔ 图片格式转换（PNG ↔ JPEG ↔ WebP）
✔ 图片裁剪/缩放
✔ 批量导入/导出
✔ 简单滤镜（亮度/对比/对齐）

先做这些的目的:
✔ 高需求量、使用频次高
✔ 实现逻辑简单，适合 WASM
✔ 竞争对手成熟，但仍有优化空间（性能 + UI/UX）
输出产物
📌 可在线使用的图像处理站
📌 简洁 UI + 高性能处理
📌 一套核心 Rust → WASM 工具库

🔵 中期（3–9 个月）

核心目标：提升竞争力与留存

添加进阶功能：
✨ 图片批量处理（批量压缩、批量改名/格式转）
✨ 水印批量添加/去除
✨ 高级滤镜 + 色彩调整
✨ 下载历史 & 管理界面
✨ 支持临时存储（LocalStorage / IndexedDB / CDN cache）

技术升级
🔹 前端纯 WASM 图像管道（不用后端）
🔹 可以从浏览器直接调用 FS API 处理本地批量操作
🔹 UI 设计更完善

🟣 长期（9–18 个月）

核心目标：构建用户生态 + 利用 AI

🚀 AI 自动抠图
🚀 自动美化（人像增强 / 场景增强）
🚀 AI 模板设计
🚀 协同编辑
🚀 用户账户体系 & 云存储

架构升级
✔ 引入 Go 后端服务（存储/队列/AI 服务）
✔ 结合 SaaS 模式
✔ 支持企业版/团队协作

| 模式            | 描述                   | 预期效果      |
| --------------- | ----------------------- | ---------  |
| **基础免费 + 高级付费** | 免费使用核心功能                | 吸引流量，高转化率 |
| **订阅制（SaaS）**   | 高级功能放在订阅下               | 稳定收入      |
| **按量付费**        | 压缩/AGI 次数计费             | 适合企业用户    |
| **限速 + 去水印付费**  | 免费低速，付费高速下载/导出无水印       | 高转化       |
| **API 收费**      | 提供图片处理 API（WASM/Server） | 企业集成      |
| **广告 + 联盟流量**   | 轻量站点放广告                 | 短期收益      |


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