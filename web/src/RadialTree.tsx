import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
} from "react-force-graph-2d";
import type { TreeEdge, TreeNodeSummary } from "./api";

export interface GraphNode extends NodeObject {
  id: string;
  name: string;
  relation: TreeNodeSummary["relation"];
  context_score: number;
  context_signals: string[];
  photo_url?: string;
  fx?: number;
  fy?: number;
}

export interface GraphLink extends LinkObject {
  source: string;
  target: string;
  via: TreeEdge["via"];
  context_score: number;
}

const COLLAB = "#3dba9c";
const FOLLOWER = "#e07a5f";
const SEED = "#f4e8c1";
const LINK_COLLAB = "rgba(61, 186, 156, 0.45)";
const LINK_FOLLOWER = "rgba(224, 122, 95, 0.4)";

/** Higher context → closer to center. */
function radiusForScore(score: number, maxScore: number): number {
  const MIN = 70;
  const MAX = 280;
  if (maxScore <= 0) return (MIN + MAX) / 2;
  const t = 1 - score / maxScore;
  return MIN + t * (MAX - MIN);
}

function layoutNodes(nodes: TreeNodeSummary[]): GraphNode[] {
  const neighbors = nodes.filter((n) => n.relation !== "seed");
  const maxScore = Math.max(1, ...neighbors.map((n) => n.context_score));

  const collabs = neighbors.filter((n) => n.relation === "collaborator");
  const followers = neighbors.filter((n) => n.relation === "follower");

  const placed: GraphNode[] = [];

  for (const n of nodes) {
    if (n.relation === "seed") {
      placed.push({ ...n, fx: 0, fy: 0 });
    }
  }

  const placeArc = (
    group: TreeNodeSummary[],
    startAngle: number,
    endAngle: number
  ) => {
    const sorted = [...group].sort(
      (a, b) => b.context_score - a.context_score
    );
    sorted.forEach((n, i) => {
      const t = sorted.length === 1 ? 0.5 : i / (sorted.length - 1);
      const angle = startAngle + t * (endAngle - startAngle);
      const r = radiusForScore(n.context_score, maxScore);
      placed.push({
        ...n,
        fx: Math.cos(angle) * r,
        fy: Math.sin(angle) * r,
      });
    });
  };

  // Collaborators on the right hemisphere, followers on the left
  placeArc(collabs, -Math.PI / 2 + 0.25, Math.PI / 2 - 0.25);
  placeArc(followers, Math.PI / 2 + 0.25, (3 * Math.PI) / 2 - 0.25);

  return placed;
}

interface Props {
  nodes: TreeNodeSummary[];
  edges: TreeEdge[];
  seedId: string;
  selectedId: string | null;
  onSelect: (node: TreeNodeSummary) => void;
}

export function RadialTree({
  nodes,
  edges,
  seedId,
  selectedId,
  onSelect,
}: Props) {
  const fgRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(
    undefined
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  const graphData = useMemo(() => {
    const gNodes = layoutNodes(nodes);
    const links: GraphLink[] = edges.map((e) => ({
      source: e.from,
      target: e.to,
      via: e.via,
      context_score: e.context_score,
    }));
    return { nodes: gNodes, links };
  }, [nodes, edges]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({ w: Math.max(320, cr.width), h: Math.max(320, cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // Kill default charge chaos — positions are fixed via fx/fy
    fg.d3Force("charge")?.strength?.(0);
    fg.d3Force("center")?.strength?.(0);
    fg.d3Force("link")?.strength?.(0);
    fg.zoomToFit(400, 60);
  }, [graphData, size]);

  return (
    <div className="graph-stage" ref={wrapRef}>
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={size.w}
        height={size.h}
        nodeId="id"
        linkColor={(l) =>
          (l as GraphLink).via === "github-collaborator"
            ? LINK_COLLAB
            : LINK_FOLLOWER
        }
        linkWidth={(l) =>
          1 + Math.min(4, ((l as GraphLink).context_score || 0) / 3)
        }
        linkDirectionalParticles={0}
        backgroundColor="rgba(0,0,0,0)"
        enableNodeDrag={false}
        cooldownTicks={30}
        onNodeClick={(node) => {
          const n = node as GraphNode;
          onSelect({
            id: n.id,
            name: n.name,
            relation: n.relation,
            context_score: n.context_score,
            context_signals: n.context_signals,
            photo_url: n.photo_url,
          });
        }}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const n = node as GraphNode;
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          const isSeed = n.relation === "seed" || n.id === seedId;
          const selected = n.id === selectedId;
          const base =
            n.relation === "collaborator"
              ? COLLAB
              : n.relation === "follower"
                ? FOLLOWER
                : SEED;
          const r = isSeed ? 14 : 7 + Math.min(8, n.context_score);

          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          ctx.fillStyle = base;
          ctx.fill();

          if (selected) {
            ctx.strokeStyle = "#fff8e7";
            ctx.lineWidth = 2.5 / globalScale;
            ctx.stroke();
          } else if (isSeed) {
            ctx.strokeStyle = "rgba(244, 232, 193, 0.55)";
            ctx.lineWidth = 2 / globalScale;
            ctx.stroke();
          }

          const label = isSeed
            ? n.name
            : `${n.name} · ${n.context_score}`;
          const fontSize = Math.max(10 / globalScale, 2.4);
          ctx.font = `${isSeed ? 600 : 500} ${fontSize}px "DM Sans", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = "rgba(250, 246, 237, 0.92)";
          ctx.fillText(label, x, y + r + 3);
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as GraphNode;
          const r = n.relation === "seed" ? 18 : 12;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
      />
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
        <span className="hint">closer = richer context</span>
      </div>
    </div>
  );
}
