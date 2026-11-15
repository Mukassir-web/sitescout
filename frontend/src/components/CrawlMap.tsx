import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { RotateCcw, ExternalLink } from "lucide-react";
import type { CrawlNode } from "../types";

const SIZE = 400;
const C = SIZE / 2;
const RINGS = [0, 104, 172];
const RING_LABELS = ["", "1 link away", "2 links away"];

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).replace(/\/index\.html?$/, "/") || "/";
  } catch {
    return url;
  }
}

function shortLabel(url: string, root?: string) {
  const p = pathOf(url);
  if (root) {
    const rp = pathOf(root).replace(/\/$/, "");
    if (rp && p.startsWith(rp + "/")) return p.slice(rp.length + 1).replace(/\/$/, "").split("/").slice(-2).join("/") || "/";
  }
  const parts = p.replace(/\/$/, "").split("/").filter(Boolean);
  return parts.at(-1) ?? "/";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);
const norm = (u: string) => u.replace(/\/$/, "");

/**
 * Radial site map drawn from the crawler's real stderr events.
 * Centre: the start page. Each ring: one more link away. Each dot: a page the CLI fetched,
 * sized by how much text it had; cobalt halos mark the pages the answer was built from.
 */
export function CrawlMap({ nodes, live, sources = [], ended = false }: {
  nodes: Record<string, CrawlNode>; live: boolean; sources?: string[]; ended?: boolean;
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const used = useMemo(() => new Set(sources.map(norm)), [sources]);

  const layout = useMemo(() => {
    const list = Object.values(nodes).sort((a, b) => a.order - b.order);
    const pos: Record<string, { x: number; y: number; a: number }> = {};
    const root = list.find((n) => n.depth === 0);
    if (root) pos[root.url] = { x: C, y: C, a: -Math.PI / 2 };

    const d1 = list.filter((n) => n.depth === 1);
    const d2 = list.filter((n) => n.depth >= 2);
    const kids: Record<string, CrawlNode[]> = {};
    d2.forEach((n) => (kids[n.parent ?? ""] ||= []).push(n));
    // give depth-1 pages with many children a wider slice so grandchildren don't collide
    const weights = d1.map((n) => 1 + (kids[n.url]?.length ?? 0) * 0.6);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    d1.forEach((n, i) => {
      const slice = (weights[i] / total) * Math.PI * 2;
      const a = -Math.PI / 2 + acc + slice / 2;
      acc += slice;
      pos[n.url] = { x: C + Math.cos(a) * RINGS[1], y: C + Math.sin(a) * RINGS[1], a };
      const ks = kids[n.url] ?? [];
      ks.forEach((k, j) => {
        const spread = Math.min(slice * 0.85, 0.2 * ks.length);
        const ka = a + (ks.length === 1 ? 0 : -spread / 2 + (j / (ks.length - 1)) * spread);
        pos[k.url] = { x: C + Math.cos(ka) * RINGS[2], y: C + Math.sin(ka) * RINGS[2], a: ka };
      });
    });
    // orphans (parent not drawn): spread evenly on the outer ring
    const orphans = d2.filter((n) => !pos[n.url]);
    orphans.forEach((n, i) => {
      const a = -Math.PI / 2 + ((i + 0.5) / orphans.length) * Math.PI * 2;
      pos[n.url] = { x: C + Math.cos(a) * RINGS[2], y: C + Math.sin(a) * RINGS[2], a };
    });
    return { list, pos, root, maxDepth: Math.max(0, ...list.map((n) => n.depth)) };
  }, [nodes]);

  // replay: reveal nodes one by one in the order the crawler reached them
  useEffect(() => {
    if (replay === null) return;
    if (replay > layout.list.length) { const t = setTimeout(() => setReplay(null), 400); return () => clearTimeout(t); }
    const t = setTimeout(() => setReplay((r) => (r === null ? null : r + 1)), 220);
    return () => clearTimeout(t);
  }, [replay, layout.list.length]);

  const visible = (n: CrawlNode, i: number) => replay === null || i < replay;
  const focusUrl = hover ?? pinned;
  const focused = focusUrl ? nodes[focusUrl] : null;
  const done = layout.list.filter((n) => n.state === "done").length;
  const failed = layout.list.filter((n) => n.state === "failed").length;
  const skipped = layout.list.filter((n) => n.state === "skipped").length;
  const showLabels = layout.list.length <= 16;
  const rootUrl = layout.root?.url;

  const radius = (n: CrawlNode) =>
    n.depth === 0 ? 9 : Math.max(3.5, Math.min(8, 3 + Math.sqrt(n.words ?? 0) / 7));

  return (
    <div className="relative">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-graphite text-[13px]">Crawl map</h3>
        {ended && layout.list.length > 1 && !reduce && (
          <button onClick={() => { setPinned(null); setReplay(0); }}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-graphite hover:text-ink transition-colors">
            <RotateCcw size={12} />Replay crawl
          </button>
        )}
      </div>

      <svg viewBox={layout.maxDepth === 0 && !live ? `${C - 120} ${C - 60} 240 120` : `0 0 ${SIZE} ${SIZE}`}
        className={`w-full select-none ${layout.maxDepth === 0 && !live ? "h-[120px]" : "h-auto"}`} role="img"
        aria-label={`Site map: ${done} pages crawled, ${failed} failed`}>
        {RINGS.slice(1).map((r, i) => (i + 1 <= (live ? Math.max(layout.maxDepth, 1) : layout.maxDepth) ? (
          <g key={r}>
            <circle cx={C} cy={C} r={r} fill="none" stroke="var(--color-rule)" strokeDasharray="1 5" strokeLinecap="round" />
            <text x={C + 4} y={C - r - 5} fontSize={9.5} fill="#8D94A0" style={{ fontFamily: "var(--font-sans)" }}>{RING_LABELS[i + 1]}</text>
          </g>
        ) : null))}

        {live && !reduce && (
          <motion.circle cx={C} cy={C} fill="none" stroke="var(--color-cobalt)" strokeWidth={1}
            initial={{ r: 10, opacity: 0.5 }} animate={{ r: 185, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }} />
        )}

        <AnimatePresence>
          {layout.list.map((n, i) => {
            const p = layout.pos[n.url];
            const pp = n.parent && layout.pos[n.parent] ? layout.pos[n.parent] : rootUrl ? layout.pos[rootUrl] : undefined;
            if (!p || !pp || n.depth === 0 || !visible(n, i)) return null;
            const mx = (p.x + pp.x) / 2 + (C - (p.x + pp.x) / 2) * 0.18;
            const my = (p.y + pp.y) / 2 + (C - (p.y + pp.y) / 2) * 0.18;
            const isUsed = used.has(norm(n.url));
            const hot = focusUrl === n.url;
            return (
              <motion.path key={"e" + n.url} d={`M${pp.x},${pp.y} Q${mx},${my} ${p.x},${p.y}`} fill="none"
                stroke={n.state === "failed" ? "var(--color-brick)" : hot || isUsed ? "var(--color-cobalt)" : n.state === "skipped" ? "#CDD2CA" : "#AEB4AC"}
                strokeOpacity={isUsed && !hot ? 0.55 : 1}
                strokeWidth={hot ? 1.6 : isUsed ? 1.3 : 1}
                strokeDasharray={n.state === "failed" || n.state === "skipped" ? "3 3" : undefined}
                initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
            );
          })}
        </AnimatePresence>

        {layout.list.map((n, i) => {
          const p = layout.pos[n.url];
          if (!p || !visible(n, i)) return null;
          const isRoot = n.depth === 0;
          const r = radius(n);
          const isUsed = used.has(norm(n.url));
          const hot = focusUrl === n.url;
          const fill = n.state === "failed" ? "var(--color-brick)" : n.state === "fetching" || n.state === "skipped" ? "var(--color-sheet)" : "var(--color-ink)";
          // labels sit outside the node, on the side facing away from the centre
          const lx = p.x + Math.cos(p.a) * (r + 6);
          const ly = p.y + Math.sin(p.a) * (r + 6) + 3;
          const anchor = isRoot ? "middle" : Math.cos(p.a) > 0.25 ? "start" : Math.cos(p.a) < -0.25 ? "end" : "middle";
          const label = isRoot ? (() => { try { return new URL(n.url).hostname.replace(/^www\./, ""); } catch { return ""; } })() : clip(shortLabel(n.url, rootUrl), 16);
          return (
            <g key={n.url} role="button" tabIndex={0} aria-label={`${n.title || pathOf(n.url)}${isUsed ? ", used in the answer" : ""}`}
              onMouseEnter={() => setHover(n.url)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.url)} onBlur={() => setHover(null)}
              onClick={() => setPinned((u) => (u === n.url ? null : n.url))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPinned((u) => (u === n.url ? null : n.url)); } }}
              style={{ cursor: "pointer", outline: "none" }}>
              <circle cx={p.x} cy={p.y} r={16} fill="transparent" />
              {isUsed && (
                <motion.circle cx={p.x} cy={p.y} fill="none" stroke="var(--color-cobalt)" strokeWidth={1.5}
                  initial={reduce ? false : { r: r, opacity: 0 }} animate={{ r: r + 4.5, opacity: 1 }}
                  transition={{ delay: reduce ? 0 : 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
              )}
              <motion.circle cx={p.x} cy={p.y} fill={fill}
                stroke={n.state === "fetching" || hot ? "var(--color-cobalt)" : n.state === "skipped" ? "#AEB4AC" : "transparent"}
                strokeWidth={1.5}
                initial={reduce ? false : { r: 0 }} animate={{ r: hot ? r + 1.5 : r }}
                transition={{ type: "spring", stiffness: 520, damping: 22 }} />
              {isRoot && n.state === "done" && <circle cx={p.x} cy={p.y} r={3} fill="var(--color-cobalt)" />}
              {n.state === "fetching" && !reduce && (
                <motion.circle cx={p.x} cy={p.y} r={r} fill="var(--color-cobalt)"
                  animate={{ opacity: [0.15, 0.6, 0.15] }} transition={{ duration: 1, repeat: Infinity }} />
              )}
              {(showLabels || hot || isRoot) && label && (
                <text x={isRoot ? p.x : lx} y={isRoot ? p.y + r + 14 : ly} textAnchor={anchor} fontSize={isRoot ? 11 : 10}
                  fill={hot || isUsed ? "var(--color-cobalt)" : isRoot ? "var(--color-ink)" : "#6B7280"}
                  fontWeight={isRoot ? 600 : 400}
                  style={{ fontFamily: "var(--font-sans)", paintOrder: "stroke", stroke: "var(--color-sheet)", strokeWidth: 3, strokeLinejoin: "round" }}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-graphite">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink" />page, size = text</span>
        {used.size > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-cobalt" />used in answer</span>}
        {failed > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brick" />failed</span>}
        {skipped > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-[#AEB4AC]" />not fetched</span>}
      </div>

      <div className="mt-3 min-h-[72px] rounded-xl border border-rule bg-sheet px-3.5 py-3 text-[13px] leading-snug" aria-live="polite">
        {focused ? (
          <>
            <div className="flex items-start gap-2">
              <div className="font-medium min-w-0 flex-1 line-clamp-2">{focused.title || pathOf(focused.url)}</div>
              {focused.state === "done" && (
                <a href={focused.url} target="_blank" rel="noopener noreferrer nofollow" aria-label="Open page"
                  className="shrink-0 text-graphite hover:text-cobalt"><ExternalLink size={14} /></a>
              )}
            </div>
            <div className="mt-1 text-graphite truncate">{pathOf(focused.url)}</div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-graphite tabular-nums">
              {focused.status ? <span>HTTP {focused.status}</span> : null}
              {focused.ms ? <span>{focused.ms} ms</span> : null}
              {focused.words !== undefined ? <span>{focused.words} words</span> : null}
              {focused.depth > 0 && focused.parent ? <span className="truncate max-w-[16ch]">from {shortLabel(focused.parent, rootUrl)}</span> : null}
              {used.has(norm(focused.url)) ? <span className="text-cobalt">used in answer</span> : null}
              {focused.state === "failed" ? <span className="text-brick">failed</span> : null}
              {focused.state === "skipped" ? <span>not fetched, page limit reached</span> : null}
            </div>
          </>
        ) : (
          <div className="text-graphite">
            {layout.list.length === 0
              ? "Pages appear here as the crawler reaches them."
              : `${done} page${done === 1 ? "" : "s"} crawled${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} left for the page limit` : ""}. Hover or tap a point to inspect it.`}
          </div>
        )}
      </div>
    </div>
  );
}
