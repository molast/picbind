# PicBind Desktop Native 图片处理验证报告

本文档记录 `PICBIND_IMAGE_PROCESSING_API_V1.md` 阶段 5.9 的可重复验证方法和实测状态。
性能数字只代表对应机器和固定验证样本，不是跨设备 SLA。

## 1. 验证入口

```bash
pnpm --dir apps/web test:image-processing
cargo test -p picbind-image-native --offline
cargo test -p picbind-desktop --lib image_processing --offline
crates/picbind-image-native/scripts/validate-macos.sh
```

`validate-macos.sh` 默认验证当前 macOS host target；传入 `--all` 时检查并验证
`aarch64-apple-darwin` 和 `x86_64-apple-darwin` 两个 Rust target，缺少任意 target 都会明确
失败。各架构运行同一个 release 验证程序，并由 macOS `/usr/bin/time -l` 记录峰值 RSS。
脚本不会启动 PicBind 服务。

## 2. 契约覆盖

| 契约 | 自动验证位置 | 当前状态 |
| --- | --- | --- |
| API V1、二进制帧、原始字节非 Base64 | Desktop Adapter test、Tauri command test | 通过 |
| 进度按 requestId 过滤 | Desktop Adapter test | 通过 |
| AbortSignal 映射 Native cancel | Desktop Adapter test、Native in-flight cancellation test | 通过 |
| 稳定错误码 | Shared contract test、Desktop Adapter test | 通过 |
| 四格式 metadata 和 4×4 转换 | Native contract / matrix test | 通过 |
| 参数顺序和裁剪、旋转、resize 尺寸 | Native contract / parameter test | 通过 |
| Preview、Materialize、颜色与 Doodle | Native render / parameter test | 通过 |
| 默认 Alpha 保护和同格式不增大 | Native contract / format test | 通过 |
| placeholder 与 WebP thumbnail 独立 | Native contract / derived test | 通过 |
| 临时 token、幂等释放、失败恢复、启动/过期清理 | Desktop temporary store test | 通过 |
| Web Adapter 既有浏览器 codec 行为 | WASM 测试、TypeScript 检查、Next production build | 通过 |

Desktop Adapter 的测试通过注入式 `DesktopNativeBridge` 驱动生产 Adapter，不模拟另一套
Adapter。Native 像素语义由 `tests/adapter_contract.rs` 与已有格式矩阵共同验证。Web 的
Worker、Canvas 和浏览器 codec 不能在 Node 中伪造执行，因此仍由现有 WASM 测试和浏览器
production build 覆盖；后续若引入浏览器 E2E runner，应直接复用第 20 节不变量，不能用
Node 假实现冒充 Web codec 验证。

## 3. Apple Silicon 实测

验证日期：2026-08-26。

- 系统：macOS 26.2，Apple Silicon。
- Rust：1.98.0，`aarch64-apple-darwin`。
- 构建：release，LTO 配置使用仓库根 `Cargo.toml`。
- 输入：1600×1066 PNG，1,705,600 像素，3,768,484 bytes。
- 峰值 RSS：254,033,920 bytes，约 242.3 MiB。
- peak memory footprint：252,248,592 bytes，约 240.6 MiB。
- swap：0。

| 操作 | 耗时 |
| --- | ---: |
| JPEG encode | 181.6 ms |
| PNG encode | 1,581.3 ms |
| WebP encode | 287.0 ms |
| AVIF encode | 2,470.3 ms |
| bounded preview | 196.6 ms |
| full materialize | 219.8 ms |
| quality analysis | 545.1 ms |
| share assets | 118.1 ms |

WebP 质量复核结果：SSIM `0.9961`、MS-SSIM `0.9978`、PSNR `22.38 dB`、边缘保留率
`0.9645`。验证程序会检查所有输出可重新解码、格式正确且尺寸符合契约。

## 4. x86_64 后续验证

本机 Rosetta 可运行 x86_64 程序，但当前 Rust 1.98.0 工具链没有安装
`x86_64-apple-darwin` 标准库。2026-08-26 分别使用 rustup 默认源、项目 CI 的
`rsproxy.cn` 和系统 curl 下载，均长时间停留在 `downloading component rust-std`，没有安装
成功。因此 x86_64 当前不标记为已验证，作为后续兼容验证补充项处理，不阻塞阶段 5.9
完成。

下载恢复后执行：

```bash
rustup target add x86_64-apple-darwin
crates/picbind-image-native/scripts/validate-macos.sh --all
```

补测完成后，应把 x86_64 的系统、耗时、峰值内存和质量指标追加到本报告。`--all` 模式要求
两个 target 均已安装，避免未来补测时静默跳过任一架构。
