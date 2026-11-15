import { useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import type { CrawlNode } from "../types";

const SIZE = 360;
const C = SIZE / 2;
const RINGS = [0, 92, 154];

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).replace(/\/index\.html?$/, "/") || "/";
  } catch {
    return url;
  }
}

/** Radial site map drawn from the crawler's real events: each node is a page the CLI touched. */
export function CrawlMap({ nodes, live }: { nodes: Record<string, CrawlNode>; live: boolean }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const list = Object.values(nodes).sort((a, b) => a.order - b.order);
    const pos: Record<string, { x: number; y: number; a: number }> = {};
    const root = list.find((n) => n.depth === 0);
    if (root) pos[root.url] = { x: C, y: C, a: -Math.PI / 2 };

    const d1 = list.filter((n) => n.depth === 1);
    d1.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / Math.max(d1.length, 1)) * Math.PI * 2;
      pos[n.url] = { x: C + Math.cos(a) * RINGS[1], y: C + Math.sin(a) * RINGS[1], a };
    });

    const d2 = list.filter((n) => n.depth >= 2);
    const byParent: Record<string, CrawlNode[]> = {};
    d2.forEach((n) => (byParent[n.parent ?? ""] ||= []).push(n));
    const slice = (Math.PI * 2) / Math.max(d1.length, 1);
    Object.entries(byParent).forEach(([parent, kids]) => {
      const base = pos[parent]?.a ?? -Math.PI / 2;
      kids.forEach((n, i) => {
        const spread = Math.min(slice * 0.8, 0.22 * kids.length);
        const a = base + (kids.length === 1 ? 0 : -spread / 2 + (i / (kids.length - 1)) * spread);
        pos[n.url] = { x: C + Math.cos(a) * RINGS[2], y: C + Math.sin(a) * RINGS[2], a };
      });
    });
    return { list, pos, root };
  }, [nodes]);

  const hovered = hover ? nodes[hover] : null;
  const done = layout.list.filter((n) => n.state === "done").length;
  const failed = layout.list.filter((n) => n.state === "failed").length;
  const skipped = layout.list.filter((n) => n.state === "skipped").length;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-auto" role="img"
        aria-label={`Site map: ${done} pages crawled, ${failed} failed`}>
        {RINGS.slice(1).map((r) => (
          <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="var(--color-rule)" strokeDasharray="1 5" strokeLinecap="round" />
        ))}

        {live && !reduce && (
          <motion.circle cx={C} cy={C} fill="none" stroke="var(--color-cobalt)" strokeWidth={1}
            initial={{ r: 10, opacity: 0.5 }} animate={{ r: 170, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }} />
        )}

        <AnimatePresence>
          {layout.list.map((n) => {
            const p = layout.pos[n.url];
            const pp = n.parent ? layout.pos[n.parent] : layout.root ? layout.pos[layout.root.url] : undefined;
            if (!p || !pp || n.depth === 0) return null;
            const mx = (p.x + pp.x) / 2 + (C - (p.x + pp.x) / 2) * 0.18;
            const my = (p.y + pp.y) / 2 + (C - (p.y + pp.y) / 2) * 0.18;
            return (
              <motion.path key={"e" + n.url} d={`M${pp.x},${pp.y} Q${mx},${my} ${p.x},${p.y}`} fill="none"
                stroke={n.state === "failed" ? "var(--color-brick)" : hover === n.url ? "var(--color-cobalt)" : n.state === "skipped" ? "#CDD2CA" : "#AEB4AC"}
                strokeWidth={hover === n.url ? 1.4 : 1}
                strokeDasharray={n.state === "failed" || n.state === "skipped" ? "3 3" : undefined}
                initial={reduce ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} />
            );
          })}
        </AnimatePresence>

        {layout.list.map((n) => {
          const p = layout.pos[n.url];
          if (!p) return null;
          const isRoot = n.depth === 0;
          const r = isRoot ? 9 : n.depth === 1 ? 5.5 : 4;
          const fill = n.state === "failed" ? "var(--color-brick)" : n.state === "fetching" || n.state === "skipped" ? "var(--color-sheet)" : "var(--color-ink)";
          return (
            <g key={n.url} onMouseEnter={() => setHover(n.url)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.url)} onBlur={() => setHover(null)} tabIndex={0} style={{ cursor: "default", outline: "none" }}>
              <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
              <motion.circle cx={p.x} cy={p.y} fill={fill}
                stroke={n.state === "fetching" || hover === n.url ? "var(--color-cobalt)" : n.state === "skipped" ? "#AEB4AC" : "transparent"}
                strokeWidth={1.5}
                initial={reduce ? false : { r: 0 }} animate={{ r: hover === n.url ? r + 2 : r }}
                transition={{ type: "spring", stiffness: 520, damping: 22 }} />
              {isRoot && n.state === "done" && <circle cx={p.x} cy={p.y} r={3} fill="var(--color-cobalt)" />}
              {n.state === "fetching" && !reduce && (
                <motion.circle cx={p.x} cy={p.y} r={r} fill="var(--color-cobalt)"
                  animate={{ opacity: [0.15, 0.6, 0.15] }} transition={{ duration: 1, repeat: Infinity }} />
              )}
            </g>
          );
        })}
      </svg>

      <div className="mt-1 h-10 text-[13px] leading-snug" aria-live="polite">
        {hovered ? (
          <>
            <div className="font-medium truncate">{hovered.title || pathOf(hovered.url)}</div>
            <div className="text-graphite truncate">
              {pathOf(hovered.url)}
              {hovered.status ? <span className="ml-2 tabular-nums">{hovered.status}</span> : null}
              {hovered.ms ? <span className="ml-2 tabular-nums">{hovered.ms} ms</span> : null}
              {hovered.state === "failed" ? <span className="ml-2 text-brick">failed</span> : null}
              {hovered.state === "skipped" ? <span className="ml-2">not fetched, page limit reached</span> : null}
            </div>
          </>
        ) : (
          <div className="text-graphite">
            {layout.list.length === 0
              ? "Pages appear here as the crawler reaches them."
              : `${done} crawled${failed ? `, ${failed} failed` : ""}${skipped ? `, ${skipped} left for the page limit` : ""}. Hover a point to see the page.`}
          </div>
        )}
      </div>
    </div>
  );
}
