import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Menu, Plus, Trash2 } from "lucide-react";
import { startRun, cancelRun, subscribe, historyOf } from "./api";
import type { Chat, CrawlNode, RunView } from "./types";
import { Composer } from "./components/Composer";
import { Inspector } from "./components/Inspector";
import { ResultMessage } from "./components/ResultMessage";
import { LIVE, host } from "./components/status";
import { linkTo } from "./site/router";

const EXAMPLES = [
  "Crawl https://books.toscrape.com, extract the important information, give me a summary, and return the extracted data in JSON format.",
  "Which authors are quoted most on quotes.toscrape.com, and what are their best-known quotes?",
  "Summarise python.org and pull out any contact details.",
];
const STORE = "sitescout.chats.v2";
const ACTIVE = "sitescout.active.v2";
const LEGACY = "sitescout.runs.v1";
const spring = { type: "spring" as const, stiffness: 380, damping: 34 };
const uid = () => Math.random().toString(36).slice(2, 10);
const titleOf = (prompt: string) => {
  const t = prompt.replace(/https?:\/\//g, "").replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 47) + "\u2026" : t;
};

function loadChats(): Chat[] {
  try {
    const chats = JSON.parse(localStorage.getItem(STORE) || "null") as Chat[] | null;
    if (chats) return chats.map((c) => ({ ...c, runs: c.runs.filter((r) => r.ended) }));
    const legacy = JSON.parse(localStorage.getItem(LEGACY) || "[]") as RunView[];
    const runs = legacy.filter((r) => r.ended);
    return runs.length ? [{ id: uid(), title: titleOf(runs[0].prompt), createdAt: runs[0].createdAt, runs }] : [];
  } catch { return []; }
}

/**
 * One map per site for the whole chat. The current question's crawl is drawn as usual; pages that
 * earlier questions reached (and this one didn't) stay on the map in grey, hung off the current start page.
 */
function mergeSiteNodes(runs: RunView[], current: RunView | null): Record<string, CrawlNode> | undefined {
  if (!current || Object.keys(current.nodes).length === 0) return undefined;
  const h = host(current.task?.url);
  const idx = runs.findIndex((r) => r.id === current.id);
  const earlier = runs.slice(0, idx).filter((r) => host(r.task?.url) === h);
  if (earlier.length === 0) return undefined;
  const out: Record<string, CrawlNode> = { ...current.nodes };
  const root = Object.values(current.nodes).find((n) => n.depth === 0)?.url ?? null;
  let order = Math.max(0, ...Object.values(out).map((n) => n.order)) + 1;
  earlier.forEach((r) => {
    Object.values(r.nodes).sort((a, b) => a.order - b.order).forEach((n) => {
      if (out[n.url] || n.state !== "done" || !root) return;
      const parentKnown = n.parent && out[n.parent] && out[n.parent].depth < 2;
      const parent = parentKnown ? n.parent! : root;
      out[n.url] = { ...n, parent, depth: out[parent].depth + 1, order: order++, prior: true };
    });
  });
  return out;
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE));
  const active = chats.find((c) => c.id === activeId) ?? null;
  const runs = active?.runs ?? [];
  const [selected, setSelected] = useState<string | null>(() => runs.at(-1)?.id ?? null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const subs = useRef<Record<string, () => void>>({});
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const follow = useRef(true);

  useEffect(() => {
    const keep = chats.map((c) => ({ ...c, runs: c.runs.filter((r) => r.ended).slice(-20).map((r) => ({ ...r, logs: r.logs.slice(-120) })) }))
      .filter((c) => c.runs.length > 0).slice(-30);
    try { localStorage.setItem(STORE, JSON.stringify(keep)); localStorage.removeItem(LEGACY); } catch { /* storage full */ }
  }, [chats]);
  useEffect(() => { if (activeId) localStorage.setItem(ACTIVE, activeId); else localStorage.removeItem(ACTIVE); }, [activeId]);
  useEffect(() => () => Object.values(subs.current).forEach((u) => u()), []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [runs.length, runs.at(-1)?.result]);
  useEffect(() => { setSelected(runsRef.current.at(-1)?.id ?? null); follow.current = false; }, [activeId]);

  const busy = runs.some((r) => LIVE.includes(r.stage) && !r.ended);
  const current = useMemo(() => runs.find((r) => r.id === selected) ?? runs.at(-1) ?? null, [runs, selected]);
  const siteNodes = useMemo(() => mergeSiteNodes(runs, current), [runs, current]);

  // the inspector follows whichever answer is on screen (a live run always wins)
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const ratios = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => ratios.set((e.target as HTMLElement).dataset.run!, e.intersectionRatio * e.boundingClientRect.height));
      if (runsRef.current.some((r) => !r.ended) || !follow.current) return;
      let best: string | null = null, bestV = 0;
      ratios.forEach((v, k) => { if (v > bestV) { bestV = v; best = k; } });
      if (best) setSelected(best);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    root.querySelectorAll("[data-run]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [runs.length, activeId]);

  const patchRun = useCallback((id: string, fn: (r: RunView) => RunView) =>
    setChats((cs) => cs.map((c) => (c.runs.some((r) => r.id === id) ? { ...c, runs: c.runs.map((r) => (r.id === id ? fn(r) : r)) } : c))), []);

  const submit = useCallback(async (text?: string, fresh = false) => {
    const prompt = (text ?? draft).trim();
    if (!prompt) return;
    setError(null);
    setDraft("");
    try {
      const id = await startRun(prompt, fresh ? [] : historyOf(runsRef.current));
      const run: RunView = { id, prompt, createdAt: Date.now(), stage: "queued", stageLabel: "Queued", logs: [], nodes: {}, ended: false };
      let chatId = !fresh && activeId && chats.some((c) => c.id === activeId) ? activeId : null;
      if (!chatId) {
        chatId = uid();
        const fresh: Chat = { id: chatId, title: titleOf(prompt), createdAt: Date.now(), runs: [run] };
        setChats((cs) => [...cs, fresh]);
        setActiveId(chatId);
      } else {
        const cid = chatId;
        setChats((cs) => cs.map((c) => (c.id === cid ? { ...c, runs: [...c.runs, run] } : c)));
      }
      setSelected(id);
      follow.current = false;
      subs.current[id] = subscribe(id, (fn) => patchRun(id, fn));
    } catch (e) {
      setDraft(prompt);
      setError(e instanceof Error ? e.message : "Couldn't start the run.");
    }
  }, [draft, activeId, chats, patchRun]);

  const fromLanding = useRef(false);
  useEffect(() => {
    if (fromLanding.current) return;
    fromLanding.current = true;
    const q = new URLSearchParams(location.search).get("q");
    if (q) { history.replaceState(null, "", "/app"); submit(q, true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => { setActiveId(null); setSelected(null); setDraft(""); setDrawer(false); };
  const openChat = (id: string) => { setActiveId(id); setDrawer(false); };
  const removeChat = (id: string) => {
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };
  const renameChat = (id: string, title: string) =>
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title: title.trim() || c.title } : c)));
  const empty = runs.length === 0;
  const sidebar = (
    <ChatList chats={chats} activeId={activeId} busy={busy} onNew={newChat} onOpen={openChat} onRemove={removeChat} onRename={renameChat} />
  );

  return (
    <div className="grain relative h-dvh overflow-hidden">
      <div className="relative z-10 h-full grid grid-rows-[100%] lg:grid-cols-[232px_minmax(0,1fr)_440px] md:grid-cols-[232px_minmax(0,1fr)]">
        {/* chats */}
        <nav className="hidden md:flex h-full min-h-0 flex-col border-r border-rule" aria-label="Chats">{sidebar}</nav>

        {/* conversation */}
        <main className="relative h-full min-h-0 flex flex-col min-w-0">
          <header className="flex items-center gap-3 px-6 lg:px-10 h-16 shrink-0">
            <button onClick={() => setDrawer(true)} className="md:hidden -ml-2 h-9 w-9 grid place-items-center rounded-lg hover:bg-sheet" aria-label="Open chats"><Menu size={18} /></button>
            <span className="md:hidden flex items-center gap-2"><Logo /><span className="text-[15px] font-semibold tracking-[-0.01em]">SiteScout</span></span>
            <span className="hidden md:block text-[14px] text-graphite truncate">{active?.title ?? "New chat"}</span>
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
                <div ref={scroller} className="flex-1 overflow-y-auto scroll-quiet"
                  onWheel={() => { follow.current = true; }} onTouchMove={() => { follow.current = true; }}
                  onKeyDown={(e) => { if (["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) follow.current = true; }}>
                  <div className="max-w-[760px] mx-auto px-6 lg:px-10 py-6 space-y-12">
                    {runs.map((run) => (
                      <motion.article key={run.id} data-run={run.id} layout="position" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                        <p className="text-[21px] leading-snug font-medium tracking-[-0.015em] max-w-[52ch]">{run.prompt}</p>
                        <div className="mt-5">
                          <ResultMessage run={run} selected={selected === run.id}
                            onSelect={() => { setSelected(run.id); follow.current = false; setSheet(true); }}
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
        <aside className="hidden lg:block h-full min-h-0 overflow-hidden border-l border-rule bg-sheet/60 backdrop-blur-[2px]" aria-label="Run inspector">
          <Inspector run={current} onCancel={cancelRun} siteNodes={siteNodes} />
        </aside>
      </div>

      {/* chats, mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <motion.div className="md:hidden fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setDrawer(false)} />
            <motion.div className="absolute inset-y-0 left-0 w-[280px] bg-fog border-r border-rule flex flex-col"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={spring}>{sidebar}</motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* run inspector, mobile sheet */}
      <AnimatePresence>
        {sheet && current && (
          <motion.div className="lg:hidden fixed inset-0 z-30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setSheet(false)} />
            <motion.div className="absolute inset-x-0 bottom-0 max-h-[88%] h-[88%] rounded-t-3xl bg-sheet border-t border-rule"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={spring}>
              <button onClick={() => setSheet(false)} aria-label="Close" className="absolute right-4 top-4 h-9 w-9 grid place-items-center rounded-full hover:bg-fog z-10"><X size={18} /></button>
              <Inspector run={current} onCancel={cancelRun} siteNodes={siteNodes} />
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

function ChatList({ chats, activeId, busy, onNew, onOpen, onRemove, onRename }: {
  chats: Chat[]; activeId: string | null; busy: boolean;
  onNew: () => void; onOpen: (id: string) => void; onRemove: (id: string) => void; onRename: (id: string, t: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const sorted = [...chats].sort((a, b) => (b.runs.at(-1)?.createdAt ?? b.createdAt) - (a.runs.at(-1)?.createdAt ?? a.createdAt));
  return (
    <>
      <a href="/" onClick={linkTo("/")} className="flex items-center gap-2.5 px-5 h-16 shrink-0" title="SiteScout home">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">SiteScout</span>
      </a>
      <div className="px-3">
        <button onClick={onNew} disabled={busy}
          className="w-full inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-rule bg-sheet text-[13.5px] hover:border-ink/40 transition-colors disabled:opacity-50">
          <Plus size={15} />New chat
        </button>
      </div>
      <h2 className="px-5 mt-5 mb-1.5 text-[12.5px] text-graphite">Chats</h2>
      <ul className="flex-1 min-h-0 overflow-y-auto scroll-quiet px-2 pb-4 space-y-0.5">
        {sorted.length === 0 && <li className="px-3 py-2 text-[13px] text-graphite">Your chats will be listed here.</li>}
        {sorted.map((c) => (
          <li key={c.id} className={`group relative rounded-lg ${c.id === activeId ? "bg-sheet" : "hover:bg-sheet/60"}`}>
            {editing === c.id ? (
              <input autoFocus defaultValue={c.title} aria-label="Rename chat"
                className="w-full h-9 px-3 rounded-lg bg-sheet border border-cobalt text-[13.5px] outline-none"
                onBlur={(e) => { onRename(c.id, e.currentTarget.value); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(null); }} />
            ) : (
              <button onClick={() => onOpen(c.id)} onDoubleClick={() => setEditing(c.id)} title="Double-click to rename"
                className={`w-full text-left h-9 pl-3 pr-8 truncate text-[13.5px] ${c.id === activeId ? "text-ink" : "text-graphite group-hover:text-ink"}`}>
                {c.title}
              </button>
            )}
            {editing !== c.id && (
              <button onClick={() => onRemove(c.id)} aria-label={`Delete chat ${c.title}`}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 grid place-items-center rounded-md text-graphite opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-brick transition-opacity">
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
