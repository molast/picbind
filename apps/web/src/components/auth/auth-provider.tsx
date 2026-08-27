"use client";

import React from "react";
import AuthDialog, { type AuthMode } from "./auth-dialog";
import {
  anonymousAuthState,
  authService,
  type AuthState,
  type OAuthProvider,
} from "@/utils/auth-service";
import type { Lang } from "@/locales";

type DialogState = {
  mode: AuthMode;
  lang: Lang;
  lastProvider: OAuthProvider | null;
};

type AuthContextValue = {
  state: AuthState;
  checking: boolean;
  openDialog(mode: AuthMode, lang: Lang): void;
  closeDialog(): void;
  setState(state: AuthState): void;
  logout(): Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateValue] = React.useState<AuthState>(
    () => authService.cachedState() || anonymousAuthState(),
  );
  const [checking, setChecking] = React.useState(true);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const showOAuthError = (error: unknown) => {
      if (!active) return;
      const code = error instanceof Error && "code" in error
        ? String((error as Error & { code: string }).code)
        : "oauth_failed";
      setRestoreError(code);
      setDialog({
        mode: "login",
        lang: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
        lastProvider: authService.lastProvider(),
      });
    };
    const unobserve = authService.observeDesktopOAuth({
      authenticated(next) {
        if (!active) return;
        setStateValue(next);
        setRestoreError(null);
        setDialog(null);
      },
      failed: showOAuthError,
    });
    void authService
      .restore()
      .then((next) => {
        if (active) setStateValue(next);
      })
      .catch(showOAuthError)
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      unobserve();
    };
  }, []);

  const setState = React.useCallback((next: AuthState) => {
    authService.cacheState(next);
    setStateValue(next);
  }, []);

  const value = React.useMemo<AuthContextValue>(() => ({
    state,
    checking,
    openDialog(mode, lang) {
      setRestoreError(null);
      setDialog({ mode, lang, lastProvider: authService.lastProvider() });
    },
    closeDialog() {
      setRestoreError(null);
      setDialog(null);
    },
    setState,
    async logout() {
      setState(await authService.logout());
    },
  }), [checking, setState, state]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialog ? (
        <AuthDialog
          key={`${dialog.mode}:${dialog.lang}`}
          initialMode={dialog.mode}
          lang={dialog.lang}
          lastProvider={dialog.lastProvider}
          initialError={restoreError}
          onClose={() => value.closeDialog()}
          onAuthenticated={(next) => {
            setState(next);
            setDialog(null);
          }}
        />
      ) : null}
    </AuthContext.Provider>
  );
}
