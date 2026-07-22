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
    uploadNotice: {
      tooManyFiles: "You can process up to 20 images at a time.",
      unsupportedFiles: "Some files were skipped. Only PNG, JPEG, and WebP are supported right now.",
      fileTooLargeTitle: "File is too large (max 5 MB)",
      fileTooLargeDescription: "This image exceeds the current compression limit.",
    },
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
    faq: {
      kicker: "FAQ",
      title: "A few practical questions about image compression",
      categories: [
        {
          id: "general",
          label: "General",
          items: [
            {
              question: "Why should I compress images for my website?",
              answer: [
                "Smaller image files usually mean faster page loads, lower bandwidth usage, and a smoother experience for visitors across desktop and mobile devices.",
                "Image optimization can also support SEO and conversion performance because lighter pages are easier to load and keep responsive under real traffic.",
              ],
            },
            {
              question: "What does PicBind do?",
              answer: [
                "PicBind is a browser-first image tool focused on compression, format conversion, batch export, and favicon generation.",
                "The goal is to keep the workflow simple: upload, optimize, compare, and download from one place without adding unnecessary server-side processing steps.",
              ],
            },
            {
              question: "Is the privacy of my images protected?",
              answer: [
                "Most core processing is handled directly in your browser, including compression, conversion, and favicon generation, so your image files are generally not sent to a backend for the main processing flow.",
                "If metrics are enabled later, they are intended for product usage counts and page analytics rather than for processing your image content on a server.",
              ],
            },
          ],
        },
        {
          id: "how-it-works",
          label: "How does it work",
          items: [
            {
              question: "How does PicBind compress images?",
              answer: [
                "After you upload a file, the page uses a Rust WASM module running in the browser to perform encoding, recompression, and format conversion.",
                "That keeps most work local to the current device and avoids waiting on a remote image queue for normal use.",
              ],
            },
            {
              question: "Why do I sometimes get a different output format?",
              answer: [
                "PicBind works with PNG, JPEG, WebP, and AVIF, and different images behave differently depending on transparency, detail, and texture.",
                "You can choose formats manually, or use the current flow to produce a more suitable delivery format when size and quality need a better balance.",
              ],
            },
            {
              question: "Why can't transparent images be converted directly to JPEG?",
              answer: [
                "JPEG does not support transparency, so transparent areas from PNG or WebP images cannot be preserved in a JPEG output.",
                "If you still choose JPEG, the transparent background must be replaced with a solid color, and the UI warns about that tradeoff.",
              ],
            },
          ],
        },
        {
          id: "web-compressor",
          label: "Web compressor",
          items: [
            {
              question: "Which image formats are supported right now?",
              answer: [
                "The homepage compressor currently accepts PNG, JPEG, and WebP uploads, and can output PNG, JPEG, WebP, and AVIF.",
                "The favicon tools also support PNG, JPG, JPEG, BMP, and WebP as input sources.",
              ],
            },
            {
              question: "Can I compress multiple images at once?",
              answer: [
                "Yes. The homepage supports batch processing for up to 20 images at a time, and you can download each result separately or export everything as a ZIP file.",
                "That makes it useful for cleaning up grouped web assets, article images, or content batches in one run.",
              ],
            },
            {
              question: "How can I tell whether the output quality is still acceptable?",
              answer: [
                "The homepage shows saved size and output size, and the project also includes quality-analysis hooks such as SSIM, MS-SSIM, edge retention, and blur loss for deeper evaluation.",
                "In practice, the right balance depends on the final use case, since marketing images, thumbnails, and design source assets do not all tolerate compression the same way.",
              ],
            },
            {
              question: "Why do some images only shrink a little?",
              answer: [
                "Some files have already been optimized elsewhere, so there is simply less redundant data left to remove.",
                "Images with transparency, fine text, repeated edges, or dense texture can also limit aggressive compression because the tool still needs to protect visual clarity.",
              ],
            },
          ],
        },
      ],
    },
    footer: {
      brandTitle: "PicBind",
      brandDesc:
        "A browser-first image compressor and favicon toolkit for cleaner, lighter web assets.",
      groups: [
        {
          title: "Tools",
          links: [
            { label: "Image Compress", href: "/" },
            { label: "Favicon Converter", href: "/favicon-converter" },
            { label: "Favicon Generator", href: "/favicon-generator" },
          ],
        },
        {
          title: "Resources",
          links: [
            { label: "FAQ", href: "#faq" },
            { label: "Sitemap", href: "/sitemap.xml" },
          ],
        },
        {
          title: "Support",
          links: [{ label: "Contact support", href: "mailto:loomchen@gmail.com" }],
        },
      ],
      contactSupport: "Contact support",
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
      title: "Why picbind.com?",
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
