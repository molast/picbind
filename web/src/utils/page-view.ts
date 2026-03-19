"use client";

const PAGE_VIEW_API_PATH =
  process.env.NEXT_PUBLIC_PAGE_VIEW_API_PATH || "/api/site/view";
const PAGE_VIEW_SESSION_KEY = "nanoimg-page-view-reported";

export async function reportPageViewOnce() {
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
