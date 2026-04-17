// 'use client'

import zh from "./zh";
import en from "./en";

import type {
  FaviconGeneratorCopy,
  HomeCompressLandingCopy,
  LocaleType,
} from "./zh";
export type {
  FaviconGeneratorCopy,
  HomeCompressLandingCopy,
  LocaleType,
  PartialLocaleType,
} from "./zh";

const ALL_LANGS = {
  zh,
  en,
};

export type Lang = keyof typeof ALL_LANGS;

export const AllLangs = Object.keys(ALL_LANGS) as Lang[];

export const ALL_LANG_OPTIONS = [
  {
    label: "中文",
    value: "zh",
  },
  {
    label: "English",
    value: "en",
  },
];

const LANG_KEY = "ai-translator-lang-v2";
const LANG_COOKIE_KEY = "picbind-lang";
const LEGACY_LANG_COOKIE_KEY = "nano-img-lang";
const DEFAULT_LANG = "zh";

const fallbackLang = zh;
const targetLang = ALL_LANGS[getLang()] as LocaleType;
const currentLang = { ...fallbackLang, ...targetLang };

export default currentLang as LocaleType;

export function getHomeCompressLandingCopy(
  lang: Lang,
): HomeCompressLandingCopy {
  return ALL_LANGS[lang].HomeCompressLanding ?? fallbackLang.HomeCompressLanding;
}

export function getFaviconGeneratorCopy(lang: Lang): FaviconGeneratorCopy {
  return ALL_LANGS[lang].FaviconGenerator ?? fallbackLang.FaviconGenerator;
}

function getItem(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function getCookie(key: string) {
  if (typeof document === "undefined") {
    return null;
  }
  const encodedKey = encodeURIComponent(key);
  const hit = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${encodedKey}=`));
  if (!hit) {
    return null;
  }
  return decodeURIComponent(hit.slice(encodedKey.length + 1));
}

function setCookie(key: string, value: string) {
  if (typeof document === "undefined") {
    return;
  }
  const encodedKey = encodeURIComponent(key);
  const encodedValue = encodeURIComponent(value);
  document.cookie = `${encodedKey}=${encodedValue}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function getLang(): Lang {
  if (typeof window !== "undefined") {
    let urlLang = new URLSearchParams(window.location.search).get("lang");
    if (urlLang === "zh-CN") urlLang = "zh";
    if (AllLangs.includes((urlLang ?? "") as Lang)) {
      return urlLang as Lang;
    }
  }

  const savedLang = getItem(LANG_KEY);
  if (AllLangs.includes((savedLang ?? "") as Lang)) {
    return savedLang as Lang;
  }

  const cookieLang = getCookie(LANG_COOKIE_KEY) || getCookie(LEGACY_LANG_COOKIE_KEY);
  if (AllLangs.includes((cookieLang ?? "") as Lang)) {
    return cookieLang as Lang;
  }

  return DEFAULT_LANG;
}

export function changeLang(lang: Lang | string) {
  setItem(LANG_KEY, lang);
  location.reload();
}

export function setLang(lang: Lang) {
  setItem(LANG_KEY, lang);
  setCookie(LANG_COOKIE_KEY, lang);
}

export function getISOLang() {
  const isoLangString: Record<string, string> = {
    cn: "zh-Hans",
    tw: "zh-Hant",
    zh: "zh-Hans",
    en: "en",
  };

  const lang = getLang();
  return isoLangString[lang] ?? lang;
}
