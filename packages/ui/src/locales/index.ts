import en from "./en";
export { getWorkspaceLabels } from "./workspace";
export type { WorkspaceLabels } from "./workspace";
import zh from "./zh";

export type Lang = "en" | "zh";
export type ShareRoomLabels = typeof zh;

const LANG_KEY = "ai-translator-lang-v2";
const LANG_COOKIE_KEY = "picbind-lang";

function isLang(value: string | null): value is Lang {
  return value === "en" || value === "zh";
}

export function getLang(): Lang {
  if (typeof window === "undefined") return "en";

  const queryLang = new URLSearchParams(window.location.search).get("lang");
  if (queryLang === "zh-CN" || queryLang === "zh") return "zh";
  if (queryLang === "en") return "en";

  try {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }

  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${LANG_COOKIE_KEY}=`))
    ?.split("=")[1];
  const cookieLang = cookie ? decodeURIComponent(cookie) : null;
  return isLang(cookieLang) ? cookieLang : "en";
}

export function setLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // The current page still updates even when persistence is unavailable.
  }
  document.cookie = `${LANG_COOKIE_KEY}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function getShareRoomLabels(
  lang: Lang,
  maxImageTransferSize: number | null = null,
): ShareRoomLabels {
  const labels = lang === "zh" ? zh : en;
  if (!maxImageTransferSize) return labels;

  const sizeMb = maxImageTransferSize / 1024 / 1024;
  const sizeText = `${Number(sizeMb.toFixed(2))} MB`;
  return {
    ...labels,
    dropHint: labels.dropHintWithSize(sizeText),
    tooLarge: labels.tooLargeWithSize(sizeText),
  };
}
