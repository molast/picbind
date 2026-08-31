"use client";

import React from "react";
import { FaWeixin } from "react-icons/fa";
import { FiLoader, FiMessageCircle, FiPower } from "react-icons/fi";
import type {
  IlinkGatewaySnapshot,
  IlinkLoginSession,
  MessagingProviderSnapshot,
  MessagingService,
  WeixinIlinkProvider,
} from "../../messaging";
import type { ShareRoomLabels } from "../../locales";

type DisplayProvider = MessagingProviderSnapshot & { configured: boolean };

export function WorkspaceMessagingServiceSettings({
  service,
  providers,
  labels,
}: {
  service?: MessagingService;
  providers: MessagingProviderSnapshot[];
  labels: ShareRoomLabels;
}) {
  const [pendingProviderId, setPendingProviderId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [gateway, setGateway] = React.useState<IlinkGatewaySnapshot | null>(null);
  const [login, setLogin] = React.useState<IlinkLoginSession | null>(null);
  const weixinProvider = service?.getProvider("weixin-ilink") as WeixinIlinkProvider | undefined;
  const weixinSnapshot = providers.find((provider) => provider.id === "weixin-ilink");

  React.useEffect(() => {
    if (!weixinProvider) return;
    let active = true;
    void weixinProvider.getGatewayStatus().then((snapshot) => {
      if (active) setGateway(snapshot);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [weixinProvider, weixinSnapshot?.error, weixinSnapshot?.status]);

  React.useEffect(() => {
    if (!weixinProvider || !login || !new Set(["qr_pending", "scanned"]).has(login.state)) return;
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
  }, [login, service, weixinProvider]);

  const displayProviders: DisplayProvider[] = providers.map((provider) => ({
    ...provider,
    configured: provider.id === "weixin-ilink" ? Boolean(gateway?.configured) : true,
  }));
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
      } else if (provider.status === "connected") {
        await service.stopProvider(provider.id);
      } else {
        await service.startProvider(provider.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.messagingConnectionFailed);
    } finally {
      setPendingProviderId(null);
    }
  };

  return <section className="p-[18px]" aria-label={labels.messagingService}>
      <header className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-[#2f65cf]"><FiMessageCircle className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0"><h3 className="text-sm font-semibold text-slate-900">{labels.messagingService}</h3><p className="mt-0.5 text-xs text-slate-500">{labels.messagingProviders}</p></div>
      </header>
      <div className="mt-3 space-y-2">
        {displayProviders.map((provider) => {
          const pending = pendingProviderId === provider.id;
          const connected = provider.status === "connected";
          return <article key={provider.id} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#e9f8ef] text-[#07c160]"><FaWeixin className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-800">{provider.displayName}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500">
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : provider.status === "connecting" ? "bg-amber-400" : provider.status === "error" ? "bg-red-500" : "bg-slate-300"}`} />
                {statusLabel(provider)}
              </div>
            </div>
            <button type="button" disabled={pending || Boolean(pendingProviderId)} onClick={() => void changeConnection(provider)} className={`inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${connected ? "border border-slate-200 text-slate-600 hover:bg-slate-50" : "bg-[#2f65cf] text-white hover:bg-[#2457bd]"}`}>
              {pending ? <FiLoader className="h-3.5 w-3.5 animate-spin" /> : <FiPower className="h-3.5 w-3.5" />}
              {provider.configured ? connected ? labels.messagingDisconnect : labels.messagingConnect : labels.messagingConfigure}
            </button>
          </article>;
        })}
        {login?.qrDataUrl && new Set(["qr_pending", "scanned"]).has(login.state) ? <div className="flex flex-col items-center rounded-md border border-slate-200 bg-slate-50 p-4 text-center">
          <img src={login.qrDataUrl} alt={labels.messagingScanQr} width={180} height={180} className="h-[180px] w-[180px] rounded bg-white" />
          <div className="mt-3 text-xs font-medium text-slate-700">{login.state === "scanned" ? labels.messagingConfirmInWechat : labels.messagingScanQr}</div>
        </div> : null}
        {login?.state === "expired" ? <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{labels.messagingQrExpired}</p> : null}
        {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </div>
  </section>;
}
