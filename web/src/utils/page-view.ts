"use client";

const PAGE_VIEW_ENABLED = process.env.NEXT_PUBLIC_PAGE_VIEW_ENABLED === "true";
const PAGE_VIEW_API_PATH = process.env.NEXT_PUBLIC_PAGE_VIEW_API_PATH || "";
const PAGE_VIEW_SESSION_KEY = "picbind-page-view-reported";

export async function reportPageViewOnce() {
  if (!PAGE_VIEW_ENABLED) {
    return;
  }
  if (!PAGE_VIEW_API_PATH) {
    return;
  }
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (window.sessionStorage.getItem(PAGE_VIEW_SESSION_KEY) === "1") {
      return;
    }
  } catch {
    return;
  }

  try {
    const response = await fetch(PAGE_VIEW_API_PATH, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Page view write failed with status ${response.status}`);
    }
    window.sessionStorage.setItem(PAGE_VIEW_SESSION_KEY, "1");
  } catch (error) {
    console.error("Page view write failed:", error);
  }
}
