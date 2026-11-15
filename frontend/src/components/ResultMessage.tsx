import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { RunView } from "../types";
import { JsonView } from "./JsonView";
import { LIVE, statusMeta, host } from "./status";

type Tab = "summary" | "json" | "pages" | "run";

function headline(run: RunView) {
  const d = run.result?.data;
  const n = d?.crawl?.pages_crawled ?? 0;
  const secs = ((run.result?.execution?.duration_ms ?? 0) / 1000).toFixed(1);
  const site = host(run.task?.url);
  switch (run.stage) {
    case "succeeded": return `Crawled ${n} page${n === 1 ? "" : "s"} of ${site} in ${secs}s.`;
    case "partial": return `Partial result: ${n} page${n === 1 ? "" : "s"} of ${site} came back, some didn't.`;
    case "cancelled": return n ? `Stopped. ${n} page${n === 1 ? "" : "s"} were fetched before the crawl was cancelled.` : "Stopped before any page was fetched.";
    default: return null;
  }
}

export function ResultMessage({ run, selected, onSelect, onAsk }: {
  run: RunView; selected: boolean; onSelect: () => void; onAsk?: (q: string) => void;
}) {
  const r = run.result;
  const live = LIVE.includes(run.stage) && !run.ended && !r;
  const wantsJson = r?.outputs?.includes("json") && !r?.outputs?.includes("summary");
  const [tab, setTab] = useState<Tab | null>(wantsJson ? "json" : null);
  const meta = statusMeta(run.stage);

  if (live) {
    return (
      <button onClick={onSelect} className="group flex items-center gap-3 text-[15px] text-graphite text-left">
        <span className="relative flex h-2 w-2"><span className="absolute h-full w-full rounded-full bg-cobalt opacity-60 animate-ping" /><span className="relative h-2 w-2 rounded-full bg-cobalt" /></span>
        <span>{run.stageLabel || "Starting"}{run.stage === "executing" ? `, ${Object.values(run.nodes).filter((n) => n.state === "done").length} pages so far` : ""}</span>
        <span className="text-cobalt opacity-0 group-hover:opacity-100 transition-opacity lg:hidden">View run</span>
      </button>
    );
  }

  if (!r) {
    return <p className="text-[15px] text-brick">{run.streamError ?? "The run ended without a result."}</p>;
  }

  if (["clarify", "unsupported", "rejected"].includes(r.state)) {
    return <p className="text-[16px] leading-relaxed max-w-[60ch]">{r.message}</p>;
  }

  const data = r.data;
  const hasPages = (data?.pages?.length ?? 0) > 0;
  const head = headline(run);
  const failed = ["failed", "timed_out"].includes(run.stage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
        {r.execution && (
          <button onClick={onSelect} className={`text-[13px] tabular-nums underline-offset-4 hover:underline ${selected ? "text-ink" : "text-graphite"}`}>
            {`exit ${r.execution.exit_code}, pid ${r.execution.pid}`}
          </button>
        )}
      </div>

      {failed ? (
        <div className="max-w-[62ch]">
          <p className="text-[17px] leading-relaxed">{r.message}</p>
          {r.error && <p className="mt-2 font-mono text-[12.5px] text-brick break-words">{r.error}</p>}
          <p className="mt-3 text-[14.5px] text-graphite">
            {run.result?.execution?.exit_code === 5 ? "Use a public http or https address. Private, local and cloud-metadata addresses are blocked on purpose."
              : run.result?.execution?.exit_code === 4 ? "This site asks crawlers not to visit that path. Try its homepage or a different site."
              : "Check the address and try again, or ask for fewer pages."}
          </p>
        </div>
      ) : null}

      {!failed && <Answer run={run} onAsk={onAsk} />}
      {!failed && head && <p className="text-[13.5px] text-graphite">{head}</p>}

      {r.warning && <p className="text-[13px] text-ochre">{r.warning}</p>}

      {hasPages && (
        <>
          <div role="tablist" className="relative inline-flex gap-1 p-1 rounded-xl bg-sheet border border-rule">
            {(["summary", "json", "pages", "run"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(tab === t ? null : t)}
                className={`relative h-8 px-3.5 rounded-lg text-[13.5px] transition-colors ${tab === t ? "text-ink" : "text-graphite hover:text-ink"}`}>
                {tab === t && <motion.span layoutId={`tab-${run.id}`} className="absolute inset-0 rounded-lg bg-fog border border-rule" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="relative">{{ summary: "Overview", json: "JSON", pages: "Pages", run: "Execution" }[t]}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {tab && <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {tab === "summary" && <SummaryTab run={run} />}
              {tab === "json" && <JsonView data={data} filename={`${host(run.task?.url) || "sitescout"}.json`} />}
              {tab === "pages" && <PagesTab pages={data!.pages} />}
              {tab === "run" && <ExecutionTab run={run} />}
            </motion.div>}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}

/** Render the model's answer: plain sentences plus optional "- " list items. Text only, never HTML. */
function AnswerText({ text }: { text: string }) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks: { kind: "p" | "li"; text: string }[] = lines.map((l) =>
    /^[-*\u2022]\s+/.test(l) || /^\d+[.)]\s+/.test(l) ? { kind: "li", text: l.replace(/^([-*\u2022]|\d+[.)])\s+/, "") } : { kind: "p", text: l });
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(<ul key={"u" + out.length} className="mt-2 space-y-1.5 font-sans text-[15.5px] leading-relaxed">
        {list.map((t, i) => <li key={i} className="flex gap-3"><span className="mt-[10px] h-[5px] w-[5px] shrink-0 rounded-full bg-ink" />{t}</li>)}
      </ul>);
      list = [];
    }
  };
  blocks.forEach((b) => {
    if (b.kind === "li") list.push(b.text);
    else { flush(); out.push(<p key={"p" + out.length} className={out.length ? "mt-2" : ""}>{b.text}</p>); }
  });
  flush();
  return <>{out}</>;
}

function Answer({ run, onAsk }: { run: RunView; onAsk?: (q: string) => void }) {
  const ins = run.result?.summary ?? run.result?.data?.insights;
  if (!ins) return null;
  const answer = ins.answer || ins.summary;
  const pages: any[] = run.result?.data?.pages ?? [];
  const titleOf = (u: string) => pages.find((p) => p.url === u)?.title || (() => { try { const x = new URL(u); return x.pathname === "/" ? x.hostname : x.pathname; } catch { return u; } })();
  return (
    <section className="max-w-[64ch]" aria-label="Answer">
      <div className="font-serif text-[19px] leading-[1.6] text-ink"><AnswerText text={answer} /></div>
      {ins.answer_found === false && (
        <p className="mt-3 text-[13.5px] text-ochre">The crawled pages didn't contain a complete answer. Try pointing me at a more specific page, or ask for more pages.</p>
      )}
      {ins.sources?.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="text-graphite mr-1">From</span>
          {ins.sources.map((u: string) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" title={u}
              className="max-w-[32ch] truncate px-2.5 h-7 inline-flex items-center rounded-full border border-rule bg-sheet text-graphite hover:text-cobalt hover:border-cobalt/40 transition-colors">
              {titleOf(u)}
            </a>
          ))}
        </div>
      )}
      {onAsk && ins.follow_ups?.length > 0 && (
        <div className="mt-5 border-t border-rule">
          {ins.follow_ups.map((q: string) => (
            <button key={q} onClick={() => onAsk(q)}
              className="w-full text-left py-2.5 border-b border-rule text-[14.5px] text-graphite hover:text-ink transition-colors">
              {q}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function SummaryTab({ run }: { run: RunView }) {
  const ins = run.result?.data?.insights;
  const site = run.result?.data?.site;
  if (!ins) return <p className="text-graphite">No summary was requested.</p>;
  return (
    <article className="max-w-[64ch]">
      <p className="font-serif text-[18px] leading-[1.6] text-ink">{ins.summary}</p>
      {ins.key_points?.length > 0 && (
        <ul className="mt-5 space-y-2 text-[15px] leading-relaxed">
          {ins.key_points.map((k: string, i: number) => (
            <li key={i} className="flex gap-3"><span className="mt-[10px] h-[5px] w-[5px] shrink-0 rounded-full bg-ink" />{k}</li>
          ))}
        </ul>
      )}
      <dl className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-3 text-[14px]">
        {ins.site_type && <div><dt className="text-graphite">Kind of site</dt><dd>{ins.site_type}</dd></div>}
        {ins.audience && <div><dt className="text-graphite">Made for</dt><dd>{ins.audience}</dd></div>}
        {site?.contact?.emails?.length > 0 && <div><dt className="text-graphite">Email</dt><dd className="break-all">{site.contact.emails.slice(0, 3).join(", ")}</dd></div>}
        {Object.keys(site?.social_links ?? {}).length > 0 && (
          <div><dt className="text-graphite">Social</dt><dd>{Object.keys(site.social_links).join(", ")}</dd></div>
        )}
      </dl>
      {ins.topics?.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {ins.topics.map((t: string) => <span key={t} className="px-2.5 h-7 inline-flex items-center rounded-full border border-rule text-[13px] text-graphite">{t}</span>)}
        </div>
      )}
      <p className="mt-6 text-[12.5px] text-graphite">
        {ins.generated_by === "llm" ? "Written by the summary model from the crawled text only." : "Model unavailable, so this summary was extracted directly from the pages."}
        {run.result?.data?.security?.prompt_injection_suspected_on?.length ? ` ${run.result.data.security.prompt_injection_suspected_on.length} page(s) contained text that looked like instructions to an AI; it was treated as data.` : ""}
      </p>
    </article>
  );
}

function PagesTab({ pages }: { pages: any[] }) {
  return (
    <ol className="divide-y divide-rule border-y border-rule">
      {pages.map((p, i) => (
        <li key={p.url} className="py-3 grid grid-cols-[2.5ch_1fr_auto] gap-3 items-baseline">
          <span className="text-graphite tabular-nums text-[13px]">{i + 1}</span>
          <div className="min-w-0">
            <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium hover:text-cobalt truncate block">{p.title || p.url}</a>
            <div className="text-[13px] text-graphite truncate">{p.url}</div>
            {p.headings?.length > 0 && <div className="mt-1 text-[13.5px] text-graphite line-clamp-1">{p.headings.slice(0, 4).join("  /  ")}</div>}
          </div>
          <span className="text-[13px] tabular-nums text-graphite">{p.word_count} words</span>
        </li>
      ))}
    </ol>
  );
}

function ExecutionTab({ run }: { run: RunView }) {
  const e = run.result?.execution;
  if (!e) return null;
  return (
    <div className="space-y-4 text-[14px]">
      <div className="rounded-xl bg-console text-[#D9DEE7] font-mono text-[12.5px] px-4 py-3 break-all"><span className="text-[#5E6B85]">$ </span>{e.command}</div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><dt className="text-graphite">Exit code</dt><dd className="tabular-nums font-medium">{e.exit_code}</dd></div>
        <div><dt className="text-graphite">Status</dt><dd className="font-medium">{e.status}</dd></div>
        <div><dt className="text-graphite">Runtime</dt><dd className="tabular-nums font-medium">{e.duration_ms} ms</dd></div>
        <div><dt className="text-graphite">Output schema</dt><dd className="font-medium">{e.output_valid ? "sitecrawl.result/v1" : "rejected"}</dd></div>
      </dl>
      {e.stderr_tail && e.stderr_tail.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-graphite hover:text-ink">Last lines of stderr</summary>
          <pre className="mt-2 rounded-xl bg-console text-[#AEB6C4] font-mono text-[11.5px] leading-[1.6] px-4 py-3 overflow-auto max-h-64 console-scroll">{e.stderr_tail.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
