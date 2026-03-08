import HomeCompressLanding from "@/components/home-compress-landing";
import type { Lang } from "@/locales";
import { cookies } from "next/headers";

export default function HomePage() {
  const cookieStore = cookies();
  const cookieLang = cookieStore.get("nano-img-lang")?.value;
  const initialLang: Lang = cookieLang === "zh" ? "zh" : "en";

  return <HomeCompressLanding initialLang={initialLang} />;
}
