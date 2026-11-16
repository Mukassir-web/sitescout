import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus } from "lucide-react";
import { Logo } from "./chrome";

/** Animated preview of the app. Scripted from the event names and fields the real CLI emits. */
const PROMPT = "Crawl books.toscrape.com and tell me what it sells, with JSON";
const PAGES = [
  { path: "/", a: 0 },
  { path: "/catalogue/category/books/travel_2/", a: 20 },
  { path: "/catalogue/category/books/mystery_3/", a: 70 },
  { path: "/catalogue/page-2.html", a: 125 },
  { path: "/catalogue/category/books/poetry_23/", a: 175 },
  { path: "/catalogue/a-light-in-the-attic_1000/", a: 230 },
  { path: "/catalogue/category/books/fiction_10/", a: 285 },
  { path: "/catalogue/category/books/history_32/", a: 330 },
];
const TICK = 100;
const LOOP = 150; // 15 s

const STAGES = [
  { at: 12, label: "Interpreting" },
  { at: 20, label: "Validated" },
  { at: 26, label: "Running sitecrawl" },
  { at: 78, label: "Summarising" },
  { at: 92, label: "Done · exit 0" },
];

function consoleLines(t: number) {
  const out: { k: string; text: string; tone?: string }[] = [];
  if (t >= 26) out.push({ k: "cmd", text: "$ sitecrawl crawl --url https://books.toscrape.com --max-pages 8 --depth 1", tone: "text-white" });
  if (t >= 30) out.push({ k: "rb", text: '{"level":"info","event":"robots_loaded"}', tone: "text-white/60" });
  PAGES.forEach((p, i) => {
    const at = 34 + i * 5;
    if (t >= at) out.push({ k: "p" + i, text: `{"event":"page_done","url":"${p.path}"}`, tone: "text-[#B9E3C6]" });
  });
  if (t >= 76) out.push({ k: "exit", text: "process exited · code 0", tone: "text-[#9DB0FF]" });
  return out.slice(-7);
}

export function DemoWindow() {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setT(110); return; }
    const id = setInterval(() => setT((x) => (x + 1) % LOOP), TICK);
    return () => clearInterval(id);
  }, []);

  const typed = PROMPT.slice(0, Math.max(0, Math.min(PROMPT.length, Math.floor(t * 6))));
  const stage = [...STAGES].reverse().find((s) => t >= s.at);
  const shown = PAGES.filter((_, i) => t >= 34 + i * 5);
  const answer = t >= 92;
  const lines = consoleLines(t);
  const done = t >= 92;

  return (
    <div className="relative rounded-xl border border-border-default bg-white shadow-[0_30px_80px_-30px_rgb(0_0_0/.25)] overflow-hidden text-left">
      {/* window bar */}
      <div className="h-10 flex items-center gap-3 px-4 border-b border-border-default bg-bg-subtle">
        <span className="flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-black/10" />)}</span>
        <span className="mx-auto font-mono text-[11px] text-text-muted truncate min-w-0">sitescout-wz36.onrender.com/app</span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">preview</span>
      </div>

      <div className="grid md:grid-cols-[170px_minmax(0,1fr)] lg:grid-cols-[170px_minmax(0,1fr)_300px] h-[440px]">
        {/* sidebar */}
        <aside className="hidden md:flex flex-col border-r border-border-default p-3 gap-1 bg-[#fcfcfb]">
          <div className="flex items-center gap-2 px-1 mb-2"><Logo size={18} /><span className="text-[12.5px] font-semibold">SiteScout</span></div>
          <span className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-border-default text-[11.5px]"><Plus size={12} />New chat</span>
          <span className="mt-3 px-2 font-mono text-[9.5px] uppercase tracking-wider text-text-subtle">Chats</span>
          {[t >= 4 ? "books.toscrape.com and tell me…" : null, "Largest country on scrapethissite", "Most quoted authors"].filter(Boolean).map((c, i) => (
            <span key={c} className={`h-7 px-2 flex items-center rounded-md text-[11.5px] truncate ${i === 0 && t >= 4 ? "bg-black/[.05] text-text-primary" : "text-text-muted"}`}>{c}</span>
          ))}
        </aside>

        {/* conversation */}
        <div className="flex flex-col min-w-0 p-5 gap-4 overflow-hidden">
          <div className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-[#0a0a0a] text-white px-3.5 py-2.5 text-[13px] leading-snug min-h-[40px]">
            {typed}{t < 12 && <span className="caret">▍</span>}
          </div>
          {stage && (
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <span className={`size-1.5 rounded-full ${done ? "bg-moss" : "bg-cobalt animate-pulse"}`} />
              <span className="font-mono text-[11px] uppercase tracking-wider">{stage.label}</span>
              {t >= 26 && <span className="font-mono text-[11px] text-text-subtle">pid 418 · {Math.min(shown.length, 8)}/8 pages</span>}
            </div>
          )}
          <AnimatePresence>
            {answer && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-xl border border-border-default p-4">
                <p className="text-[13.5px] leading-[1.55]">
                  It's a demo bookstore built for scraping practice: <b className="font-semibold">1,000 books</b> across <b className="font-semibold">50 categories</b>, listed 20 to a page with price, star rating and stock.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {["/", "/catalogue/page-2.html", "/travel_2/"].map((s) => (
                    <span key={s} className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border border-border-default text-text-secondary">{s}</span>
                  ))}
                </div>
                <pre className="mt-3 rounded-lg bg-[#16191F] text-[10.5px] leading-[1.6] p-3 font-mono overflow-hidden">
                  <span className="json-key">"schema"</span><span className="text-white/50">: </span><span className="json-str">"sitecrawl.result/v1"</span>{",\n"}
                  <span className="json-key">"pages_crawled"</span><span className="text-white/50">: </span><span className="json-num">8</span>{",\n"}
                  <span className="json-key">"exit_code"</span><span className="text-white/50">: </span><span className="json-num">0</span>
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* inspector */}
        <div className="hidden lg:flex flex-col border-l border-border-default min-h-0">
          <div className="px-4 pt-3 flex items-center justify-between">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-text-subtle">Crawl map</span>
            <span className="font-mono text-[9.5px] text-text-subtle">{shown.length} nodes</span>
          </div>
          <svg viewBox="-110 -110 220 220" className="h-[210px] w-full dotgrid">
            <circle r="86" fill="none" stroke="#e5e5e5" strokeDasharray="2 4" />
            <circle r="48" fill="none" stroke="#e5e5e5" strokeDasharray="2 4" />
            {shown.slice(1).map((p, i) => {
              const r = i % 2 ? 86 : 48, a = (p.a * Math.PI) / 180;
              const x = Math.cos(a) * r, y = Math.sin(a) * r;
              const src = answer && i < 2;
              return (
                <g key={p.path}>
                  <motion.line x1={0} y1={0} x2={x} y2={y} stroke="#d4d4d4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
                  {src && <circle cx={x} cy={y} r={9} fill="none" stroke="var(--color-cobalt)" strokeOpacity=".35" strokeWidth="3" />}
                  <motion.circle cx={x} cy={y} r={4.5} fill={src ? "var(--color-cobalt)" : "#1a1a1a"} initial={{ scale: 0 }} animate={{ scale: 1 }} />
                </g>
              );
            })}
            {shown.length > 0 && <circle r="7" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />}
          </svg>
          <div className="mt-auto m-3 rounded-lg bg-[#16191F] p-3 h-[170px] overflow-hidden font-mono text-[10px] leading-[1.7]">
            <div className="text-white/40 mb-1">stderr · json-lines</div>
            {lines.map((l) => <motion.div key={l.k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`truncate ${l.tone ?? ""}`}>{l.text}</motion.div>)}
          </div>
        </div>
      </div>
    </div>
  );
}
