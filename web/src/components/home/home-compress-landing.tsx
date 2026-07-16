"use client";

import HomeFooter from "./home-footer";
import HomeHero from "./home-hero";
import HomeInfoSection from "./home-info-section";
import HomeResults from "./home-results";
import { useHomeCompression } from "./use-home-compression";
import type { Lang } from "@/locales";

type HomeCompressLandingProps = {
  initialLang: Lang;
};

export default function HomeCompressLanding({
  initialLang,
}: HomeCompressLandingProps) {
  const home = useHomeCompression({ initialLang });

  if (!home.langReady) {
    return <main className="min-h-screen w-full bg-[#ececec]" />;
  }

  return (
    <main className="w-full bg-[#ececec] text-slate-800">
      <HomeHero
        copy={home.copy}
        lang={home.lang}
        langMenuRef={home.langMenuRef}
        inputRef={home.inputRef}
        isLangMenuOpen={home.isLangMenuOpen}
        isDragging={home.isDragging}
        uploadNotice={home.uploadNotice}
        showFormatOptions={home.showFormatOptions}
        selectedFormats={home.selectedFormats}
        formatOptions={home.formatOptions}
        onLangMenuChange={home.setIsLangMenuOpen}
        onSwitchLang={home.handleSwitchLang}
        onDraggingChange={home.setIsDragging}
        onDrop={home.handleDrop}
        onFormatOptionsChange={home.setShowFormatOptions}
        onToggleFormat={home.handleToggleFormat}
        onSelectAllFormats={home.handleSelectAllFormats}
      />

      <input
        ref={home.inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          home.enqueueFiles(event.target.files ?? []);
          event.target.value = "";
        }}
      />

      <HomeResults
        copy={home.copy}
        items={home.sortedItems}
        hasPendingItems={home.hasPendingItems}
        totalSavedPercent={home.totalSavedPercent}
        completedCount={home.completedCount}
        totalSavedBytes={home.totalSavedBytes}
        canDownloadZip={home.zipItems.length > 0}
        whyVariantId={home.whyVariantId}
        metricsVariantId={home.metricsVariantId}
        onDownloadZip={home.handleDownloadZip}
        onWhyVariantChange={home.setWhyVariantId}
        onMetricsVariantChange={home.setMetricsVariantId}
        onLoadVariantMetrics={home.loadVariantMetrics}
        onConvertAnyway={home.handleConvertAnyway}
      />

      <HomeInfoSection
        copy={home.copy}
        lang={home.lang}
        compareCopy={home.compareCopy}
        showCompareSection={home.homeShowCompareSection}
        compareSectionReady={home.compareSectionReady}
        compareCompressedSrc={home.compareCompressedSrc}
        compareSizes={home.compareSizes}
        showCompressedCount={home.homeShowCompressedCount}
        displayedCompressedCount={home.displayedCompressedCount}
        isCountBouncing={home.isCountBouncing}
      />
      <HomeFooter copy={home.copy} lang={home.lang} />
    </main>
  );
}
