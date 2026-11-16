import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Braces, FileSearch, Network, ShieldCheck, Table2, TerminalSquare } from "lucide-react";
import { Corners, CopyButton, Label, REPO, Reveal, SiteFooter, SiteNav } from "./chrome";
import { DemoWindow } from "./DemoWindow";
import { linkTo, navigate } from "./router";

const CLI = "python -m sitecrawl crawl --url https://books.toscrape.com --max-pages 8 --depth 1";

const SITES = ["books.toscrape.com", "quotes.toscrape.com", "scrapethissite.com", "python.org", "github.com/<repo>", "wikipedia.org", "news.ycombinator.com", "docs.python.org", "example.com", "your-site.dev"];

const FEATURES = [
  { icon: FileSearch, tag: "01 · Intent", title: "Plain English in", body: "Ask a question about any public site. A small model turns it into a strict TaskSpec. It can't invent URLs, flags or commands." },
  { icon: TerminalSquare, tag: "02 · Execution", title: "A real CLI process", body: "Each run starts sitecrawl as its own OS process from an argv list. No shell, no keys in its environment, hard time and page caps." },
  { icon: Network, tag: "03 · Live", title: "Watch it crawl", body: "Every stderr event streams over SSE into a live crawl map, a console and a reader view of the page being read right now." },
  { icon: Braces, tag: "04 · Output", title: "Answers and valid JSON", body: "The question gets answered first, with sources that were really crawled, plus a schema-checked JSON document you can copy." },
  { icon: Table2, tag: "05 · Records", title: "Tables, not just text", body: "Tables and repeated cards become structured records, with exact max and min computed over every row before the model sees them." },
  { icon: ShieldCheck, tag: "06 · Honesty", title: "Failures said plainly", body: "Blocked by robots.txt, rate limited, timed out or partial: the chat shows the real exit code and what happened. Nothing is made up." },
];

const STEPS = [
  { n: "01", t: "Interpret", d: "gpt-oss-20b, JSON mode" },
  { n: "02", t: "Validate", d: "Pydantic TaskSpec + URL check" },
  { n: "03", t: "Execute", d: "sitecrawl subprocess" },
  { n: "04", t: "Stream", d: "stderr JSON lines → SSE" },
  { n: "05", t: "Answer", d: "gpt-oss-120b, cited sources" },
];

const CODES = [
  ["0", "succeeded", "Crawl completed"],
  ["2", "partial", "Some pages failed or time ran out"],
  ["3", "failed", "Site unreachable"],
  ["4", "failed", "robots.txt disallows the URL"],
  ["5", "failed", "Invalid or unsafe URL"],
  ["124", "timed_out", "Budget used before any page"],
  ["130", "cancelled", "Stopped by you, partial data kept"],
];

export default function Landing() {
  const [q, setQ] = useState("");
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/app?q=${encodeURIComponent(q.trim())}` : "/app");
  };

  return (
    <div className="site min-h-dvh">
      <SiteNav />

      {/* hero */}
      <section className="relative">
        <div className="absolute inset-0 dotgrid [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)] pointer-events-none" />
        <div className="relative mx-auto max-w-[1200px] px-5 pt-16 md:pt-24 pb-10 text-center">
          <motion.a href="/how-it-works" onClick={linkTo("/how-it-works")}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 h-7 pl-2 pr-3 rounded-full border border-border-default bg-white text-[12px] text-text-secondary hover:border-border-strong transition-colors">
            <span className="relative flex size-2"><span className="absolute inset-0 rounded-full bg-cobalt/40 animate-ping" /><span className="relative size-2 rounded-full bg-cobalt" /></span>
            <span className="font-mono text-[11px]">1 approved CLI · 7 exit codes · live</span>
          </motion.a>
          <motion.h1 initial={{ opacity: 0, y: 10, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 text-[clamp(40px,7vw,76px)] leading-[0.98] font-semibold tracking-[-0.045em]">
            Ask any website.<br /><span className="text-text-subtle">Get answers and JSON.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
            className="mt-5 mx-auto max-w-[56ch] text-[17px] leading-[1.6] text-text-secondary">
            Type a question. SiteScout runs a sandboxed crawler on the server, lets you watch every page it reads, then answers with sources and clean JSON.
          </motion.p>

          <motion.form onSubmit={go} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            className="mt-8 mx-auto max-w-[620px] flex items-center gap-2 p-1.5 rounded-xl border border-border-default bg-white shadow-[0_8px_30px_-12px_rgb(0_0_0/.15)] focus-within:border-border-strong">
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask about a website"
              placeholder="Which country on scrapethissite.com/pages/simple has the largest area?"
              className="flex-1 min-w-0 h-10 px-3 bg-transparent text-[15px] outline-none placeholder:text-text-subtle" />
            <button className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#0a0a0a] text-white text-[14px] font-medium hover:bg-black/85 transition-colors">
              Run<ArrowRight size={15} />
            </button>
          </motion.form>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
            className="mt-3 inline-flex items-center gap-2 text-[12.5px] text-text-muted">
            <span>or run the CLI yourself</span>
            <code className="hidden sm:inline font-mono text-[11.5px] px-2 py-1 rounded-md bg-bg-muted text-text-secondary max-w-[340px] truncate">{CLI}</code>
            <CopyButton text={CLI} label="Copy" />
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="relative mt-14 mx-auto max-w-[1100px]">
            <Corners />
            <DemoWindow />
          </motion.div>
        </div>
      </section>

      {/* works on */}
      <section className="border-y border-border-default py-6 overflow-hidden">
        <div className="mx-auto max-w-[1200px] px-5 flex items-center gap-6">
          <Label className="shrink-0">Works on public sites</Label>
          <div className="relative flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
            <div className="marquee flex w-max gap-10 font-mono text-[13px] text-text-secondary">
              {[...SITES, ...SITES].map((s, i) => <span key={i} className="whitespace-nowrap">{s}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-[1200px] px-5 py-20 md:py-28">
        <Reveal className="max-w-[640px]">
          <Label>What it does</Label>
          <h2 className="mt-3 text-[clamp(28px,4vw,44px)] leading-[1.05] font-semibold tracking-[-0.035em]">From a sentence to a verified crawl, in one chat.</h2>
        </Reveal>
        <div className="relative mt-12 grid sm:grid-cols-2 lg:grid-cols-3 border-t border-l border-border-default">
          <Corners />
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05} className="group border-r border-b border-border-default p-7 hover:bg-bg-subtle transition-colors">
              <div className="flex items-center justify-between">
                <span className="size-10 grid place-items-center rounded-lg border border-border-default bg-white group-hover:border-cobalt/40 transition-colors">
                  <f.icon size={18} strokeWidth={1.6} />
                </span>
                <Label>{f.tag}</Label>
              </div>
              <h3 className="mt-6 text-[17px] font-semibold tracking-[-0.015em]">{f.title}</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-text-secondary">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* pipeline */}
      <section className="bg-bg-subtle border-y border-border-default">
        <div className="mx-auto max-w-[1200px] px-5 py-20 md:py-24">
          <Reveal className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-[560px]">
              <Label>Pipeline</Label>
              <h2 className="mt-3 text-[clamp(28px,4vw,44px)] leading-[1.05] font-semibold tracking-[-0.035em]">The model fills a form. Code runs the crawl.</h2>
            </div>
            <a href="/how-it-works#architecture" className="inline-flex items-center gap-1.5 text-[14px] font-medium hover:gap-2.5 transition-all">See the architecture<ArrowRight size={15} /></a>
          </Reveal>
          <ol className="relative mt-12 grid md:grid-cols-5 gap-px bg-border-default border border-border-default rounded-xl overflow-hidden">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.06} className="bg-white p-5 h-full">
                <li className="list-none">
                  <span className="font-mono text-[11px] text-cobalt">{s.n}</span>
                  <h3 className="mt-8 text-[16px] font-semibold tracking-[-0.01em]">{s.t}</h3>
                  <p className="mt-1 font-mono text-[11.5px] text-text-muted">{s.d}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* exit codes + cli */}
      <section className="mx-auto max-w-[1200px] px-5 py-20 md:py-28 grid lg:grid-cols-2 gap-12 items-start">
        <Reveal>
          <Label>Honest status</Label>
          <h2 className="mt-3 text-[clamp(28px,4vw,40px)] leading-[1.05] font-semibold tracking-[-0.035em]">Every answer carries its exit code.</h2>
          <p className="mt-4 text-[15px] leading-[1.6] text-text-secondary max-w-[48ch]">The chat reports what the process actually did, with the PID, runtime and stderr tail one tap away.</p>
          <a href="/app" onClick={linkTo("/app")} className="mt-6 inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[#0a0a0a] text-white text-[14px] font-medium hover:bg-black/85 transition-colors">Try it<ArrowRight size={15} /></a>
        </Reveal>
        <Reveal delay={0.1} className="relative">
          <Corners />
          <div className="rounded-xl border border-border-default overflow-hidden">
            <div className="grid grid-cols-[64px_110px_1fr] px-4 h-9 items-center bg-bg-subtle border-b border-border-default"><Label>Exit</Label><Label>Status</Label><Label>Meaning</Label></div>
            {CODES.map(([c, s, m]) => (
              <div key={c} className="grid grid-cols-[64px_110px_1fr] px-4 h-11 items-center border-b last:border-b-0 border-border-default text-[13.5px] hover:bg-bg-subtle transition-colors">
                <span className="font-mono tabular-nums">{c}</span>
                <span className={`font-mono text-[12px] ${c === "0" ? "text-moss" : c === "2" || c === "130" ? "text-ochre" : "text-brick"}`}>{s}</span>
                <span className="text-text-secondary truncate">{m}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* explore */}
      <section className="border-t border-border-default">
        <div className="mx-auto max-w-[1200px] px-5 py-16 grid md:grid-cols-[1fr_2fr] gap-10">
          <Reveal><h2 className="text-[24px] font-semibold tracking-[-0.03em]">Explore SiteScout</h2></Reveal>
          <ul className="divide-y divide-border-default border-y border-border-default">
            {[
              { t: "Open the app", d: "Ask about any public website and watch the crawl live.", href: "/app" },
              { t: "Read how it works", d: "Architecture, request lifecycle, CLI contract and the security model.", href: "/how-it-works" },
              { t: "Browse the source", d: "FastAPI backend, the sitecrawl CLI, React UI and tests on GitHub.", href: REPO, ext: true },
            ].map((x) => (
              <li key={x.t}>
                <a href={x.href} {...(x.ext ? { target: "_blank", rel: "noopener noreferrer" } : { onClick: linkTo(x.href) })}
                  className="group flex items-center justify-between gap-6 py-5 hover:bg-bg-subtle px-3 -mx-3 rounded-lg transition-colors">
                  <span>
                    <span className="block text-[16px] font-medium">{x.t}</span>
                    <span className="block mt-0.5 text-[14px] text-text-muted">{x.d}</span>
                  </span>
                  {x.ext ? <ArrowUpRight size={18} className="shrink-0 text-text-muted group-hover:text-text-primary" /> : <ArrowRight size={18} className="shrink-0 text-text-muted group-hover:translate-x-1 group-hover:text-text-primary transition-transform" />}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* dark CTA */}
      <section className="px-5 pb-20">
        <div className="relative mx-auto max-w-[1200px] rounded-2xl bg-[#0a0a0a] text-white overflow-hidden">
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgb(255_255_255/.12)_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="relative px-8 md:px-14 py-14 md:py-20 grid md:grid-cols-[1.4fr_1fr] gap-8 items-end">
            <div>
              <Label className="!text-white/45">Ready when you are</Label>
              <h2 className="mt-3 text-[clamp(30px,4.5vw,52px)] leading-[1.02] font-semibold tracking-[-0.04em]">Got a question about a website?<br /><span className="text-white/45">Ask SiteScout.</span></h2>
            </div>
            <div className="flex md:justify-end gap-2">
              <a href="/app" onClick={linkTo("/app")} className="inline-flex items-center gap-1.5 h-11 px-5 rounded-lg bg-white text-[#0a0a0a] text-[14px] font-medium hover:bg-white/90 transition-colors">Open app<ArrowRight size={15} /></a>
              <a href={REPO} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-lg border border-white/15 text-[14px] font-medium hover:bg-white/5 transition-colors">GitHub<ArrowUpRight size={15} /></a>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
