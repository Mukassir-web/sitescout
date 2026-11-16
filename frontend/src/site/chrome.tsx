import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Check, Copy, Menu, X } from "lucide-react";
import { linkTo } from "./router";

export const REPO = "https://github.com/Mukassir-web/sitescout";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0a0a0a" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="1.6" strokeDasharray="2.4 3" />
      <circle cx="16" cy="16" r="3.2" fill="var(--color-cobalt)" />
      <circle cx="23.5" cy="11" r="2" fill="#fff" />
      <circle cx="9" cy="21.5" r="2" fill="#fff" />
    </svg>
  );
}

/** The "+" registration marks that sit on the corners of framed blocks. */
export function Corners() {
  const mark = "absolute size-[15px] text-black/15 pointer-events-none";
  const svg = (
    <svg viewBox="0 0 15 15" className="size-full" aria-hidden="true">
      <path d="M7.5 0v15M0 7.5h15" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
  return (
    <>
      <span className={`${mark} -top-2 -left-2`}>{svg}</span>
      <span className={`${mark} -top-2 -right-2`}>{svg}</span>
      <span className={`${mark} -bottom-2 -left-2`}>{svg}</span>
      <span className={`${mark} -bottom-2 -right-2`}>{svg}</span>
    </>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[10.5px] uppercase tracking-wider text-text-muted ${className}`}>{children}</span>;
}

export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={label}
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); }}
      className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] text-text-secondary hover:bg-black/[.04] transition-colors">
      {done ? <Check size={13} className="text-moss" /> : <Copy size={13} />}{done ? "Copied" : label}
    </button>
  );
}

const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/how-it-works#cli", label: "CLI" },
  { href: "/how-it-works#security", label: "Security" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-border-default">
      <div className="mx-auto max-w-[1200px] h-16 px-5 flex items-center gap-8">
        <a href="/" onClick={linkTo("/")} className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">SiteScout</span>
        </a>
        <nav className="hidden md:flex items-center gap-6 text-[14px] text-text-secondary" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} onClick={n.href.includes("#") ? undefined : linkTo(n.href)} className="hover:text-text-primary transition-colors">{n.label}</a>
          ))}
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-text-primary transition-colors">
            GitHub<ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href="/how-it-works" onClick={linkTo("/how-it-works")}
            className="hidden sm:inline-flex h-9 items-center px-3.5 rounded-lg border border-border-default text-[13.5px] font-medium hover:bg-bg-subtle transition-colors">
            Read the docs
          </a>
          <a href="/app" onClick={linkTo("/app")}
            className="inline-flex h-9 items-center px-3.5 rounded-lg bg-[#0a0a0a] text-white text-[13.5px] font-medium hover:bg-black/85 transition-colors">
            Open app
          </a>
          <button className="md:hidden h-9 w-9 grid place-items-center rounded-lg hover:bg-bg-subtle" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="md:hidden border-t border-border-default px-5 py-3 flex flex-col text-[15px]" aria-label="Mobile">
          {NAV.map((n) => <a key={n.href} href={n.href} className="py-2" onClick={() => setOpen(false)}>{n.label}</a>)}
          <a href={REPO} target="_blank" rel="noopener noreferrer" className="py-2">GitHub</a>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  const col = (title: string, items: { label: string; href: string; ext?: boolean }[]) => (
    <div>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-[13.5px] text-text-secondary">
        {items.map((i) => (
          <li key={i.label}>
            <a href={i.href} {...(i.ext ? { target: "_blank", rel: "noopener noreferrer" } : { onClick: i.href.includes("#") ? undefined : linkTo(i.href) })}
              className="hover:text-text-primary transition-colors">{i.label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="border-t border-border-default">
      <div className="mx-auto max-w-[1200px] px-5 py-14 grid gap-10 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5"><Logo /><span className="font-semibold tracking-[-0.02em]">SiteScout</span></div>
          <p className="mt-3 text-[13.5px] text-text-muted max-w-[34ch]">Plain-English questions in, a real sandboxed crawl, answers and JSON out.</p>
        </div>
        {col("Product", [{ label: "Open app", href: "/app" }, { label: "How it works", href: "/how-it-works" }, { label: "Exit codes", href: "/how-it-works#exit-codes" }])}
        {col("Build", [{ label: "Source on GitHub", href: REPO, ext: true }, { label: "CLI reference", href: "/how-it-works#cli" }, { label: "Architecture", href: "/how-it-works#architecture" }])}
        {col("Trust", [{ label: "Security model", href: "/how-it-works#security" }, { label: "Stack and AI disclosure", href: "/how-it-works#stack" }])}
      </div>
      <div className="border-t border-border-default">
        <div className="mx-auto max-w-[1200px] px-5 h-12 flex items-center justify-between">
          <Label>© 2026 SiteScout · BuildSprint</Label>
          <Label>Deployed on Render · Groq</Label>
        </div>
      </div>
    </footer>
  );
}
