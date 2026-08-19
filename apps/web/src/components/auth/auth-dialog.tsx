"use client";

import React from "react";
import { FiChevronDown, FiEye, FiEyeOff, FiLoader, FiX } from "react-icons/fi";
import { authService, type AuthState, type OAuthProvider } from "@/utils/auth-service";
import type { Lang } from "@/locales";

export type AuthMode = "login" | "register";

const COPY = {
  zh: {
    loginTitle: "登录 PicBind",
    registerTitle: "创建免费账号",
    noAccount: "还没有账号？",
    hasAccount: "已有账号？",
    login: "登录",
    register: "注册",
    github: "使用 GitHub 继续",
    google: "使用 Google 继续",
    lastUsed: "上次使用",
    orEmail: "或使用邮箱",
    name: "姓名",
    email: "邮箱",
    password: "密码",
    confirmation: "确认密码",
    waiting: "请稍候",
    close: "关闭",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    errors: {
      email_registered: "该邮箱已注册。",
      invalid_credentials: "邮箱或密码错误。",
      invalid_input: "请输入有效邮箱，密码至少需要 8 个字符。",
      password_mismatch: "两次输入的密码不一致。",
      network_error: "无法连接 PicBind，请检查网络后重试。",
      rate_limited: "尝试次数过多，请稍后再试。",
      oauth_cancelled: "已取消第三方登录。",
      oauth_invalid_state: "本次登录请求已过期，请重新开始。",
      oauth_failed: "第三方登录失败，请重试。",
      oauth_unavailable: "该登录方式暂时不可用。",
      invalid_response: "登录服务暂时不可用。",
    },
  },
  en: {
    loginTitle: "Log in to PicBind",
    registerTitle: "Create a free account",
    noAccount: "Don't have an account?",
    hasAccount: "Already have an account?",
    login: "Log in",
    register: "Sign up",
    github: "Continue with GitHub",
    google: "Continue with Google",
    lastUsed: "Last used",
    orEmail: "Or use email",
    name: "Full name",
    email: "Email",
    password: "Password",
    confirmation: "Confirm password",
    waiting: "Please wait",
    close: "Close",
    showPassword: "Show password",
    hidePassword: "Hide password",
    errors: {
      email_registered: "This email is already registered.",
      invalid_credentials: "Email or password is incorrect.",
      invalid_input: "Enter a valid email and a password of at least 8 characters.",
      password_mismatch: "The passwords do not match.",
      network_error: "Unable to reach PicBind. Check your connection and try again.",
      rate_limited: "Too many attempts. Wait a moment and try again.",
      oauth_cancelled: "Third-party login was cancelled.",
      oauth_invalid_state: "This login request expired. Please start again.",
      oauth_failed: "Third-party login failed. Please try again.",
      oauth_unavailable: "This login provider is temporarily unavailable.",
      invalid_response: "Authentication is temporarily unavailable.",
    },
  },
} as const;

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error
    ? String((error as Error & { code: string }).code)
    : "invalid_response";
}

type Props = {
  initialMode: AuthMode;
  lang: Lang;
  lastProvider: OAuthProvider | null;
  initialError: string | null;
  onClose(): void;
  onAuthenticated(state: AuthState): void;
};

export default function AuthDialog({
  initialMode,
  lang,
  lastProvider,
  initialError,
  onClose,
  onAuthenticated,
}: Props) {
  const copy = COPY[lang];
  const [mode, setMode] = React.useState(initialMode);
  const [emailExpanded, setEmailExpanded] = React.useState(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [passwordVisible, setPasswordVisible] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(initialError);
  const isRegister = mode === "register";

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, submitting]);

  const errorMessage = error
    ? copy.errors[error as keyof typeof copy.errors] || copy.errors.invalid_response
    : null;

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!email.trim() || password.length < 8 || (isRegister && !name.trim())) {
      setError("invalid_input");
      return;
    }
    if (isRegister && password !== confirmation) {
      setError("password_mismatch");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const state = isRegister
        ? await authService.register(name, email, password)
        : await authService.login(email, password);
      onAuthenticated(state);
    } catch (requestError) {
      setError(errorCode(requestError));
      setSubmitting(false);
    }
  }

  async function submitOAuth(provider: OAuthProvider) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      onAuthenticated(await authService.oauth(provider));
    } catch (requestError) {
      setError(errorCode(requestError));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[3px] max-[480px]:items-end max-[480px]:p-0"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section
        className="max-h-[calc(100vh-32px)] w-full max-w-[460px] overflow-y-auto rounded-lg border border-slate-200 bg-white p-7 text-slate-800 shadow-[0_26px_75px_rgba(15,23,42,0.32)] max-[480px]:max-h-[92vh] max-[480px]:rounded-b-none max-[480px]:p-[22px_18px_26px]"
        role="dialog"
        aria-modal="true"
        aria-label={isRegister ? copy.registerTitle : copy.loginTitle}
      >
        <header className="relative flex min-h-[42px] items-start justify-between gap-5 pr-10">
          <div>
            <h2 className="text-[24px] font-bold leading-tight text-slate-900 max-[480px]:text-[21px]">
              {isRegister ? copy.registerTitle : copy.loginTitle}
            </h2>
            <p className="mt-2 text-[13px] text-slate-500">
              {isRegister ? copy.hasAccount : copy.noAccount}{" "}
              <a
                href={isRegister ? "#login" : "#register"}
                className="font-bold text-[#2f65cf] hover:underline"
                onClick={(event) => {
                  event.preventDefault();
                  if (submitting) return;
                  setMode(isRegister ? "login" : "register");
                  setEmailExpanded(false);
                  setError(null);
                }}
              >
                {isRegister ? copy.login : copy.register}
              </a>
            </p>
          </div>
          <button
            type="button"
            aria-label={copy.close}
            disabled={submitting}
            onClick={onClose}
            className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <FiX className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {errorMessage ? (
          <p className="mt-[18px] border-l-[3px] border-red-600 bg-red-50 px-3 py-2.5 text-[13px] leading-relaxed text-red-700" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-6 grid gap-3">
          <ProviderButton provider="github" label={copy.github} lastUsed={lastProvider === "github" ? copy.lastUsed : null} disabled={submitting} onClick={() => submitOAuth("github")} />
          <ProviderButton provider="google" label={copy.google} lastUsed={lastProvider === "google" ? copy.lastUsed : null} disabled={submitting} onClick={() => submitOAuth("google")} />
        </div>

        <button
          type="button"
          disabled={submitting}
          aria-expanded={emailExpanded}
          onClick={() => setEmailExpanded((value) => !value)}
          className="mt-4 flex h-[42px] w-full items-center gap-2.5 text-[13px] text-[#2f65cf]"
        >
          <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
          <span>{copy.orEmail}</span>
          <FiChevronDown className={`h-[18px] w-[18px] transition ${emailExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
          <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
        </button>

        {emailExpanded ? (
          <form className="mt-4 flex flex-col gap-[15px]" onSubmit={submitEmail}>
            {isRegister ? <Field label={copy.name} type="text" value={name} onChange={setName} disabled={submitting} /> : null}
            <Field label={copy.email} type="email" value={email} onChange={setEmail} disabled={submitting} />
            <label className="block">
              <span className="mb-[7px] block text-[13px] font-bold text-slate-600">{copy.password}</span>
              <div className="relative">
                <input
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="off"
                  minLength={8}
                  maxLength={1024}
                  required
                  value={password}
                  disabled={submitting}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-[46px] w-full rounded-md border border-slate-300 bg-slate-50 px-3 pr-11 text-[14px] outline-none focus:border-blue-500 focus:bg-white focus:ring-[3px] focus:ring-blue-600/15"
                />
                <button type="button" aria-label={passwordVisible ? copy.hidePassword : copy.showPassword} onClick={() => setPasswordVisible((value) => !value)} className="absolute right-[3px] top-[5px] flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">
                  {passwordVisible ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
                </button>
              </div>
            </label>
            {isRegister ? <Field label={copy.confirmation} type="password" value={confirmation} onChange={setConfirmation} disabled={submitting} /> : null}
            <button type="submit" disabled={submitting} className="flex h-[46px] w-full items-center justify-center gap-2 rounded-md bg-slate-900 text-[14px] font-bold text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-70">
              {submitting ? <FiLoader className="h-[18px] w-[18px] animate-spin" aria-hidden="true" /> : null}
              {submitting ? copy.waiting : isRegister ? copy.register : copy.login}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function ProviderButton({ provider, label, lastUsed, disabled, onClick }: { provider: OAuthProvider; label: string; lastUsed: string | null; disabled: boolean; onClick(): void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`relative flex h-[52px] items-center justify-center gap-3 rounded-md border px-4 text-[15px] font-bold transition disabled:cursor-wait disabled:opacity-65 ${provider === "github" ? "border-slate-900 bg-slate-900 text-white hover:bg-black" : "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50"}`}>
      <img src={`/images/auth-${provider}.svg`} alt="" width={24} height={24} className={provider === "github" ? "invert" : ""} />
      <span className="truncate">{label}</span>
      {lastUsed ? <span className="absolute -top-[11px] right-2.5 h-[23px] rounded-full bg-[#fee2d5] px-2.5 text-[11px] font-semibold leading-[23px] text-[#c4320a] shadow-[0_0_0_2px_white]">{lastUsed}</span> : null}
    </button>
  );
}

function Field({ label, type, value, onChange, disabled }: { label: string; type: string; value: string; onChange(value: string): void; disabled: boolean }) {
  return (
    <label className="block">
      <span className="mb-[7px] block text-[13px] font-bold text-slate-600">{label}</span>
      <input type={type} autoComplete="off" required maxLength={type === "text" ? 80 : type === "password" ? 1024 : 254} minLength={type === "password" ? 8 : undefined} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-[46px] w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-[14px] outline-none focus:border-blue-500 focus:bg-white focus:ring-[3px] focus:ring-blue-600/15" />
    </label>
  );
}
