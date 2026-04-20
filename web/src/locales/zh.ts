export type HomeCompressLandingCopy = {
  pageTitle: string;
  heroKicker: string;
  heroTitle: string;
  heroDesc: string;
  dropTitle: string;
  dropDesc: string;
  faviconEntry: string;
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
  metricsOverlay: {
    title: string;
    qualityScore: string;
    ssim: string;
    msSsim: string;
    edgeRetention: string;
    blurLoss: string;
    loading: string;
  };
};

export type FaviconGeneratorCopy = {
  navConverter: string;
  navGenerator: string;
  heroTitleText: string;
  heroTitleImage: string;
  heroDescText: string;
  heroDescImage: string;
  breadcrumbHome: string;
  breadcrumbText: string;
  breadcrumbImage: string;
  previewLabel: string;
  downloadButton: string;
  generatingButton: string;
  textSectionTitle: string;
  imageSectionTitle: string;
  labels: {
    text: string;
    background: string;
    square: string;
    circle: string;
    rounded: string;
    fontFamilyPrefix: string;
    viewGoogleFonts: string;
    fontVariant: string;
    fontSize: string;
    fontColor: string;
    backgroundColor: string;
  };
  converterDropHint: string;
  installation: {
    title: string;
    step1: string;
    step2Prefix: string;
    step2Head: string;
    step2Suffix: string;
    copy: string;
  };
  article: {
    title: string;
    p1: string;
    h2: string;
    p2: string;
    h3: string;
    p3: string;
    h4: string;
    p4: string;
    h5: string;
    p5: string;
  };
  errors: {
    unsupportedType: string;
    uploadFirst: string;
    generationFailed: string;
    copyFailed: string;
  };
};

const zh = {
  Symbol: "zh",
  HomeCompressLanding: {
    pageTitle: "PicBind-智能压缩 WebP、PNG 和 JPEG 图像",
    heroKicker: "智能图片压缩",
    heroTitle: "一次上传，自动压缩 PNG、JPEG、WebP 和 AVIF",
    heroDesc: "打开首页即可开始处理图片，在同一页面完成上传、压缩和下载，减少操作路径，让交付更高效。",
    dropTitle: "将图片拖到这里开始压缩",
    dropDesc: "最多 20 张图片，单张不超过 5 MB",
    faviconEntry: "Favicon",
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
    metricsOverlay: {
      title: "压缩质量对比",
      qualityScore: "综合质量",
      ssim: "结构相似度",
      msSsim: "多尺度 SSIM",
      edgeRetention: "边缘保留",
      blurLoss: "模糊损失",
      loading: "分析中...",
    },
  } as HomeCompressLandingCopy,
  FaviconGenerator: {
    navConverter: "转换器",
    navGenerator: "生成器",
    heroTitleText: "Favicon 生成器 / 通过文字生成",
    heroTitleImage: "Favicon 转换器 / 通过图片生成",
    heroDescText:
      "通过设置文字、字体和颜色，快速生成 favicon，并下载最新格式的图标包。",
    heroDescImage:
      "上传一张图片即可快速生成 favicon，并下载包含常用格式的图标包。",
    breadcrumbHome: "首页",
    breadcrumbText: "文字生成",
    breadcrumbImage: "图片生成",
    previewLabel: "预览",
    downloadButton: "下载",
    generatingButton: "生成中...",
    textSectionTitle: "通过文字生成",
    imageSectionTitle: "转换器",
    labels: {
      text: "文字",
      background: "背景形状",
      square: "方形",
      circle: "圆形",
      rounded: "圆角",
      fontFamilyPrefix: "字体（",
      viewGoogleFonts: "在 Google Fonts 查看全部",
      fontVariant: "字重样式",
      fontSize: "字体大小",
      fontColor: "字体颜色",
      backgroundColor: "背景颜色",
    },
    converterDropHint: "拖放文件到这里，或点击此处上传。",
    installation: {
      title: "安装说明",
      step1: "先点击下载按钮获取下列文件，并放到你网站根目录。",
      step2Prefix: "然后复制以下链接标签，粘贴到 HTML 的 ",
      step2Head: "head",
      step2Suffix: " 中。",
      copy: "复制",
    },
    article: {
      title: "为什么选择 picbind.com？",
      p1: "无论你是想从文字、已有图片或 emoji 生成 favicon，这个工具都能覆盖。它免费且易用，输出图标可兼容主流浏览器与平台。",
      h2: "如何开始生成",
      p2: "从文字生成时，建议输入 1-2 个字符。由于 favicon 尺寸很小，字符越少通常可读性越好。",
      h3: "保持背景简单",
      p3: "你可以选择三种常见背景形状：方形、圆形、圆角。这些形状在不同浏览器标签中都有较好的识别度。",
      h4: "选择合适字体",
      p4: "页面支持 Google Fonts。选择与你网站品牌一致的字体，并根据视觉效果调整字号。",
      h5: "调整颜色",
      p5: "最后配置字体色和背景色。你可以直接输入 HEX，也可以使用下方色板进行选择。",
    },
    errors: {
      unsupportedType: "仅支持 PNG、JPG、JPEG、BMP、WebP 格式",
      uploadFirst: "请先上传一张图片。",
      generationFailed: "favicon 生成失败",
      copyFailed: "复制失败",
    },
  } as FaviconGeneratorCopy,
};

type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;

export type LocaleType = typeof zh;
export type PartialLocaleType = DeepPartial<typeof zh>;

export default zh;
