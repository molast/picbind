import "./globals.css";
import type { Metadata } from "next";
import { getSiteUrl } from "@/server/site-config";

const siteUrl = getSiteUrl();
const siteName = "PicBind";
const title = "PicBind - 智能压缩 WebP、PNG、JPEG 和 AVIF 图片";
const description =
  "PicBind 提供在线图片智能压缩与格式转换服务，支持 PNG、JPEG、WebP、AVIF，支持批量压缩、质量对比和轻量交付。";

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
    locale: "zh_CN",
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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
