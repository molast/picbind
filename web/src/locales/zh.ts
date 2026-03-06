export type HomeCompressLandingCopy = {
  pageTitle: string;
  heroKicker: string;
  heroTitle: string;
  heroDesc: string;
  dropTitle: string;
  dropDesc: string;
  autoLabel: string;
  selectAll: string;
  processingTitle: string;
  completedTitle: (savedPercent: number, done: number, totalSaved: string) => string;
  optimizing: string;
  queued: string;
  transparencyBlocked: string;
  unsupportedFormat: string;
  downloadZip: string;
  cards: Array<{ title: string; desc: string }>;
  errorOverlay: {
    failed: string;
    seeWhy: string;
    lineTransparency: string;
    lineTransparencyDetail: string;
    lineGeneric: string;
    convertAnyway: string;
  };
};

const zh = {
  Symbol: "zh",
  HomeCompressLanding: {
    pageTitle: "NanoImg-智能压缩 WebP、PNG 和 JPEG 图像",
    heroKicker: "智能图片压缩",
    heroTitle: "一次上传，自动压缩 PNG、JPEG、WebP 和 AVIF",
    heroDesc: "像 TinyPNG 一样直接开始处理图片，首页完成上传、压缩、下载，尽量减少跳转和流失。",
    dropTitle: "将图片拖到这里开始压缩",
    dropDesc: "最多 20 张图片，单张不超过 5 MB",
    autoLabel: "上传后自动开始压缩",
    selectAll: "全选",
    processingTitle: "图片正在优化中，请稍等片刻，我们会尽快给出这一批图片更合适的压缩结果。",
    completedTitle: (savedPercent: number, done: number, totalSaved: string) =>
      `这次压缩共节省 ${savedPercent}% · 已优化 ${done} 张图片 · 共减少 ${totalSaved}`,
    optimizing: "压缩中...",
    queued: "排队中",
    transparencyBlocked: "原图包含透明图层，不能直接转换为 JPEG",
    unsupportedFormat: "当前格式暂不支持",
    downloadZip: "打包下载 ZIP",
    cards: [
      {
        title: "更轻的页面资源",
        desc: "优先压缩常见网页图片，减少首屏加载压力和带宽消耗。",
      },
      {
        title: "自动挑选更优结果",
        desc: "按图片内容尝试更合适的输出格式，支持 PNG、JPEG、WebP 和 AVIF。",
      },
      {
        title: "适合批量整理素材",
        desc: "单张下载和 ZIP 打包都保留，适合一次处理多张图片后集中交付。",
      },
    ],
    errorOverlay: {
      failed: "失败",
      seeWhy: "查看原因",
      lineTransparency: "原图包含透明图层。",
      lineTransparencyDetail: "你仍可继续转换，但透明背景会替换为白色。",
      lineGeneric: "这张图转换为 JPEG 失败。",
      convertAnyway: "仍然转换",
    },
  } as HomeCompressLandingCopy,
};

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export type LocaleType = typeof zh;
export type PartialLocaleType = DeepPartial<typeof zh>;

export default zh;
