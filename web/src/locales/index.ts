// 'use client'

import zh from "./zh";
import en from "./en";

import type { HomeCompressLandingCopy, LocaleType } from "./zh";
export type { HomeCompressLandingCopy, LocaleType, PartialLocaleType } from "./zh";

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
const DEFAULT_LANG = "zh";

const fallbackLang = zh;
const targetLang = ALL_LANGS[getLang()] as LocaleType;
const currentLang = { ...fallbackLang, ...targetLang };

export default currentLang as LocaleType;

export function getHomeCompressLandingCopy(lang: Lang): HomeCompressLandingCopy {
  return ALL_LANGS[lang].HomeCompressLanding ?? fallbackLang.HomeCompressLanding;
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

function getLanguage() {
  try {
    return navigator.language.toLowerCase();
  } catch {
    return DEFAULT_LANG;
  }
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

  const lang = getLanguage();
  for (const option of AllLangs) {
    if (lang.includes(option)) {
      return option;
    }
  }

  return DEFAULT_LANG;
}

export function changeLang(lang: Lang | string) {
  setItem(LANG_KEY, lang);
  location.reload();
}

export function setLang(lang: Lang) {
  setItem(LANG_KEY, lang);
}

export function getISOLang() {
  const isoLangString: Record<string, string> = {
    cn: "zh-Hans",
    tw: "zh-Hant",
  };

  const lang = getLang();
  return isoLangString[lang] ?? lang;
}
