import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
} from "react-force-graph-2d";
import type { TreeEdge, TreeNodeSummary } from "./api";
import { MIN_TREE_DISPLAY_SCORE } from "./api";
import { surfaceScoreToCss } from "./surfaceColor";

export interface GraphNode extends NodeObject {
  id: string;
  name: string;
  relation: TreeNodeSummary["relation"];
  hop: 0 | 1 | 2;
  parentId?: string;
  context_score: number;
  context_signals: string[];
  photo_url?: string;
  linkedin_url?: string;
  website_url?: string;
  blog_url?: string;
  has_linkedin?: boolean;
  has_writing_surface?: boolean;
  surface_score?: number;
  surface_signals?: string[];
  surface_score_max?: number;
  can_expand?: boolean;
  bridge_seed_count?: number;
  fx?: number;
  fy?: number;
}

export interface GraphLink extends LinkObject {
  source: string;
  target: string;
  via: TreeEdge["via"];
  context_score: number;
  hop: 1 | 2;
}

/** Drop hop ≥ 1 with score ≤ 3 (incl. Arihant hop-2). Matches server + fetchTree. */
function isBotish(id: string, name: string): boolean {
  const slug = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  const s = `${slug} ${name}`.toLowerCase();
  return (
    /\[bot\]/.test(s) ||
    /(^|[\s_-])bot($|[\s_-])/.test(s) ||
    /dependabot|renovate|github-actions|actions-user|opencode-agent/.test(s)
  );
}

function keepOnTree(n: TreeNodeSummary): boolean {
  if (n.relation === "seed" || n.hop === 0) return true;
  if (isBotish(n.id, n.name)) return false;
  if (n.relation === "website") return true;
  return Number(n.context_score ?? 0) >= MIN_TREE_DISPLAY_SCORE;
}

const COLLAB = "#3dba9c";
const FOLLOWER = "#e07a5f";
const WEBSITE = "#7eb6d9";
const SEED = "#f4e8c1";
const HOP2 = "#8b9bb4";
const LINK_COLLAB = "rgba(61, 186, 156, 0.45)";
const LINK_FOLLOWER = "rgba(224, 122, 95, 0.4)";
const LINK_WEBSITE = "rgba(126, 182, 217, 0.5)";
const LINK_HOP2 = "rgba(139, 155, 180, 0.35)";

const RING1_MIN = 90;
const RING1_MAX = 220;
const HOP2_CLUSTER_GAP = 52;
const HOP2_EXPAND_BASE = 300;
const FOCUS_GAP = 0.55;
const ANIM_MS = 520;

function radiusForScore(score: number, maxScore: number): number {
  if (maxScore <= 0) return (RING1_MIN + RING1_MAX) / 2;
  const t = 1 - score / maxScore;
  return RING1_MIN + t * (RING1_MAX - RING1_MIN);
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x <= -Math.PI) x += 2 * Math.PI;
  while (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function parentOfHop2(
  n: TreeNodeSummary,
  edges: TreeEdge[]
): string | undefined {
  return (
    n.parentId ?? edges.find((e) => e.to === n.id && e.hop === 2)?.from
  );
}

function placeKidsOnRay(
  kids: TreeNodeSummary[],
  parentAngle: number,
  parentR: number,
  expanded: boolean,
  maxScore: number,
  parentId: string,
  placed: Map<string, GraphNode>
) {
  const sorted = [...kids].sort((a, b) => b.context_score - a.context_score);
  const n = sorted.length;
  // Collapsed: tight cluster just beyond parent. Expanded: wide outward fan.
  const spread = expanded
    ? Math.min(2.4, Math.max(0.9, 0.12 * n))
    : Math.min(0.45, Math.max(0.14, 0.05 * n));
  const baseR = expanded
    ? HOP2_EXPAND_BASE
    : parentR + HOP2_CLUSTER_GAP;

  sorted.forEach((child, i) => {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const angle = parentAngle - spread / 2 + t * spread;
    const scoreT = 1 - child.context_score / Math.max(1, maxScore);
    const stagger = expanded ? (i % 3) * 28 + (n > 12 ? 40 : 0) : (i % 2) * 10;
    const r =
      baseR +
      (expanded ? scoreT * 70 + stagger : scoreT * 18 + stagger * 0.4);
    placed.set(child.id, {
      ...child,
      hop: 2,
      parentId,
      fx: Math.cos(angle) * r,
      fy: Math.sin(angle) * r,
    });
  });
}

/**
 * Hop-1 on their preferred ring. Hop-2 (post expand) always render as a
 * cluster along the parent's ray. Focused parent fans out + pushes siblings.
 */
function layoutNodes(
  nodes: TreeNodeSummary[],
  edges: TreeEdge[],
  branchFocusId: string | null
): GraphNode[] {
  const hop1All = nodes.filter((n) => (n.hop ?? 1) === 1);
  const hop2All = nodes.filter((n) => n.hop === 2);
  const maxScore = Math.max(1, ...hop1All.map((n) => n.context_score), 1);

  const hop2ByParent = new Map<string, TreeNodeSummary[]>();
  for (const n of hop2All) {
    const pid = parentOfHop2(n, edges);
    if (!pid) continue;
    const list = hop2ByParent.get(pid) ?? [];
    list.push(n);
    hop2ByParent.set(pid, list);
  }

  const focusOk =
    branchFocusId != null && hop1All.some((n) => n.id === branchFocusId);
  const focusParentId = focusOk ? branchFocusId : null;
  const focusKids =
    focusParentId != null ? hop2ByParent.get(focusParentId) ?? [] : [];

  const placed = new Map<string, GraphNode>();

  for (const n of nodes) {
    if (n.relation === "seed" || n.hop === 0) {
      placed.set(n.id, { ...n, hop: 0, fx: 0, fy: 0 });
    }
  }

  const preferred = new Map<string, number>();
  const placePrefer = (
    group: TreeNodeSummary[],
    start: number,
    end: number
  ) => {
    const sorted = [...group].sort(
      (a, b) => b.context_score - a.context_score
    );
    sorted.forEach((n, i) => {
      const t = sorted.length === 1 ? 0.5 : i / (sorted.length - 1);
      preferred.set(n.id, start + t * (end - start));
    });
  };
  placePrefer(
    hop1All.filter((n) => n.relation === "collaborator"),
    -Math.PI / 2 + 0.2,
    Math.PI / 2 - 0.7
  );
  placePrefer(
    hop1All.filter((n) => n.relation === "website"),
    Math.PI / 2 - 0.55,
    Math.PI / 2 + 0.55
  );
  placePrefer(
    hop1All.filter((n) => n.relation === "follower"),
    Math.PI / 2 + 0.7,
    (3 * Math.PI) / 2 - 0.2
  );

  const hop1Angles = new Map<string, number>();

  if (!focusParentId || focusKids.length === 0) {
    for (const n of hop1All) {
      hop1Angles.set(n.id, preferred.get(n.id) ?? 0);
    }
  } else {
    const focusAngle = preferred.get(focusParentId) ?? 0;
    const fanHalf =
      Math.min(2.4, Math.max(0.9, 0.12 * focusKids.length)) / 2;
    const blockedHalf = fanHalf + FOCUS_GAP;
    hop1Angles.set(focusParentId, focusAngle);

    const others = hop1All
      .filter((n) => n.id !== focusParentId)
      .map((n) => ({
        id: n.id,
        pref: preferred.get(n.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          normalizeAngle(a.pref - focusAngle) -
          normalizeAngle(b.pref - focusAngle)
      );

    const freeSpan = 2 * Math.PI - 2 * blockedHalf;
    others.forEach((o, i) => {
      const t = others.length === 1 ? 0.5 : i / (others.length - 1);
      hop1Angles.set(
        o.id,
        normalizeAngle(focusAngle + blockedHalf + t * freeSpan)
      );
    });
  }

  for (const n of hop1All) {
    const angle = hop1Angles.get(n.id) ?? 0;
    let r = radiusForScore(n.context_score, maxScore);
    if (n.id === focusParentId) r = Math.max(r, RING1_MAX * 0.85);
    placed.set(n.id, {
      ...n,
      hop: 1,
      fx: Math.cos(angle) * r,
      fy: Math.sin(angle) * r,
    });
  }

  // Always place hop-2 for every expanded parent — cluster or full fan
  for (const [parentId, kids] of hop2ByParent) {
    const parent = placed.get(parentId);
    if (!parent || parent.fx == null || parent.fy == null) continue;
    const parentAngle = Math.atan2(parent.fy, parent.fx);
    const parentR = Math.hypot(parent.fx, parent.fy);
    placeKidsOnRay(
      kids,
      parentAngle,
      parentR,
      parentId === focusParentId,
      maxScore,
      parentId,
      placed
    );
  }

  return [...placed.values()];
}

function filterTree(
  nodes: TreeNodeSummary[],
  edges: TreeEdge[]
): { nodes: TreeNodeSummary[]; edges: TreeEdge[] } {
  const kept = nodes.filter(keepOnTree);
  const ids = new Set(kept.map((n) => n.id));
  return {
    nodes: kept,
    edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

interface Props {
  nodes: TreeNodeSummary[];
  edges: TreeEdge[];
  seedId: string;
  selectedId: string | null;
  onSelect: (node: TreeNodeSummary) => void;
  /** Case-insensitive name filter: matches glow, everything else dims. */
  searchQuery?: string;
}

export function RadialTree({
  nodes: rawNodes,
  edges: rawEdges,
  seedId,
  selectedId,
  onSelect,
  searchQuery,
}: Props) {
  const query = (searchQuery ?? "").trim().toLowerCase();
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(
    undefined
  );
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [branchFocusId, setBranchFocusId] = useState<string | null>(null);
  const panDrag = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const skipNodeClick = useRef(false);
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [animNodes, setAnimNodes] = useState<GraphNode[]>([]);

  const { nodes, edges } = useMemo(
    () => filterTree(rawNodes, rawEdges),
    [rawNodes, rawEdges]
  );

  useEffect(() => {
    if (selectedId == null) setBranchFocusId(null);
  }, [selectedId]);

  const targetNodes = useMemo(
    () => layoutNodes(nodes, edges, branchFocusId),
    [nodes, edges, branchFocusId]
  );

  // Smoothly lerp positions toward layout targets when focus/tree changes
  useEffect(() => {
    const from = new Map(posRef.current);
    const targets = new Map(
      targetNodes.map((n) => [
        n.id,
        { x: n.fx ?? 0, y: n.fy ?? 0 },
      ])
    );

    // Seed missing starts at target (first paint) or near parent/origin
    for (const n of targetNodes) {
      if (!from.has(n.id)) {
        if (n.hop === 2 && n.parentId && from.has(n.parentId)) {
          const p = from.get(n.parentId)!;
          from.set(n.id, { x: p.x, y: p.y });
        } else {
          from.set(n.id, { x: n.fx ?? 0, y: n.fy ?? 0 });
        }
      }
    }

    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = easeOutCubic(
        Math.min(1, (now - start) / ANIM_MS)
      );
      const next: GraphNode[] = targetNodes.map((n) => {
        const a = from.get(n.id) ?? { x: 0, y: 0 };
        const b = targets.get(n.id) ?? { x: 0, y: 0 };
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        return { ...n, fx: x, fy: y, x, y };
      });
      const pos = new Map(
        next.map((n) => [n.id, { x: n.fx ?? 0, y: n.fy ?? 0 }])
      );
      posRef.current = pos;
      setAnimNodes(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetNodes]);

  const graphData = useMemo(() => {
    const gNodes = animNodes.length ? animNodes : targetNodes;
    const visibleIds = new Set(gNodes.map((n) => n.id));
    const links: GraphLink[] = edges
      .filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to))
      .map((e) => ({
        source: e.from,
        target: e.to,
        via: e.via,
        context_score: e.context_score,
        hop: e.hop ?? 1,
      }));
    return { nodes: gNodes, links };
  }, [animNodes, targetNodes, edges]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({
        w: Math.max(320, Math.floor(cr.width)),
        h: Math.max(320, Math.floor(cr.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength?.(0);
    fg.d3Force("center")?.strength?.(0);
    fg.d3Force("link")?.strength?.(0);
    const zoomApi = fg as ForceGraphMethods<GraphNode, GraphLink> & {
      minZoom?: (n: number) => void;
      maxZoom?: (n: number) => void;
    };
    zoomApi.minZoom?.(0.2);
    zoomApi.maxZoom?.(6);
  }, []);

  const treeKey = `${seedId}:${nodes.length}:${edges.length}`;
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const pad = branchFocusId ? 48 : 64;
    // Fit after expand animation settles
    const t = window.setTimeout(() => fg.zoomToFit(320, pad), ANIM_MS + 40);
    return () => window.clearTimeout(t);
  }, [treeKey, branchFocusId]);

  const toSummary = (n: GraphNode): TreeNodeSummary => ({
    id: n.id,
    name: n.name,
    relation: n.relation,
    hop: n.hop,
    parentId: n.parentId,
    context_score: n.context_score,
    context_signals: n.context_signals,
    photo_url: n.photo_url,
    linkedin_url: n.linkedin_url,
    website_url: n.website_url,
    blog_url: n.blog_url,
    has_linkedin: !!(n.has_linkedin || n.linkedin_url),
    has_writing_surface: !!(
      n.has_writing_surface ||
      n.website_url ||
      n.blog_url
    ),
    surface_score: n.surface_score ?? 0,
    surface_signals: n.surface_signals ?? [],
    surface_score_max: n.surface_score_max ?? 12,
    can_expand: !!n.can_expand || !!n.linkedin_url,
    bridge_seed_count: n.bridge_seed_count,
  });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    panDrag.current = {
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
    };
    skipNodeClick.current = false;
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = panDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const fg = fgRef.current;
    if (!fg) return;

    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    if (!skipNodeClick.current) {
      if (Math.hypot(dx, dy) <= 4) return;
      skipNodeClick.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    drag.lastX = e.clientX;
    drag.lastY = e.clientY;

    const k = Math.max(0.01, fg.zoom());
    const center = fg.centerAt();
    fg.centerAt(center.x - dx / k, center.y - dy / k, 0);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (panDrag.current?.pointerId !== e.pointerId) return;
    panDrag.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* already released */
    }
    window.setTimeout(() => {
      skipNodeClick.current = false;
    }, 0);
  };

  return (
    <div className="graph-shell" ref={shellRef}>
      <div
        className="graph-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={size.w}
          height={size.h}
          nodeId="id"
          linkColor={(l) => {
            const link = l as GraphLink;
            if (link.hop === 2) return LINK_HOP2;
            if (link.via === "github-collaborator") return LINK_COLLAB;
            if (link.via === "website-colocated") return LINK_WEBSITE;
            return LINK_FOLLOWER;
          }}
          linkWidth={(l) => {
            const link = l as GraphLink;
            if (link.hop === 2) return 1;
            return 1 + Math.min(4, (link.context_score || 0) / 3);
          }}
          linkDirectionalParticles={0}
          backgroundColor="rgba(0,0,0,0)"
          enableNodeDrag={false}
          enableZoomInteraction={true}
          enablePanInteraction={false}
          cooldownTicks={0}
          warmupTicks={0}
          onNodeClick={(node) => {
            if (skipNodeClick.current) return;
            const n = node as GraphNode;
            if (n.hop === 0 || n.id === seedId) {
              setBranchFocusId(null);
            } else if (n.hop === 1) {
              setBranchFocusId((prev) => (prev === n.id ? null : n.id));
            } else if (n.hop === 2) {
              const parent = n.parentId ?? parentOfHop2(toSummary(n), edges);
              if (parent) setBranchFocusId(parent);
            }
            onSelect(toSummary(n));
          }}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as GraphNode;
            const x = n.x ?? 0;
            const y = n.y ?? 0;
            const isSeed = n.hop === 0 || n.id === seedId;
            const selected = n.id === selectedId;
            const focused =
              branchFocusId != null &&
              (n.id === branchFocusId || n.parentId === branchFocusId);
            const base = isSeed
              ? SEED
              : n.hop === 2
                ? HOP2
                : n.relation === "collaborator"
                  ? COLLAB
                  : n.relation === "website"
                    ? WEBSITE
                    : FOLLOWER;
            const r = isSeed
              ? 14
              : n.hop === 2
                ? 4 + Math.min(5, n.context_score / 2)
                : 7 + Math.min(8, n.context_score);

            const searchMatch =
              !query || n.name.toLowerCase().includes(query);

            ctx.beginPath();
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            ctx.fillStyle = base;
            ctx.globalAlpha =
              branchFocusId && !isSeed && !focused
                ? 0.32
                : n.hop === 2 && n.parentId !== branchFocusId
                  ? 0.75
                  : 1;
            if (query && !searchMatch) ctx.globalAlpha *= 0.15;
            ctx.fill();
            ctx.globalAlpha = 1;

            if (query && searchMatch && !isSeed) {
              ctx.strokeStyle = "rgba(232, 197, 106, 0.9)";
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
            }

            // Bridge ring: reachable from 2+ seed-set members
            if ((n.bridge_seed_count ?? 0) >= 2 && !isSeed) {
              ctx.beginPath();
              ctx.arc(x, y, r + 3 / globalScale, 0, 2 * Math.PI);
              ctx.strokeStyle = "rgba(232, 197, 106, 0.85)";
              ctx.setLineDash([4 / globalScale, 3 / globalScale]);
              ctx.lineWidth = 1.6 / globalScale;
              ctx.stroke();
              ctx.setLineDash([]);
            }

            if (selected) {
              ctx.strokeStyle = "#fff8e7";
              ctx.lineWidth = 2.5 / globalScale;
              ctx.stroke();
            } else if (n.id === branchFocusId) {
              ctx.strokeStyle = "rgba(244, 232, 193, 0.7)";
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
            } else if (isSeed) {
              ctx.strokeStyle = "rgba(244, 232, 193, 0.55)";
              ctx.lineWidth = 2 / globalScale;
              ctx.stroke();
            }

            // Identity-surface tick: yellow → orange → red by weighted score
            if (!isSeed) {
              const sScore = n.surface_score ?? 0;
              const sMax = n.surface_score_max ?? 10;
              if (sScore > 0) {
                const tickR =
                  Math.max(1.8, 2.4 / globalScale) *
                  (0.85 + 0.45 * Math.min(1, sScore / sMax));
                ctx.beginPath();
                ctx.arc(x + r * 0.72, y - r * 0.72, tickR, 0, 2 * Math.PI);
                ctx.fillStyle = surfaceScoreToCss(sScore, sMax);
                ctx.fill();
                ctx.strokeStyle = "rgba(18, 21, 26, 0.55)";
                ctx.lineWidth = 0.8 / globalScale;
                ctx.stroke();
              }
            }

            // Labels: hop-2 only when that branch is focused (cluster stays clean)
            const showLabel =
              (isSeed ||
                n.hop === 1 ||
                (n.hop === 2 && n.parentId === branchFocusId)) &&
              (!query || searchMatch || isSeed);
            if (showLabel) {
              const label = isSeed
                ? n.name
                : (n.surface_score ?? 0) > 0
                  ? `${n.name} · ctx ${n.context_score} · surf ${n.surface_score}`
                  : `${n.name} · ${n.context_score}`;
              const fontSize = Math.max(
                (n.hop === 2 ? 9 : 10) / globalScale,
                2.2
              );
              ctx.font = `${isSeed ? 600 : 500} ${fontSize}px "DM Sans", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle =
                branchFocusId && !isSeed && !focused
                  ? "rgba(250, 246, 237, 0.35)"
                  : n.hop === 2
                    ? "rgba(250, 246, 237, 0.8)"
                    : "rgba(250, 246, 237, 0.92)";
              ctx.fillText(label, x, y + r + 3);
            }
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as GraphNode;
            const r = n.hop === 0 ? 18 : n.hop === 2 ? 10 : 12;
            ctx.beginPath();
            ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
        />
      </div>
      <div className="graph-legend">
        <span>
          <i style={{ background: SEED }} /> seed
        </span>
        <span>
          <i style={{ background: COLLAB }} /> collaborator
        </span>
        <span>
          <i style={{ background: FOLLOWER }} /> follower
        </span>
        <span>
          <i style={{ background: WEBSITE }} /> same site
        </span>
        <span>
          <i style={{ background: HOP2 }} /> hop-2 cluster
        </span>
        <span className="surface-legend" title="Identity surface: LinkedIn + site/blog weigh more than X">
          <i className="surface-grad" /> surface low→high
        </span>
        <span className="hint">
          click branch to fan · drag pan · scroll zoom · score ≥ 4 · same-site always shown
        </span>
      </div>
    </div>
  );
}
