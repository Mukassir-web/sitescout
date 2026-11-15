import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { startRun, cancelRun, subscribe, historyOf } from "./api";
import type { RunView } from "./types";
import { Composer } from "./components/Composer";
import { Inspector } from "./components/Inspector";
import { ResultMessage } from "./components/ResultMessage";
import { LIVE } from "./components/status";

const EXAMPLES = [
  "Crawl https://books.toscrape.com, extract the important information, give me a summary, and return the extracted data in JSON format.",
  "How many commits does github.com/Mukassir-web/sitescout have, and what are they?",
  "Summarise python.org and pull out any contact details.",
];
const STORE = "sitescout.runs.v1";
const spring = { type: "spring" as const, stiffness: 380, damping: 34 };

function loadRuns(): RunView[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "[]") as RunView[];
    return raw.filter((r) => r.ended).slice(-12);
  } catch { return []; }
}

export default function App() {
  const [runs, setRuns] = useState<RunView[]>(loadRuns);
  const [selected, setSelected] = useState<string | null>(() => runs.at(-1)?.id ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const subs = useRef<Record<string, () => void>>({});
  const runsRef = useRef(runs);
  runsRef.current = runs;

  useEffect(() => {
    const done = runs.filter((r) => r.ended).slice(-12).map((r) => ({ ...r, logs: r.logs.slice(-120) }));
    try { localStorage.setItem(STORE, JSON.stringify(done)); } catch { /* storage full: ignore */ }
  }, [runs]);
  useEffect(() => () => Object.values(subs.current).forEach((u) => u()), []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [runs.length, runs.at(-1)?.result]);

  const busy = runs.some((r) => LIVE.includes(r.stage) && !r.ended);
  const current = useMemo(() => runs.find((r) => r.id === selected) ?? null, [runs, selected]);

  const submit = useCallback(async (text?: string) => {
    const prompt = (text ?? draft).trim();
    if (!prompt) return;
    setError(null);
    setDraft("");
    try {
      const id = await startRun(prompt, historyOf(runsRef.current));
      const run: RunView = { id, prompt, createdAt: Date.now(), stage: "queued", stageLabel: "Queued", logs: [], nodes: {}, ended: false };
      setRuns((rs) => [...rs, run]);
      setSelected(id);
      subs.current[id] = subscribe(id, (fn) => setRuns((rs) => rs.map((r) => (r.id === id ? fn(r) : r))));
    } catch (e) {
      setDraft(prompt);
      setError(e instanceof Error ? e.message : "Couldn't start the run.");
    }
  }, [draft]);

  const clear = () => { setRuns([]); setSelected(null); localStorage.removeItem(STORE); };
  const empty = runs.length === 0;

  return (
    <div className="grain relative h-full">
      <div className="relative z-10 h-full grid lg:grid-cols-[minmax(0,1fr)_440px]">
        {/* conversation */}
        <main className="relative h-full flex flex-col min-w-0">
          <header className="flex items-center gap-3 px-6 lg:px-10 h-16 shrink-0">
            <Logo />
            <span className="text-[15px] font-semibold tracking-[-0.01em]">SiteScout</span>
            {!empty && (
              <button onClick={clear} className="ml-auto text-[13.5px] text-graphite hover:text-ink transition-colors">New conversation</button>
            )}
          </header>

          <AnimatePresence mode="wait" initial={false}>
            {empty ? (
              <motion.section key="empty" className="flex-1 flex flex-col justify-center px-6 lg:px-10 pb-16"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                <div className="w-full max-w-[720px] mx-auto">
                  <motion.h1 className="text-[clamp(34px,5vw,56px)] leading-[1.02] font-semibold tracking-[-0.035em] max-w-[16ch]"
                    initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
                    Name a website. Get back what's on it.
                  </motion.h1>
                  <motion.p className="mt-4 font-serif text-[19px] leading-[1.55] text-graphite max-w-[52ch]"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.6 }}>
                    Ask in plain English. A sandboxed crawler runs on the server, and you watch it work, then get a summary and clean JSON.
                  </motion.p>
                  <motion.div className="mt-8" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, ...spring }}>
                    <Composer value={draft} onChange={setDraft} onSubmit={() => submit()} busy={busy} autoFocus />
                    {error && <p role="alert" className="mt-3 text-[14px] text-brick">{error}</p>}
                  </motion.div>
                  <motion.ul className="mt-6 divide-y divide-rule border-y border-rule"
                    initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.06, delayChildren: 0.45 } } }}>
                    {EXAMPLES.map((ex) => (
                      <motion.li key={ex} variants={{ h: { opacity: 0 }, s: { opacity: 1 } }}>
                        <button onClick={() => submit(ex)} className="w-full text-left py-3 text-[14.5px] text-graphite hover:text-ink transition-colors">
                          {ex}
                        </button>
                      </motion.li>
                    ))}
                  </motion.ul>
                  <p className="mt-6 text-[13px] text-graphite">Public pages only. Respects robots.txt, blocks private networks, caps pages and time.</p>
                </div>
              </motion.section>
            ) : (
              <motion.section key="chat" className="flex-1 flex flex-col min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="flex-1 overflow-y-auto scroll-quiet">
                  <div className="max-w-[760px] mx-auto px-6 lg:px-10 py-6 space-y-12">
                    {runs.map((run) => (
                      <motion.article key={run.id} layout="position" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                        <p className="text-[21px] leading-snug font-medium tracking-[-0.015em] max-w-[52ch]">{run.prompt}</p>
                        <div className="mt-5">
                          <ResultMessage run={run} selected={selected === run.id}
                            onSelect={() => { setSelected(run.id); setSheet(true); }}
                            onAsk={busy ? undefined : (q) => submit(q)} />
                        </div>
                      </motion.article>
                    ))}
                    <div ref={bottom} />
                  </div>
                </div>
                <div className="shrink-0 px-6 lg:px-10 pb-5 pt-2">
                  <div className="max-w-[760px] mx-auto">
                    <Composer value={draft} onChange={setDraft} onSubmit={() => submit()} busy={busy} />
                    {error ? <p role="alert" className="mt-2 text-[13.5px] text-brick">{error}</p>
                      : <p className="mt-2 text-[12.5px] text-graphite">Enter to run, Shift+Enter for a new line.</p>}
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </main>

        {/* run inspector, desktop */}
        <aside className="hidden lg:block h-full border-l border-rule bg-sheet/60 backdrop-blur-[2px] min-h-0" aria-label="Run inspector">
          <Inspector run={current} onCancel={cancelRun} />
        </aside>
      </div>

      {/* run inspector, mobile sheet */}
      <AnimatePresence>
        {sheet && current && (
          <motion.div className="lg:hidden fixed inset-0 z-30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setSheet(false)} />
            <motion.div className="absolute inset-x-0 bottom-0 max-h-[88%] h-[88%] rounded-t-3xl bg-sheet border-t border-rule"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={spring}>
              <button onClick={() => setSheet(false)} aria-label="Close" className="absolute right-4 top-4 h-9 w-9 grid place-items-center rounded-full hover:bg-fog z-10"><X size={18} /></button>
              <Inspector run={current} onCancel={cancelRun} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-ink)" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--color-fog)" strokeWidth="1.6" strokeDasharray="2.4 3" />
      <circle cx="16" cy="16" r="3.2" fill="var(--color-cobalt)" />
      <circle cx="23.5" cy="11" r="2" fill="var(--color-fog)" />
      <circle cx="9" cy="21.5" r="2" fill="var(--color-fog)" />
    </svg>
  );
}
