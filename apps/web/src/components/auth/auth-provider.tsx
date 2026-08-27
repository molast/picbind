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
  emailExpanded: boolean;
};

type AuthAttempt = {
  mode: AuthMode;
  lang: Lang;
  method: "email" | "oauth";
  request(): Promise<AuthState>;
};

type AuthContextValue = {
  state: AuthState;
  checking: boolean;
  authenticating: boolean;
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
  const [authenticating, setAuthenticating] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  const attemptId = React.useRef(0);
  const pendingAttempt = React.useRef<Pick<AuthAttempt, "mode" | "lang" | "method"> & {
    id: number;
  } | null>(null);

  const showAuthError = React.useCallback((error: unknown) => {
    const attempt = pendingAttempt.current;
    const code = error instanceof Error && "code" in error
      ? String((error as Error & { code: string }).code)
      : attempt?.method === "email" ? "invalid_response" : "oauth_failed";
    pendingAttempt.current = null;
    setAuthenticating(false);
    setRestoreError(code);
    setDialog({
      mode: attempt?.mode || "login",
      lang: attempt?.lang || (document.documentElement.lang.startsWith("zh") ? "zh" : "en"),
      lastProvider: authService.lastProvider(),
      emailExpanded: attempt?.method === "email",
    });
  }, []);

  React.useEffect(() => {
    let active = true;
    void authService
      .restore()
      .then((next) => {
        if (active) setStateValue(next);
      })
      .catch((error) => {
        if (active) showAuthError(error);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [showAuthError]);

  const setState = React.useCallback((next: AuthState) => {
    authService.cacheState(next);
    setStateValue(next);
  }, []);

  const authenticate = React.useCallback((attempt: AuthAttempt) => {
    const id = ++attemptId.current;
    pendingAttempt.current = {
      id,
      mode: attempt.mode,
      lang: attempt.lang,
      method: attempt.method,
    };
    setRestoreError(null);
    setAuthenticating(true);
    setDialog(null);

    let request: Promise<AuthState>;
    try {
      request = attempt.request();
    } catch (error) {
      showAuthError(error);
      return;
    }
    void request
      .then((next) => {
        if (pendingAttempt.current?.id !== id) return;
        pendingAttempt.current = null;
        setAuthenticating(false);
        setState(next);
      })
      .catch((error) => {
        if (pendingAttempt.current?.id === id) showAuthError(error);
      });
  }, [setState, showAuthError]);

  const value = React.useMemo<AuthContextValue>(() => ({
    state,
    checking,
    authenticating,
    openDialog(mode, lang) {
      if (authenticating) return;
      setRestoreError(null);
      setDialog({
        mode,
        lang,
        lastProvider: authService.lastProvider(),
        emailExpanded: false,
      });
    },
    closeDialog() {
      setRestoreError(null);
      setDialog(null);
    },
    setState,
    async logout() {
      setState(await authService.logout());
    },
  }), [authenticating, checking, setState, state]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      {dialog ? (
        <AuthDialog
          key={`${dialog.mode}:${dialog.lang}`}
          initialMode={dialog.mode}
          lang={dialog.lang}
          lastProvider={dialog.lastProvider}
          initialEmailExpanded={dialog.emailExpanded}
          initialError={restoreError}
          onClose={() => value.closeDialog()}
          onAuthenticate={(attempt) => authenticate({ ...attempt, lang: dialog.lang })}
        />
      ) : null}
    </AuthContext.Provider>
  );
}
