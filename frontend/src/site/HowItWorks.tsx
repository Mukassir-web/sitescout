import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Corners, CopyButton, Label, Reveal, SiteFooter, SiteNav } from "./chrome";
import { linkTo } from "./router";

const TOC = [
  { id: "architecture", t: "Architecture" },
  { id: "lifecycle", t: "Request lifecycle" },
  { id: "cli", t: "The CLI" },
  { id: "exit-codes", t: "Exit codes" },
  { id: "security", t: "Security" },
  { id: "stack", t: "Stack and AI disclosure" },
];

const USAGE = `usage: sitecrawl crawl --url URL [--max-pages 1-25] [--depth 0-3] [--timeout 5-90]
                       [--concurrency 1-6] [--focus WORDS] [--scope auto|site]
                       [--out FILE] [--quiet-debug]
stdout : one JSON document (schema sitecrawl.result/v1)
stderr : JSON-lines progress events`;
const RUN = "cd cli && python -m sitecrawl crawl --url https://books.toscrape.com --max-pages 8 --depth 1 > result.json";

const LIFECYCLE = [
  ["Interpret", "gpt-oss-20b on Groq, in JSON mode, returns {action, url, max_pages, depth, outputs, focus}. The last few turns go with it, so follow-ups resolve to the site you were discussing. If Groq is down, a rule-based parser takes over and the UI says so."],
  ["Validate", "Pydantic enforces the shape: action is an enum, numbers are clamped to server caps, and the URL must be on a site you named. The model may not invent paths: an unseen page becomes a focused crawl from the site root."],
  ["Select the tool", "Only tools in the APPROVED_TOOLS registry can run. Today that is sitecrawl, chosen because it is robots-aware, SSRF-guarded, bounded, and separates machine output (stdout) from progress (stderr)."],
  ["Invoke", "asyncio.create_subprocess_exec with an argv list, never a shell string. start_new_session so the whole process group can be killed, stdin from /dev/null, and an environment with no API keys."],
  ["Monitor", "Each stderr line is a JSON event (fetch_start, page_done, page_discarded…). It is appended to the run's event log and streamed to the browser over Server-Sent Events, which draws the crawl map, console and reader view."],
  ["Limit", "The CLI enforces its crawl budget; the backend adds a wall-clock limit. On timeout or cancel it sends SIGTERM to the process group so partial results flush, then SIGKILL after 3 s. Stdout is capped at 6 MB."],
  ["Validate output", "Stdout must parse as JSON with schema sitecrawl.result/v1. The exit code decides the status shown in chat."],
  ["Answer", "gpt-oss-120b gets your question and the most relevant pages inside an untrusted-content block, answers first, says when the pages don't contain the answer, and cites sources that were really crawled. Invalid output falls back to an extractive summary, labelled as such."],
];

const CODES = [
  ["0", "succeeded", "Crawl completed"],
  ["2", "partial", "Some pages failed, or the time budget ran out after some pages"],
  ["3", "failed", "Site unreachable (DNS, connection, HTTP error on the start page)"],
  ["4", "failed", "robots.txt disallows the URL"],
  ["5", "failed", "Invalid or unsafe URL or arguments"],
  ["124", "timed_out", "Budget exhausted before any page"],
  ["130", "cancelled", "Stopped by the user; partial data kept and labelled"],
];

const SECURITY = [
  ["Shell injection", "No shell anywhere. argv is built from validated fields; the tool path is fixed in a registry."],
  ["Model-chosen commands", "The model only fills a JSON schema. It never produces flags, paths or commands."],
  ["Invented targets", "The model's URL must match a host the user typed."],
  ["SSRF", "http/https only, standard ports, every resolved address must be public (blocks loopback, RFC1918, link-local, 169.254.169.254, IPv6 local), re-checked on every redirect."],
  ["Resource abuse", "20 pages, depth 2, 45 s crawl, 2 MB per page, 3 concurrent runs, 8 runs a minute per IP, 1,500-character prompts."],
  ["Prompt injection (user)", "Llama Prompt Guard 2 scores the prompt; high-risk prompts are refused before anything runs."],
  ["Prompt injection (website)", "Web text is wrapped as untrusted data, output is schema-validated and never executed, and suspicious pages are flagged in the JSON."],
  ["Secret leakage", "Keys live only in server env vars, are redacted from every event and error, and never reach the CLI. One exception: an optional read-only SITESCOUT_GITHUB_TOKEN, sent only to api.github.com."],
  ["Robots and politeness", "robots.txt honoured, identifying User-Agent, same-site only, bounded concurrency."],
  ["Browser hardening", "CSP, nosniff, no-referrer, COOP and Permissions-Policy; crawled links open with noopener noreferrer nofollow."],
];

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 py-14 border-b border-border-default last:border-b-0">
      <Reveal>
        <Label>{label}</Label>
        <h2 className="mt-2 text-[28px] md:text-[32px] leading-[1.1] font-semibold tracking-[-0.03em]">{title}</h2>
      </Reveal>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Box({ title, sub, tone = "" }: { title: string; sub: string; tone?: string }) {
  return (
    <div className={`rounded-lg border bg-white px-3.5 py-3 ${tone || "border-border-default"}`}>
      <div className="text-[13.5px] font-semibold">{title}</div>
      <div className="mt-0.5 font-mono text-[10.5px] text-text-muted">{sub}</div>
    </div>
  );
}
const Arrow = () => <div className="grid place-items-center text-text-subtle py-1 md:py-0"><ArrowRight size={16} className="rotate-90 md:rotate-0" /></div>;

function Diagram() {
  return (
    <div className="relative rounded-xl border border-border-default bg-bg-subtle dotgrid p-5 md:p-7">
      <Corners />
      <div className="grid md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2">
        <Box title="Chat UI" sub="React · SSE client" />
        <Arrow />
        <div className="space-y-2">
          <Box title="FastAPI" sub="rate limit · validation" />
          <Box title="Prompt Guard" sub="llama-prompt-guard-2" />
        </div>
        <Arrow />
        <div className="space-y-2">
          <Box title="Intent" sub="gpt-oss-20b → TaskSpec" />
          <Box title="Approved tools" sub="registry · argv list" />
        </div>
        <Arrow />
        <Box title="sitecrawl" sub="subprocess · own process group" tone="border-cobalt/50 ring-4 ring-cobalt/10" />
      </div>
      <div className="mt-4 grid md:grid-cols-3 gap-2">
        <Box title="stderr → event log → SSE" sub="crawl map · console · reader" />
        <Box title="stdout → schema + exit code" sub="sitecrawl.result/v1" />
        <Box title="Summariser" sub="gpt-oss-120b · cited sources" />
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const [active, setActive] = useState("architecture");
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-30% 0px -60% 0px" });
    TOC.forEach((t) => { const el = document.getElementById(t.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  return (
    <div className="site min-h-dvh">
      <SiteNav />
      <header className="border-b border-border-default">
        <div className="mx-auto max-w-[1200px] px-5 py-14 md:py-20">
          <Label>Documentation</Label>
          <h1 className="mt-3 text-[clamp(36px,6vw,60px)] leading-[1] font-semibold tracking-[-0.045em] max-w-[18ch]">How SiteScout turns a sentence into a crawl.</h1>
          <p className="mt-5 max-w-[60ch] text-[16px] leading-[1.6] text-text-secondary">The language model never runs anything. It fills a strict form; validated code chooses an approved tool, starts it as a real process, watches it, and reports exactly what happened.</p>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-5 grid lg:grid-cols-[220px_minmax(0,1fr)] gap-12">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 py-14" aria-label="On this page">
            <Label>On this page</Label>
            <ul className="mt-3 space-y-0.5 border-l border-border-default">
              {TOC.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className={`block -ml-px pl-3 py-1.5 text-[13.5px] border-l transition-colors ${active === t.id ? "border-text-primary text-text-primary font-medium" : "border-transparent text-text-muted hover:text-text-primary"}`}>{t.t}</a>
                </li>
              ))}
            </ul>
            <a href="/app" onClick={linkTo("/app")} className="mt-8 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#0a0a0a] text-white text-[13px] font-medium">Open app<ArrowRight size={14} /></a>
          </nav>
        </aside>

        <main className="min-w-0">
          <Section id="architecture" label="01" title="Architecture">
            <Diagram />
            <div className="mt-6 rounded-xl border border-border-default overflow-hidden text-[13.5px]">
              {[
                ["Chat UI", "frontend/", "Prompt input, live inspector (crawl map, console, reader view), answers, JSON"],
                ["API", "backend/app/main.py", "Rate limiting, validation, run lifecycle, SSE stream, security headers"],
                ["Intent", "backend/app/intent.py", "Natural language to a validated TaskSpec, with a rule-based fallback"],
                ["Orchestrator", "backend/app/runner.py", "Tool registry, argv, subprocess, capture, timeouts, cancel, exit codes"],
                ["Output", "backend/app/summarize.py", "JSON document, validated insights, extractive fallback, injection scan"],
                ["CLI", "cli/sitecrawl/", "SSRF guard, robots.txt, bounded BFS, extraction, records, JSON result"],
              ].map(([a, b, c]) => (
                <div key={a} className="grid md:grid-cols-[130px_210px_1fr] gap-x-4 gap-y-0.5 px-4 py-3 border-b last:border-b-0 border-border-default">
                  <span className="font-medium">{a}</span><code className="font-mono text-[12px] text-cobalt">{b}</code><span className="text-text-secondary">{c}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="lifecycle" label="02" title="How a request becomes a CLI execution">
            <ol className="relative border-l border-border-default ml-3">
              {LIFECYCLE.map(([t, d], i) => (
                <li key={t} className="relative pl-8 pb-7 last:pb-0">
                  <span className="absolute -left-3 top-0 size-6 grid place-items-center rounded-full border border-border-default bg-white font-mono text-[10.5px]">{i + 1}</span>
                  <h3 className="text-[15.5px] font-semibold">{t}</h3>
                  <p className="mt-1 text-[14px] leading-[1.65] text-text-secondary max-w-[68ch]">{d}</p>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="cli" label="03" title="The CLI: sitecrawl">
            <p className="text-[14.5px] leading-[1.65] text-text-secondary max-w-[68ch]">It works on its own, which is how you can verify that the chat is backed by real execution. Tables and repeated blocks become structured records with exact max and min over every row; GitHub repositories are read through the official REST API.</p>
            <div className="mt-5 rounded-xl bg-[#16191F] text-white overflow-hidden">
              <div className="flex items-center justify-between px-4 h-10 border-b border-white/10">
                <span className="font-mono text-[11px] text-white/50">terminal</span>
                <span className="[&_button]:text-white/70 [&_button:hover]:bg-white/10"><CopyButton text={RUN} /></span>
              </div>
              <pre className="p-4 font-mono text-[12.5px] leading-[1.7] overflow-x-auto"><span className="text-white/40">$ </span>{RUN}{"\n\n"}<span className="text-white/60">{USAGE}</span></pre>
            </div>
          </Section>

          <Section id="exit-codes" label="04" title="Exit codes">
            <div className="rounded-xl border border-border-default overflow-hidden">
              {CODES.map(([c, s, m]) => (
                <div key={c} className="grid grid-cols-[60px_110px_1fr] gap-3 px-4 py-3 border-b last:border-b-0 border-border-default text-[13.5px]">
                  <span className="font-mono">{c}</span>
                  <span className={`font-mono text-[12px] ${c === "0" ? "text-moss" : c === "2" || c === "130" ? "text-ochre" : "text-brick"}`}>{s}</span>
                  <span className="text-text-secondary">{m}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="security" label="05" title="Security model">
            <div className="grid sm:grid-cols-2 gap-px bg-border-default border border-border-default rounded-xl overflow-hidden">
              {SECURITY.map(([r, c]) => (
                <div key={r} className="bg-white p-5">
                  <h3 className="text-[14.5px] font-semibold">{r}</h3>
                  <p className="mt-1.5 text-[13.5px] leading-[1.6] text-text-secondary">{c}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="stack" label="06" title="Stack and AI disclosure">
            <dl className="grid sm:grid-cols-[160px_1fr] gap-x-6 gap-y-3 text-[14px]">
              {[
                ["Backend", "Python 3.12, FastAPI, sse-starlette, httpx, Pydantic v2"],
                ["CLI", "Python, httpx, selectolax, urllib.robotparser"],
                ["Frontend", "React 19, TypeScript, Vite, Tailwind CSS v4, Motion, Geist"],
                ["Models (Groq)", "gpt-oss-20b (intent), gpt-oss-120b (answers, 20b fallback), llama-prompt-guard-2-86m"],
                ["Hosting", "Docker on Render, kept warm by a GitHub Actions ping"],
                ["AI assistance", "Code written with an AI coding agent (Hark) under our direction, reviewed and tested by us. Runtime AI is limited to the three Groq models."],
              ].map(([k, v]) => (
                <div key={k} className="contents"><dt className="font-medium">{k}</dt><dd className="text-text-secondary">{v}</dd></div>
              ))}
            </dl>
          </Section>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
