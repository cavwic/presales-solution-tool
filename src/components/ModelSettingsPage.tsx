import { useEffect } from "react";

// Keep older bookmarks working. Settings now live inside the workbench.
export default function ModelSettingsPage() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const href = `${base}/?model-settings=open`;
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("return");
    const destination = new URL(requested?.startsWith("/") && !requested.startsWith("//") ? requested : `${base}/`, window.location.origin);
    destination.searchParams.set("model-settings", "open");
    window.location.replace(`${destination.pathname}${destination.search}${destination.hash}`);
  }, []);
  return <p><a href={href}><span data-i18n="zh">返回工作台设置模型</span><span data-i18n="en">Set up models in the workbench</span></a></p>;
}