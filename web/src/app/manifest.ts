import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NanoImg",
    short_name: "NanoImg",
    description:
      "Compress WebP, PNG, JPEG and AVIF images online with intelligent format handling.",
    start_url: "/",
    display: "standalone",
    background_color: "#f1f1f1",
    theme_color: "#0ea5e9",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
