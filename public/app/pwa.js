// The site as a phone app: service worker, "install" button and phone notifications (Web Push).
import { api } from "./common.js";

let installEvent = null;
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const canInstall = () => !!installEvent;

export function registerApp() {
  if (!("serviceWorker" in navigator)) return;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; dispatchEvent(new Event("moikas:installable")); });
  addEventListener("appinstalled", () => { installEvent = null; dispatchEvent(new Event("moikas:installed")); });
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

export async function installApp() {
  if (!installEvent) return false;
  installEvent.prompt();
  const r = await installEvent.userChoice.catch(() => null);
  installEvent = null;
  return r?.outcome === "accepted";
}

// "unsupported" | "ios-needs-install" | "denied" | "off" | "on"
export async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
const deviceLabel = () => {
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? "Android" : isIOS() ? "iPhone" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : "Linux";
  const br = /edg\//i.test(ua) ? "Edge" : /firefox/i.test(ua) ? "Firefox" : /chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "";
  return `${os}${br ? " · " + br : ""}${isStandalone() ? " (app)" : ""}`;
};

export async function enablePush() {
  const cfg = await api("/api/push");
  if (!cfg.configured) throw new Error("push-not-configured");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("push-denied");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.key) });
  await api("/api/push", { method: "POST", body: { action: "subscribe", endpoint: sub.endpoint, label: deviceLabel() } });
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api("/api/push", { method: "POST", body: { action: "unsubscribe", endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

// Admin helper: make a VAPID key pair in this browser (the private key never touches the server until you paste it into Cloudflare).
export async function makeVapidKeys() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", k.privateKey);
  const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { publicKey: b64u(raw), privateKey: jwk.d };
}
