"use client";

import React from "react";
import HomeFooter from "./home-footer";
import HomeComparePanel from "./home-compare-panel";
import DesktopHome from "./desktop-home";
import HomeHero from "./home-hero";
import HomeInfoSection from "./home-info-section";
import HomeResults from "./home-results";
import { useHomeCompression } from "./use-home-compression";
import type { Lang } from "@/locales";
import { isTauri } from "@tauri-apps/api/core";

type HomeCompressLandingProps = {
  initialLang: Lang;
};

export default function HomeCompressLanding({
  initialLang,
}: HomeCompressLandingProps) {
  const home = useHomeCompression({ initialLang });
  const [desktop, setDesktop] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setDesktop(isTauri());
  }, []);

  if (!home.langReady || desktop === null) {
    return <main className="min-h-screen w-full bg-[#ececec]" />;
  }

  if (desktop) {
    return (
      <DesktopHome home={home} />
    );
  }

  return (
    <main className="w-full bg-[#ececec] text-slate-800">
      <HomeHero
        copy={home.copy}
        lang={home.lang}
        inputRef={home.inputRef}
        isDragging={home.isDragging}
        showFormatOptions={home.showFormatOptions}
        selectedFormats={home.selectedFormats}
        formatOptions={home.formatOptions}
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
        accept=".png,.jpg,.jpeg,.webp,.avif,image/png,image/jpeg,image/webp,image/avif"
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
        lang={home.lang}
        allowCompareSelection={home.homeAllowCompareSelection}
        showQualityMetrics={home.homeShowQualityMetrics}
        compareAssets={home.compareAssets}
        onDownloadZip={home.handleDownloadZip}
        onWhyVariantChange={home.setWhyVariantId}
        onMetricsVariantChange={home.setMetricsVariantId}
        onLoadVariantMetrics={home.loadVariantMetrics}
        onConvertAnyway={home.handleConvertAnyway}
        onAddVariantToCompare={home.addVariantToCompare}
      />

      {home.homeShowCompareSection && (
        <HomeComparePanel
          copy={home.compareCopy}
          ready={home.compareSectionReady}
          defaultCompressedSrc={home.compareCompressedSrc}
          defaultSizes={home.compareSizes}
          assets={home.compareAssets}
          leftAssetId={home.compareLeftAssetId}
          rightAssetId={home.compareRightAssetId}
          hasResults={home.sortedItems.length > 0}
        />
      )}

      <HomeInfoSection
        copy={home.copy}
        lang={home.lang}
        showCompressedCount={home.homeShowCompressedCount}
        displayedCompressedCount={home.displayedCompressedCount}
        isCountBouncing={home.isCountBouncing}
      />
      <HomeFooter copy={home.copy} lang={home.lang} />
    </main>
  );
}
