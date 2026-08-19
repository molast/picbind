"use client";

import React from "react";
import HomeFooter from "./home-footer";
import HomeComparePanel from "./home-compare-panel";
import HomeHero from "./home-hero";
import HomeInfoSection from "./home-info-section";
import HomeResults from "./home-results";
import RoomUnavailableDialog, {
  type RoomUnavailableReason,
} from "./room-unavailable-dialog";
import { useHomeCompression } from "./use-home-compression";
import type { Lang } from "@/locales";
import type { ShareRoom } from "@picbind/ui/source/types";

type HomeCompressLandingProps = {
  initialLang: Lang;
  onRoomCreated?(room: ShareRoom): void;
  hasActiveRoom?: boolean;
  onRestoreActiveRoom?(): void;
};

export default function HomeCompressLanding({
  initialLang,
  onRoomCreated,
  hasActiveRoom = false,
  onRestoreActiveRoom,
}: HomeCompressLandingProps) {
  const home = useHomeCompression({ initialLang });
  const [roomUnavailableReason, setRoomUnavailableReason] =
    React.useState<RoomUnavailableReason | null>(null);

  React.useEffect(() => {
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("roomClosed") === "1"
      ? "closed"
      : url.searchParams.get("roomKicked") === "1"
        ? "kicked"
        : null;
    if (!reason) return;
    setRoomUnavailableReason(reason);
    url.searchParams.delete("roomClosed");
    url.searchParams.delete("roomKicked");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

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
        onRoomCreated={onRoomCreated}
        hasActiveRoom={hasActiveRoom}
        onRestoreActiveRoom={onRestoreActiveRoom}
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
      <RoomUnavailableDialog
        lang={home.lang}
        reason={roomUnavailableReason}
        onClose={() => setRoomUnavailableReason(null)}
      />
    </main>
  );
}
