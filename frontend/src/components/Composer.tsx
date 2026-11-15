import { useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";

export function Composer({ value, onChange, onSubmit, busy, autoFocus }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; busy: boolean; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "0px"; el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [value]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const can = value.trim().length > 0 && !busy;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (can) onSubmit(); }}
      className="group relative flex items-end gap-2 rounded-2xl bg-sheet border border-rule px-4 py-3 shadow-[0_1px_0_rgba(22,25,31,0.04),0_12px_32px_-18px_rgba(22,25,31,0.25)] focus-within:border-ink/40 focus-within:ring-4 focus-within:ring-cobalt/10 transition-colors">
      <label htmlFor="prompt" className="sr-only">Describe what you want from a website</label>
      <textarea id="prompt" ref={ref} rows={1} value={value} autoFocus={autoFocus} maxLength={1500}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (can) onSubmit(); } }}
        placeholder="Crawl a website and tell me what it's about, as JSON"
        className="flex-1 resize-none bg-transparent outline-none focus-visible:outline-none text-[16px] leading-[1.5] placeholder:text-graphite/70 py-1 max-h-[180px]" />
      <button type="submit" disabled={!can} aria-label="Run"
        className="h-9 w-9 shrink-0 grid place-items-center rounded-xl bg-ink text-fog disabled:bg-rule disabled:text-graphite transition-[background,transform] active:scale-95">
        <ArrowUp size={18} strokeWidth={2.25} />
      </button>
    </form>
  );
}
