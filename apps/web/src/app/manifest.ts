import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PicBind Web",
    short_name: "PicBind Web",
    description:
      "Compress WebP, PNG, JPEG and AVIF images online with intelligent format handling.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f1f1",
    theme_color: "#0ea5e9",
    icons: [
      { src: "/images/favicon/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/images/favicon/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
      { src: "/images/favicon/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/images/favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { src: "/images/favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { src: "/images/favicon/favicon.ico", sizes: "32x32", type: "image/x-icon" },
    ],
  };
}
