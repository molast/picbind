import HomeCompressLanding from "@/components/home-compress-landing";
import type { Lang } from "@/locales";
import { getPublicUiConfig } from "@/server/metrics-store";
import { cookies } from "next/headers";
import { unstable_noStore as noStore } from "next/cache";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  noStore();
  const cookieStore = cookies();
  const cookieLang = cookieStore.get("nano-img-lang")?.value;
  const initialLang: Lang = cookieLang === "en" ? "en" : "zh";
  const uiConfig = await getPublicUiConfig();

  return (
    <HomeCompressLanding
      initialLang={initialLang}
      showCompressedCount={uiConfig.showCompressedCount}
      showCompareSection={uiConfig.showCompareSection}
    />
  );
}
