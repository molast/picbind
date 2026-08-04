"use client";

import React from "react";
import { FaWeixin } from "react-icons/fa";
import { FiLoader, FiMessageCircle, FiPower, FiX } from "react-icons/fi";
import type {
  IlinkGatewaySnapshot,
  IlinkLoginSession,
  MessagingProviderSnapshot,
  MessagingService,
  WeixinIlinkProvider,
} from "../../messaging";
import type { ShareRoomLabels } from "./share-room-labels";

type MessagingServiceDialogProps = {
  open: boolean;
  service?: MessagingService;
  providers: MessagingProviderSnapshot[];
  labels: ShareRoomLabels;
  onClose(): void;
};

type DisplayProvider = MessagingProviderSnapshot & {
  configured: boolean;
};

export default function MessagingServiceDialog({
  open,
  service,
  providers,
  labels,
  onClose,
}: MessagingServiceDialogProps) {
  const [pendingProviderId, setPendingProviderId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [gateway, setGateway] = React.useState<IlinkGatewaySnapshot | null>(null);
  const [login, setLogin] = React.useState<IlinkLoginSession | null>(null);

  const weixinProvider = service?.getProvider("weixin-ilink") as WeixinIlinkProvider | undefined;

  React.useEffect(() => {
    if (!open) {
      setPendingProviderId(null);
      setError(null);
      setLogin(null);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || !weixinProvider) return;
    let active = true;
    void weixinProvider.getGatewayStatus().then((snapshot) => {
      if (active) setGateway(snapshot);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [open, weixinProvider]);

  React.useEffect(() => {
    if (!open || !weixinProvider || !login || !new Set(["qr_pending", "scanned"]).has(login.state)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void weixinProvider.getLoginStatus(login.sessionId).then(async (next) => {
        if (!active) return;
        setLogin((current) => current ? { ...current, ...next } : next);
        if (next.state === "confirmed") {
          setGateway(await weixinProvider.getGatewayStatus());
          await service?.startProvider(weixinProvider.id);
        }
      }).catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [login, open, service, weixinProvider]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open]);

  if (!open) return null;

  const hasWechat = providers.some((provider) => provider.channel === "wechat");
  const displayProviders: DisplayProvider[] = [
    ...providers.map((provider) => ({
      ...provider,
      configured: provider.id === "weixin-ilink" ? Boolean(gateway?.configured) : true,
    })),
    ...(hasWechat
      ? []
      : [{
          id: "wechat",
          channel: "wechat" as const,
          displayName: labels.wechatProvider,
          status: "disconnected" as const,
          configured: false,
        }]),
  ];

  const statusLabel = (provider: DisplayProvider) => {
    if (!provider.configured) return labels.messagingNotConfigured;
    if (provider.status === "connected") return labels.messagingConnected;
    if (provider.status === "connecting") return labels.messagingConnecting;
    if (provider.status === "error") return labels.messagingConnectionFailed;
    return labels.messagingDisconnected;
  };

  const changeConnection = async (provider: DisplayProvider) => {
    if (!service || pendingProviderId) return;
    setPendingProviderId(provider.id);
    setError(null);
    try {
      if (!provider.configured && provider.id === "weixin-ilink" && weixinProvider) {
        setLogin(await weixinProvider.startLogin());
        return;
      }
      if (provider.status === "connected") {
        await service.stopProvider(provider.id);
      } else {
        await service.startProvider(provider.id);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : labels.messagingConnectionFailed,
      );
    } finally {
      setPendingProviderId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4">
      <section
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={labels.messagingService}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]">
              <FiMessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">
                {labels.messagingService}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {labels.messagingProviders}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label={labels.closeDialog}
          >
            <FiX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="max-h-[52vh] space-y-2 overflow-y-auto p-4">
          {displayProviders.map((provider) => {
            const pending = pendingProviderId === provider.id;
            const connected = provider.status === "connected";
            return (
              <article
                key={provider.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#e9f8ef] text-[#07c160]">
                  {provider.channel === "wechat" ? (
                    <FaWeixin className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <FiMessageCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-800">
                    {provider.displayName}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        connected
                          ? "bg-emerald-500"
                          : provider.status === "connecting"
                            ? "bg-amber-400"
                            : provider.status === "error"
                              ? "bg-red-500"
                              : "bg-slate-300"
                      }`}
                      aria-hidden="true"
                    />
                    {statusLabel(provider)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending || Boolean(pendingProviderId) || (!provider.configured && provider.id !== "weixin-ilink")}
                  onClick={() => void changeConnection(provider)}
                  className={`inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    connected
                      ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
                      : "bg-[#2f65cf] text-white hover:bg-[#2457bd]"
                  }`}
                >
                  {pending ? (
                    <FiLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <FiPower className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {provider.configured
                    ? connected
                      ? labels.messagingDisconnect
                      : labels.messagingConnect
                    : provider.id === "weixin-ilink"
                      ? labels.messagingConfigure
                      : labels.messagingNotConfigured}
                </button>
              </article>
            );
          })}
          {login?.qrDataUrl && new Set(["qr_pending", "scanned"]).has(login.state) ? (
            <div className="flex flex-col items-center rounded-md border border-slate-200 bg-slate-50 p-4 text-center">
              <img
                src={login.qrDataUrl}
                alt={labels.messagingScanQr}
                width={220}
                height={220}
                className="h-[220px] w-[220px] rounded bg-white"
              />
              <div className="mt-3 text-xs font-medium text-slate-700">
                {login.state === "scanned" ? labels.messagingConfirmInWechat : labels.messagingScanQr}
              </div>
            </div>
          ) : null}
          {login?.state === "expired" ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {labels.messagingQrExpired}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
