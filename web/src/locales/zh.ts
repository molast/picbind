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
  uploadNotice: {
    tooManyFiles: string;
    unsupportedFiles: string;
    fileTooLarge: string;
  };
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
  faq: {
    kicker: string;
    title: string;
    categories: Array<{
      id: string;
      label: string;
      items: Array<{
        question: string;
        answer: string[];
      }>;
    }>;
  };
  footer: {
    brandTitle: string;
    brandDesc: string;
    groups: Array<{
      title: string;
      links: Array<{
        label: string;
        href: string;
      }>;
    }>;
    contactSupport: string;
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
    dropDesc: "最多 20 张图片，单张不超过 10 MB",
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
    uploadNotice: {
      tooManyFiles: "最多只能同时处理 20 张图片。",
      unsupportedFiles: "部分文件已跳过，目前仅支持 PNG、JPEG 和 WebP。",
      fileTooLarge: "部分文件已跳过，单张图片不能超过 10 MB。",
    },
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
    faq: {
      kicker: "常见问题",
      title: "关于图片压缩，你可能还想知道这些",
      categories: [
        {
          id: "general",
          label: "通用问题",
          items: [
            {
              question: "为什么要为网站压缩图片？",
              answer: [
                "压缩图片最直接的价值，是让网页资源更轻，页面打开更快，尤其适合首屏图片较多、移动网络访问较多的场景。",
                "更小的图片体积通常也意味着更低的带宽消耗和更稳定的加载体验，对 SEO、转化率和整体可用性都有帮助。",
              ],
            },
            {
              question: "PicBind 主要做什么？",
              answer: [
                "PicBind 是一个浏览器端图片工具，当前重点提供图片压缩、多格式转换、批量下载以及 favicon 生成。",
                "它尽量把处理放在本地浏览器里完成，减少等待时间，也降低把图片上传到服务端处理的依赖。",
              ],
            },
            {
              question: "图片隐私是否有保障？",
              answer: [
                "大多数核心处理流程都在浏览器本地完成，包括压缩、格式转换和 favicon 生成，因此你的原始图片通常不会被上传到服务端做主处理。",
                "如果后续开启了统计接口，统计只用于产品计数和页面访问分析，不会把你的图片内容作为后台处理输入。",
              ],
            },
          ],
        },
        {
          id: "how-it-works",
          label: "工作原理",
          items: [
            {
              question: "PicBind 是怎么压缩图片的？",
              answer: [
                "上传图片后，页面会调用浏览器中的 Rust WASM 模块来执行编码、重压缩和格式转换逻辑，再把结果直接返回给当前页面下载。",
                "这意味着你不需要等待服务器排队处理，大部分操作都发生在本机浏览器环境中。",
              ],
            },
            {
              question: "为什么有时会输出不同格式？",
              answer: [
                "PicBind 支持 PNG、JPEG、WebP 和 AVIF，不同图片内容在不同格式下的体积和质量表现并不相同。",
                "你可以手动选择格式，也可以让工具根据当前流程输出更适合交付的结果，用更少的体积换取尽量稳定的视觉效果。",
              ],
            },
            {
              question: "为什么透明图片不能直接转成 JPEG？",
              answer: [
                "JPEG 本身不支持透明通道，所以带透明背景的 PNG、WebP 等图片不能无损地直接保留透明效果输出为 JPEG。",
                "当你坚持转换为 JPEG 时，透明区域需要被替换成实色背景，目前页面会明确提示这个限制。",
              ],
            },
          ],
        },
        {
          id: "web-compressor",
          label: "网页压缩",
          items: [
            {
              question: "当前支持哪些图片格式？",
              answer: [
                "首页压缩流程当前支持上传 PNG、JPEG 和 WebP，并可输出 PNG、JPEG、WebP 与 AVIF。",
                "favicon 工具另外支持 PNG、JPG、JPEG、BMP 和 WebP 作为输入来源。",
              ],
            },
            {
              question: "支持批量处理吗？",
              answer: [
                "支持。首页一次最多可以处理 20 张图片，压缩完成后既可以逐张下载，也可以直接打包成 ZIP 下载。",
                "这对整理一批网页素材、文章配图或运营资源会更方便。",
              ],
            },
            {
              question: "压缩后如何判断质量是否还能接受？",
              answer: [
                "首页会展示压缩比例和结果体积，在开发调试流程里还预留了质量分析指标，例如 SSIM、MS-SSIM、边缘保留和模糊损失。",
                "实际使用时，建议结合预览和最终用途一起判断，网页展示图和高精度设计素材对压缩容忍度并不相同。",
              ],
            },
            {
              question: "为什么有些图片压缩幅度不大？",
              answer: [
                "如果原图本身已经比较干净，或者已经被其他工具优化过，那么继续压缩的空间就会比较有限。",
                "另外，像纯色块、透明边缘、细小文字和高频纹理较多的图片，也会限制激进压缩的幅度，因为工具需要在体积和清晰度之间做平衡。",
              ],
            },
          ],
        },
      ],
    },
    footer: {
      brandTitle: "PicBind",
      brandDesc:
        "更轻、更快、更适合网页交付的图片压缩与 favicon 工具。",
      groups: [
        {
          title: "工具",
          links: [
            { label: "图片压缩", href: "/" },
            { label: "Favicon 转换器", href: "/favicon-converter" },
            { label: "Favicon 生成器", href: "/favicon-generator" },
          ],
        },
        {
          title: "资源",
          links: [
            { label: "常见问题", href: "#faq" },
            { label: "站点地图", href: "/sitemap.xml" },
          ],
        },
        {
          title: "支持",
          links: [{ label: "联系支持", href: "mailto:loomchen@gmail.com" }],
        },
      ],
      contactSupport: "联系支持",
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
