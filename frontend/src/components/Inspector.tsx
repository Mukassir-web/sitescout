import { motion } from "motion/react";
import { Square } from "lucide-react";
import type { CrawlNode, RunView } from "../types";
import { CrawlMap } from "./CrawlMap";
import { Console } from "./Console";
import { LIVE, statusMeta, host } from "./status";

const STEPS = [
  { key: "interpreting", label: "Understand" },
  { key: "executing", label: "Execute" },
  { key: "processing", label: "Validate" },
  { key: "done", label: "Answer" },
];

function stepIndex(run: RunView) {
  if (run.ended || run.result) return 4;
  return { queued: 0, interpreting: 0, executing: 1, processing: 2 }[run.stage as string] ?? 3;
}

export function Inspector({ run, onCancel, siteNodes }: {
  run: RunView | null; onCancel: (id: string) => void; siteNodes?: Record<string, CrawlNode>;
}) {
  if (!run) {
    return (
      <div className="h-full flex flex-col justify-center px-8 text-graphite">
        <p className="font-serif text-[22px] leading-snug text-ink max-w-[30ch]">Every request runs a real crawler on the server.</p>
        <p className="mt-3 text-[14.5px] max-w-[42ch]">You'll see the command it launched, each page it fetched as it happens, the exit code, and the raw output before anything is summarised.</p>
      </div>
    );
  }
  const live = LIVE.includes(run.stage) && !run.ended;
  const meta = statusMeta(run.stage);
  const failedStep = !live && ["failed", "timed_out", "cancelled"].includes(run.stage);
  const badIndex = failedStep ? (run.command ? 1 : 0) : -1;
  const idx = failedStep ? badIndex : stepIndex(run);
  const exec = run.result?.execution;
  const planEv = run.logs.find((l) => l.event === "crawl_plan");
  const plan = planEv ? { scope: String(planEv.scope ?? "/"), terms: (planEv.focus_terms as string[] | undefined) ?? [] } : null;

  return (
    <div className="h-full overflow-y-auto scroll-quiet px-6 py-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px]" style={{ color: meta.color }}>
            <span className="relative flex h-2 w-2">
              {live && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: meta.color }} />}
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: meta.color }} />
            </span>
            {meta.label}
          </div>
          <h2 className="mt-1 text-[19px] font-semibold tracking-[-0.01em] truncate">{host(run.task?.url) || "New run"}</h2>
        </div>
        {live && run.stage === "executing" && (
          <button onClick={() => onCancel(run.id)}
            className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-rule bg-sheet text-[13px] hover:border-brick hover:text-brick transition-colors">
            <Square size={12} fill="currentColor" />Stop crawl
          </button>
        )}
      </div>

      <ol className="grid grid-cols-4 gap-2" aria-label="Pipeline progress">
        {STEPS.map((s, i) => {
          const done = i < idx;
          const active = i === idx && live;
          const bad = i === badIndex;
          return (
            <li key={s.key} className="text-[12.5px]">
              <div className="h-[3px] rounded-full bg-rule overflow-hidden">
                <motion.div className="h-full rounded-full"
                  style={{ background: bad ? "var(--color-brick)" : done ? "var(--color-ink)" : "var(--color-cobalt)" }}
                  initial={false} animate={{ width: done || bad ? "100%" : active ? "55%" : "0%" }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
              </div>
              <div className={`mt-2 ${done || active ? "text-ink" : "text-graphite"}`}>{s.label}</div>
            </li>
          );
        })}
      </ol>

      {run.task && run.task.action === "crawl_site" && (
        <section aria-label="Parsed task" className="text-[13.5px]">
          <h3 className="text-graphite mb-2">Task the model produced, after validation</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5">
            <dt className="text-graphite">Target</dt><dd className="truncate">{run.task.url}</dd>
            <dt className="text-graphite">Limits</dt><dd>up to {run.task.max_pages} pages, depth {run.task.depth}</dd>
            <dt className="text-graphite">Return</dt><dd>answer, {run.task.outputs.join(" and ")}</dd>
            {run.task.focus && <><dt className="text-graphite">Focus</dt><dd>{run.task.focus}</dd></>}
            {plan && <><dt className="text-graphite">Crawl plan</dt><dd>{planEv?.source ? `${String(planEv.source)}, ` : ""}stay inside {plan.scope}{plan.terms.length ? `, links about ${plan.terms.join(", ")} first` : ""}</dd></>}
            <dt className="text-graphite">Parsed by</dt><dd>{run.task.interpreted_by === "llm" ? "Groq model, schema-checked" : "rule-based fallback"}</dd>
          </dl>
        </section>
      )}

      {(Object.keys(run.nodes).length > 0 || (live && run.stage === "executing")) && (
        <section aria-label="Crawl map">
          <CrawlMap nodes={siteNodes ?? run.nodes} live={live && run.stage === "executing"} ended={run.ended}
            sources={run.result?.summary?.sources ?? run.result?.data?.insights?.sources ?? []} />
        </section>
      )}

      <section aria-label="Process output">
        <h3 className="text-graphite text-[13px] mb-2">Process output</h3>
        <Console logs={run.logs} command={run.command?.argv} live={live && run.stage === "executing"} />
        {exec && (
          <dl className="mt-3 grid grid-cols-4 gap-3 text-[12.5px]">
            <div><dt className="text-graphite">Exit code</dt><dd className="text-[15px] tabular-nums font-medium">{exec.exit_code ?? "none"}</dd></div>
            <div><dt className="text-graphite">PID</dt><dd className="text-[15px] tabular-nums font-medium">{exec.pid}</dd></div>
            <div><dt className="text-graphite">Runtime</dt><dd className="text-[15px] tabular-nums font-medium">{(exec.duration_ms / 1000).toFixed(2)}s</dd></div>
            <div><dt className="text-graphite">Output</dt><dd className="text-[15px] font-medium" style={{ color: exec.output_valid ? "var(--color-moss)" : "var(--color-brick)" }}>{exec.output_valid ? "Valid" : "Rejected"}</dd></div>
          </dl>
        )}
      </section>
    </div>
  );
}
