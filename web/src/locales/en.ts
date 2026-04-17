import type {
  FaviconGeneratorCopy,
  HomeCompressLandingCopy,
  LocaleType,
} from "./zh";

const en: LocaleType = {
  Symbol: "en",
  HomeCompressLanding: {
    pageTitle: "PicBind-Compress WebP,PNG and JPEG images intelligently",
    heroKicker: "Smart Image Compression",
    heroTitle: "Upload once, compress PNG, JPEG, WebP and AVIF automatically",
    heroDesc:
      "Upload, optimize, and download in one focused homepage flow with fewer steps and faster delivery.",
    dropTitle: "Drop your images here!",
    dropDesc: "Up to 20 images, max 5 MB each.",
    faviconEntry: "Favicon",
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
    errorOverlay: {
      failed: "Failed",
      seeWhy: "See why",
      lineTransparency: "Your original image contains transparency.",
      lineTransparencyDetail: "We can convert it anyway, but the transparent background will be replaced by white.",
      lineGeneric: "JPEG conversion failed for this image.",
      convertAnyway: "Convert anyway",
    },
    metricsOverlay: {
      title: "Compression Quality",
      qualityScore: "Quality score",
      ssim: "SSIM",
      msSsim: "MS-SSIM",
      edgeRetention: "Edge retention",
      blurLoss: "Blur loss",
      loading: "Analyzing...",
    },
  } as HomeCompressLandingCopy,
  FaviconGenerator: {
    navConverter: "Converter",
    navGenerator: "Generator",
    heroTitleText: "Favicon Generator / Generate from Text",
    heroTitleImage: "Favicon Converter / Generate from Image",
    heroDescText:
      "Quickly generate your favicon from text by selecting the text, fonts, and colors. Download your favicon in the most up to date formats.",
    heroDescImage:
      "Quickly generate your favicon from an image by uploading your image below. Download your favicon in the most up to date formats.",
    breadcrumbHome: "Home",
    breadcrumbText: "Text Generator",
    breadcrumbImage: "Image Generator",
    previewLabel: "Preview",
    downloadButton: "Download",
    generatingButton: "Generating...",
    textSectionTitle: "Generate From Text",
    imageSectionTitle: "Converter",
    labels: {
      text: "Text",
      background: "Background",
      square: "Square",
      circle: "Circle",
      rounded: "Rounded",
      fontFamilyPrefix: "Font Family (",
      viewGoogleFonts: "view all on Google Fonts",
      fontVariant: "Font Variant",
      fontSize: "Font Size",
      fontColor: "Font Color",
      backgroundColor: "Background Color",
    },
    converterDropHint: "Drag and drop your file here or click here to upload.",
    installation: {
      title: "Installation",
      step1:
        "First, use the download button to download the files listed below. Place the files in the root directory of your website.",
      step2Prefix: "Next, copy the following link tags and paste them into the ",
      step2Head: "head",
      step2Suffix: " of your HTML.",
      copy: "Copy",
    },
    article: {
      title: "Why favicon.io?",
      p1: "Whether you want to generate a favicon from text, from an existing image, or from an emoji we've got you covered. The favicon generator is completely free and extremely easy to use. The generated favicon will work for all browsers and multiple platforms.",
      h2: "Getting started with the favicon generator",
      p2: "The tool above will allow you to generate a favicon from text. Start by choosing one to two letters for the favicon generator. Since the favicon generator outputs very small images it's important to use few characters for maximum legibility.",
      h3: "Making the background simple",
      p3: "Next, select the shape of the background. There are three simple shapes available: square, circle, and rounded. These are the most common shapes used to generate a favicon.",
      h4: "Selecting the font for your favicon",
      p4: "The favicon generator uses Google Fonts with many fonts available. This is useful to match the font used on your own website. You can edit the font size once you've selected your font.",
      h5: "Tailoring the colors",
      p5: "The last step is to select the colors. If you have the HEX values of the colors you want, you can enter them directly into the input boxes. You can also use the color picker palettes below each input box.",
    },
    errors: {
      unsupportedType: "Only PNG, JPG, JPEG, BMP and WebP are supported",
      uploadFirst: "Please upload an image first.",
      generationFailed: "Favicon generation failed",
      copyFailed: "Copy failed",
    },
  } as FaviconGeneratorCopy,
};

export default en;
