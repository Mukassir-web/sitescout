import type { Stage } from "../types";

export const LIVE: Stage[] = ["queued", "interpreting", "executing", "processing"];

export function statusMeta(stage: Stage): { label: string; color: string } {
  switch (stage) {
    case "queued": return { label: "Queued", color: "var(--color-graphite)" };
    case "interpreting": return { label: "Reading your request", color: "var(--color-cobalt)" };
    case "executing": return { label: "Crawler running", color: "var(--color-cobalt)" };
    case "processing": return { label: "Validating output", color: "var(--color-cobalt)" };
    case "succeeded": return { label: "Completed", color: "var(--color-moss)" };
    case "partial": return { label: "Partial result", color: "var(--color-ochre)" };
    case "timed_out": return { label: "Timed out", color: "var(--color-brick)" };
    case "cancelled": return { label: "Cancelled", color: "var(--color-ochre)" };
    case "rejected": return { label: "Nothing to run", color: "var(--color-graphite)" };
    default: return { label: "Failed", color: "var(--color-brick)" };
  }
}

export function host(url?: string | null) {
  if (!url) return "";
  try { return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return url; }
}
