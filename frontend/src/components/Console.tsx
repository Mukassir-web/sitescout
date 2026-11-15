import { useEffect, useRef } from "react";
import type { LogEvent } from "../types";

function short(url?: string) {
  if (!url) return "";
  try { const u = new URL(url); return (u.pathname + u.search) || "/"; } catch { return url; }
}

function line(e: LogEvent): { tone: string; text: string } | null {
  switch (e.event) {
    case "crawl_start": return { tone: "text-[#9DB0FF]", text: `start  ${e.url}  pages<=${e.max_pages} depth<=${e.depth} budget ${e.timeout}s` };
    case "robots_loaded": return { tone: "text-[#8B93A1]", text: `robots.txt found, rules applied` };
    case "robots_unavailable": return { tone: "text-[#8B93A1]", text: `robots.txt ${String(e.reason ?? "unavailable").toLowerCase()}, no restrictions` };
    case "fetch_start": return { tone: "text-[#8B93A1]", text: `GET    ${short(e.url)}` };
    case "page_done": return { tone: "text-[#D9DEE7]", text: `${e.status}    ${short(e.url)}  ${e.ms}ms  ${e.words}w` };
    case "fetch_failed": return { tone: "text-[#F29C8A]", text: `fail   ${short(e.url)}  ${e.message}` };
    case "page_truncated": return { tone: "text-[#F2C77C]", text: `trunc  ${short(e.url)}  over size limit` };
    case "crawl_timeout": return { tone: "text-[#F2C77C]", text: `budget exhausted after ${e.seconds}s` };
    case "crawl_cancelled": return { tone: "text-[#F2C77C]", text: `cancelled by caller, flushing partial result` };
    case "cancel_requested": return { tone: "text-[#F2C77C]", text: `SIGTERM sent to process group` };
    case "wall_timeout": return { tone: "text-[#F29C8A]", text: `wall-clock limit ${e.seconds}s hit, process killed` };
    case "invalid_input": case "unreachable": case "crawl_failed": return { tone: "text-[#F29C8A]", text: `error  ${e.message}` };
    case "crawl_end": return { tone: e.exit_code === 0 ? "text-[#8FD3A8]" : "text-[#F2C77C]", text: `exit ${e.exit_code}  ${e.status}  ${e.pages} pages in ${e.ms}ms` };
    case "page_discarded": return { tone: "text-[#8B93A1]", text: `skip   ${short(e.url)}  page limit reached` };
    case "crawl_plan": {
      const terms = (e.focus_terms as string[] | undefined) ?? [];
      return { tone: "text-[#8B93A1]", text: `plan   scope ${e.scope}${terms.length ? `  rank: ${terms.join(", ")}` : ""}` };
    }
    case "rate_limited": return { tone: "text-[#F2C77C]", text: `429    ${short(e.url)}  rate limited, retrying in ${e.retry_in_s}s` };
    case "link_queued": return null;
    default: return { tone: "text-[#8B93A1]", text: `${e.event} ${e.message ?? ""}` };
  }
}

export function Console({ logs, command, live }: { logs: LogEvent[]; command?: string; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [logs.length]);
  return (
    <div className="rounded-xl bg-console text-[12px] font-mono leading-[1.7] overflow-hidden">
      <div ref={ref} className="console-scroll max-h-56 overflow-auto px-4 py-3" role="log" aria-live="off">
        {command && <div className="text-[#D9DEE7] whitespace-pre-wrap break-all"><span className="text-[#5E6B85] select-none">$ </span>{command}</div>}
        {logs.map((e, i) => {
          const l = line(e);
          if (!l) return null;
          return (
            <div key={i} className={`${l.tone} whitespace-pre overflow-hidden text-ellipsis`}>
              <span className="text-[#5E6B85] select-none tabular-nums">{(e.t ?? 0).toFixed(2).padStart(6, " ")} </span>{l.text}
            </div>
          );
        })}
        {live && <div className="text-[#9DB0FF]"><span className="inline-block w-[7px] h-[13px] align-[-2px] bg-[#9DB0FF] animate-pulse" /></div>}
        {!command && !logs.length && !live && <div className="text-[#5E6B85]">Waiting for a command.</div>}
      </div>
    </div>
  );
}
