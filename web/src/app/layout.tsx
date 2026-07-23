import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";
import { getSiteUrl } from "@/server/site-config";

const siteUrl = getSiteUrl();
const siteName = "PicBind";
const title = "PicBind - Smart image compression for WebP, PNG, JPEG and AVIF";
const description =
  "PicBind provides online image compression and conversion for PNG, JPEG, WebP, and AVIF with batch processing and quality comparison.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: `%s | ${siteName}`,
  },
  description,
  applicationName: siteName,
  keywords: [
    "图片压缩",
    "在线图片压缩",
    "智能图片压缩",
    "无损图片压缩",
    "WebP 压缩",
    "PNG 压缩",
    "JPEG 压缩",
    "AVIF 压缩",
    "图片格式转换",
    "image compressor",
    "compress images online",
    "png compressor",
    "jpeg compressor",
    "webp compressor",
    "avif compressor",
    "png to jpg",
    "webp converter",
    "avif converter",
    "PicBind",
  ],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/images/favicon/favicon.ico", type: "image/x-icon" },
      {
        url: "/images/favicon/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/images/favicon/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/images/favicon/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: [{ url: "/images/favicon/favicon.ico", type: "image/x-icon" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName,
    title,
    description,
    locale: "en_US",
    images: [
      {
        url: "/images/compare-original.png",
        width: 1365,
        height: 768,
        alt: "PicBind image compression preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/images/compare-original.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "technology",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="lang-title-bootstrap" strategy="beforeInteractive">
          {`(() => {
  try {
    const key = "ai-translator-lang-v2";
    const match = document.cookie.match(/(?:^|; )picbind-lang=([^;]+)/);
    const cookieLang = match ? decodeURIComponent(match[1]) : "";
    const localLang = localStorage.getItem(key) || "";
    const lang = (localLang === "zh" || localLang === "en")
      ? localLang
      : ((cookieLang === "zh" || cookieLang === "en") ? cookieLang : "en");
    const path = window.location.pathname;
    const titles = {
      "/": {
        en: "PicBind - Smart image compression for WebP, PNG, JPEG and AVIF",
        zh: "PicBind - 智能压缩 WebP、PNG、JPEG 和 AVIF 图片"
      },
      "/favicon-converter": {
        en: "PicBind - Favicon Converter",
        zh: "PicBind - Favicon 转换器"
      },
      "/favicon-generator": {
        en: "PicBind - Favicon Generator",
        zh: "PicBind - Favicon 生成器"
      },
      "/admin": {
        en: "PicBind Admin",
        zh: "PicBind 管理中心"
      }
    };

    if (titles[path] && titles[path][lang]) {
      document.title = titles[path][lang];
    }

    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  } catch (_) {
    // no-op
  }
})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
