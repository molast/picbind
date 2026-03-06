import type { HomeCompressLandingCopy, LocaleType } from "./zh";

const en: LocaleType = {
  Symbol: "en",
  HomeCompressLanding: {
    pageTitle: "Image Compression",
    heroKicker: "Smart Image Compression",
    heroTitle: "Upload once, compress PNG, JPEG, WebP and AVIF automatically",
    heroDesc:
      "Start compressing like TinyPNG: upload, optimize and download from one focused homepage without extra steps.",
    dropTitle: "Drop your images here!",
    dropDesc: "Up to 20 images, max 5 MB each.",
    autoLabel: "Convert my images automatically",
    selectAll: "SELECT ALL",
    processingTitle:
      "Your images are being processed now. Give us a moment to finish a cleaner, lighter result set.",
    completedTitle: (savedPercent: number, done: number, totalSaved: string) =>
      `Compression finished. Saved ${savedPercent}% across ${done} image${done === 1 ? "" : "s"} with ${totalSaved} reduced in total.`,
    optimizing: "Optimizing...",
    queued: "Queued",
    transparencyBlocked: "The source image contains transparency, so JPEG output is blocked.",
    unsupportedFormat: "This format is not supported yet",
    downloadZip: "Download ZIP",
    cards: [
      {
        title: "Lighter page assets",
        desc: "Compress common web images to reduce initial load pressure and bandwidth usage.",
      },
      {
        title: "Smarter output selection",
        desc: "Choose a more suitable output format per image across PNG, JPEG, WebP and AVIF.",
      },
      {
        title: "Ready for batch asset cleanup",
        desc: "Keep both single-file download and ZIP export for grouped delivery after bulk compression.",
      },
    ],
  } as HomeCompressLandingCopy,
};

export default en;
