"use client";

import HomeCompressLanding from "./home-compress-landing";
import type { Lang } from "@/locales";

export default function HomePageStack({ initialLang }: { initialLang: Lang }) {
  return <HomeCompressLanding initialLang={initialLang} />;
}
