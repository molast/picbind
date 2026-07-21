"use client";

import React from "react";
import { getAdminStateApiPath } from "@/utils/api-endpoints";
import { EMPTY_ADMIN_STATE, type AdminDashboardState } from "./admin-types";

export function useAdminDashboard() {
  const stateUrl = getAdminStateApiPath();
  const adminKey = (process.env.NEXT_PUBLIC_ADMIN_KEY || "").trim();
  const [state, setState] = React.useState(EMPTY_ADMIN_STATE);
  const [showCompressedCount, setShowCompressedCount] = React.useState(
    EMPTY_ADMIN_STATE.showCompressedCount,
  );
  const [statusText, setStatusText] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isMounted, setIsMounted] = React.useState(false);

  const buildStateUrl = React.useCallback(
    (syncSummary: boolean) => {
      if (!stateUrl) return "";
      const url = new URL(
        stateUrl,
        typeof window !== "undefined"
          ? window.location.origin
          : "https://picbind.com",
      );
      syncSummary
        ? url.searchParams.set("sync", "1")
        : url.searchParams.delete("sync");
      return url.toString();
    },
    [stateUrl],
  );

  const applyState = React.useCallback((next: AdminDashboardState) => {
    setState(next);
    setShowCompressedCount(next.showCompressedCount);
  }, []);

  const refreshState = React.useCallback(async () => {
    if (!stateUrl) throw new Error("未配置 NEXT_PUBLIC_ADMIN_STATE_API_PATH");
    if (!adminKey) throw new Error("未配置 NEXT_PUBLIC_ADMIN_KEY");

    setIsLoading(true);
    try {
      const response = await fetch(buildStateUrl(true), {
        headers: { "x-admin-key": adminKey },
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Admin Key 错误，或 Worker 未配置 ADMIN_KEY");
        }
        throw new Error(`拉取后台数据失败（${response.status}）`);
      }
      applyState((await response.json()) as AdminDashboardState);
      setStatusText("数据已刷新（已同步 DO -> KV）");
    } finally {
      setIsLoading(false);
    }
  }, [adminKey, applyState, buildStateUrl, stateUrl]);

  const saveConfig = React.useCallback(async () => {
    if (!stateUrl || !adminKey) {
      setStatusText(
        !stateUrl
          ? "未配置 NEXT_PUBLIC_ADMIN_STATE_API_PATH"
          : "未配置 NEXT_PUBLIC_ADMIN_KEY",
      );
      return;
    }

    setIsSaving(true);
    setStatusText("");
    try {
      const response = await fetch(stateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ showCompressedCount }),
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Admin Key 错误，或 Worker 未配置 ADMIN_KEY");
        }
        throw new Error(`保存失败（${response.status}）`);
      }
      applyState((await response.json()) as AdminDashboardState);
      setStatusText("配置已保存");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  }, [adminKey, applyState, showCompressedCount, stateUrl]);

  React.useEffect(() => setIsMounted(true), []);
  React.useEffect(() => {
    if (!stateUrl) return;
    void refreshState().catch((error) => {
      setStatusText(error instanceof Error ? error.message : "加载后台数据失败");
    });
  }, [refreshState, stateUrl]);

  return {
    state,
    stateUrl,
    showCompressedCount,
    setShowCompressedCount,
    statusText,
    isSaving,
    isLoading,
    isMounted,
    refreshState,
    saveConfig,
  };
}
