"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { getFaviconGeneratorCopy, getLang, type Lang } from "@/locales";
import {
  downloadFaviconZip,
  generateFaviconFromImage,
  getFaviconHtmlSnippet,
} from "@/utils/favicon";
import {
  type GoogleFontOption,
  ensureGoogleFontVariantLoaded,
  loadGoogleFontOptions,
} from "@/utils/google-font-catalog";

import {
  ALLOWED_TYPES,
  FALLBACK_FONT_OPTION,
  createPreviewDataUrl,
  renderTextFaviconBlob,
  resolveCssColor,
  type BgShape,
  type FontKey,
  type GeneratorMode,
} from "./favicon-tools";

export function useFaviconGenerator({
  initialMode = "text",
}: {
  initialMode?: GeneratorMode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [lang, setLang] = React.useState<Lang>("en");
  const [langReady, setLangReady] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  const [text, setText] = React.useState("F");
  const [fontColorInput, setFontColorInput] = React.useState("#FFFFFF");
  const [backgroundColorInput, setBackgroundColorInput] =
    React.useState("#209CEE");
  const [backgroundShape, setBackgroundShape] = React.useState<BgShape>("rounded");
  const [fontOptions, setFontOptions] = React.useState<GoogleFontOption[]>([]);
  const [fontKey, setFontKey] = React.useState<FontKey>("leckerli-one");
  const [fontVariantId, setFontVariantId] = React.useState("400-normal");
  const [fontSize, setFontSize] = React.useState(110);
  const [previewIcons, setPreviewIcons] = React.useState<string[]>([]);

  React.useEffect(() => {
    setLang(getLang());
    setLangReady(true);
  }, []);

  const mode: GeneratorMode =
    pathname === "/favicon-converter"
      ? "image"
      : pathname === "/favicon-generator"
        ? "text"
        : initialMode;

  const copy = React.useMemo(() => getFaviconGeneratorCopy(lang), [lang]);
  const pageTitle = React.useMemo(() => {
    if (mode === "text") {
      return lang === "zh"
        ? "PicBind - Favicon 生成器"
        : "PicBind - Favicon Generator";
    }
    return lang === "zh"
      ? "PicBind - Favicon 转换器"
      : "PicBind - Favicon Converter";
  }, [lang, mode]);
  const htmlSnippet = React.useMemo(() => getFaviconHtmlSnippet(), []);
  const isFontListReady = fontOptions.length > 0;
  const selectedFont =
    fontOptions.find((item) => item.key === fontKey) ??
    fontOptions[0] ??
    FALLBACK_FONT_OPTION;
  const selectedVariant =
    selectedFont.variants.find((item) => item.id === fontVariantId) ??
    selectedFont.variants[0] ??
    FALLBACK_FONT_OPTION.variants[0];
  const fontColor = React.useMemo(
    () => resolveCssColor(fontColorInput, "#FFFFFF"),
    [fontColorInput],
  );
  const backgroundColor = React.useMemo(
    () => resolveCssColor(backgroundColorInput, "#209CEE"),
    [backgroundColorInput],
  );

  const handleModeSwitch = React.useCallback(
    (nextMode: GeneratorMode) => {
      const targetPath =
        nextMode === "image" ? "/favicon-converter" : "/favicon-generator";
      if (pathname === targetPath) {
        return;
      }
      router.push(targetPath);
    },
    [pathname, router],
  );

  React.useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const preload = () => {
      router.prefetch("/favicon-converter");
      router.prefetch("/favicon-generator");
    };
    const idleApi = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleApi.requestIdleCallback === "function") {
      const handle = idleApi.requestIdleCallback(preload, { timeout: 1800 });
      return () => idleApi.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(preload, 250);
    return () => window.clearTimeout(timer);
  }, [router]);

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  React.useEffect(() => {
    if (mode !== "text") {
      return;
    }

    let canceled = false;
    (async () => {
      const options = await loadGoogleFontOptions();
      if (canceled) {
        return;
      }
      setFontOptions(options);
      const preferred = options.find((item) => item.key === "leckerli-one");
      if (preferred) {
        setFontKey(preferred.key);
        setFontVariantId(preferred.variants[0]?.id ?? "400-normal");
        return;
      }
      if (options[0]) {
        setFontKey(options[0].key);
        setFontVariantId(options[0].variants[0]?.id ?? "400-normal");
      }
    })();
    return () => {
      canceled = true;
    };
  }, [mode]);

  React.useEffect(() => {
    if (mode !== "text") {
      return;
    }
    if (!isFontListReady) {
      return;
    }
    let canceled = false;
    (async () => {
      await ensureGoogleFontVariantLoaded(selectedFont, selectedVariant);
      if (typeof document !== "undefined" && document.fonts) {
        const sampleSize = Math.max(32, fontSize);
        await document.fonts.load(
          `${selectedVariant.style} ${selectedVariant.weight} ${sampleSize}px "${selectedFont.family}"`,
        );
      }
      if (canceled) {
        return;
      }
      const next = [48, 32, 16].map((size) =>
        createPreviewDataUrl({
          text,
          fontFamily: selectedFont.family,
          fontColor,
          backgroundColor,
          backgroundShape,
          fontSize,
          fontWeight: selectedVariant.weight,
          fontStyle: selectedVariant.style,
          size,
        }),
      );
      if (!canceled) {
        setPreviewIcons(next.filter(Boolean));
      }
    })();
    return () => {
      canceled = true;
    };
  }, [
    mode,
    isFontListReady,
    text,
    selectedFont,
    fontColor,
    backgroundColor,
    backgroundShape,
    fontSize,
    selectedVariant,
  ]);

  React.useEffect(() => {
    if (!isFontListReady) {
      return;
    }
    if (!selectedFont.variants.some((item) => item.id === fontVariantId)) {
      setFontVariantId(selectedFont.variants[0]?.id ?? "400-normal");
    }
  }, [isFontListReady, selectedFont, fontVariantId]);

  React.useEffect(() => {
    if (!isFontListReady) {
      return;
    }
    // Preload selected font for faster first paint on mode switch/download.
    void ensureGoogleFontVariantLoaded(selectedFont, selectedVariant);
  }, [isFontListReady, selectedFont, selectedVariant]);

  const onFileSelected = React.useCallback((file: File | null) => {
    if (!file) {
      return;
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      setError(copy.errors.unsupportedType);
      return;
    }

    setError(null);
    setSelectedFile(file);
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return URL.createObjectURL(file);
    });
  }, [copy.errors.unsupportedType]);

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onFileSelected(event.dataTransfer.files?.[0] ?? null);
  };

  const onDownload = async () => {
    if (isGenerating) {
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);

      if (mode === "image") {
        if (!selectedFile) {
          setError(copy.errors.uploadFirst);
          return;
        }
        const files = await generateFaviconFromImage(selectedFile);
        await downloadFaviconZip(files);
        return;
      }

      if (typeof document !== "undefined" && document.fonts) {
        await ensureGoogleFontVariantLoaded(selectedFont, selectedVariant);
        await document.fonts.load(
          `${selectedVariant.style} ${selectedVariant.weight} ${fontSize}px "${selectedFont.family}"`,
        );
      }

      const textBlob = await renderTextFaviconBlob({
        text,
        fontFamily: selectedFont.family,
        fontColor,
        backgroundColor,
        backgroundShape,
        fontSize,
        fontWeight: selectedVariant.weight,
        fontStyle: selectedVariant.style,
      });

      const textFile = new File([textBlob], "text-favicon.png", {
        type: "image/png",
      });
      const files = await generateFaviconFromImage(textFile);
      await downloadFaviconZip(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.generationFailed);
    } finally {
      setIsGenerating(false);
    }
  };

  const onCopyHtml = async () => {
    try {
      await navigator.clipboard.writeText(htmlSnippet);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.errors.copyFailed);
    }
  };

  return {
    mode,
    lang,
    langReady,
    copy,
    pageTitle,
    inputRef,
    isDragging,
    setIsDragging,
    isGenerating,
    error,
    selectedFile,
    previewUrl,
    text,
    setText,
    fontColorInput,
    setFontColorInput,
    backgroundColorInput,
    setBackgroundColorInput,
    backgroundShape,
    setBackgroundShape,
    fontOptions,
    fontKey,
    setFontKey,
    fontVariantId,
    setFontVariantId,
    fontSize,
    setFontSize,
    previewIcons,
    htmlSnippet,
    isFontListReady,
    selectedFont,
    selectedVariant,
    fontColor,
    backgroundColor,
    handleModeSwitch,
    onFileSelected,
    onDrop,
    onDownload,
    onCopyHtml,
  };
}
