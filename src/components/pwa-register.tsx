"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaRegister() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The app remains fully usable online if a browser blocks service workers.
      });
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => { setInstallEvent(null); setDismissed(true); };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installEvent) return;
    setInstalling(true);
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstalling(false);
    setInstallEvent(null);
  }

  if (!installEvent || dismissed) return null;
  return <aside className="pwa-install-prompt" role="dialog" aria-label="Install SHV POS">
    <img src="/icons/shv-pos-192.png" alt="" />
    <div><strong>Install SHV POS</strong><span>Use it like an app from your home screen.</span></div>
    <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss install prompt">×</button>
    <button className="primary" type="button" onClick={install} disabled={installing}>{installing ? "Opening…" : "Install"}</button>
  </aside>;
}
