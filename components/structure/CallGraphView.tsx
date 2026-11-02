import type { CallGraph } from "@/lib/structure/graph";
import { NODE_HEIGHT, NODE_WIDTH, layoutGraph } from "./graphLayout";
import graph from "./callGraph.module.css";

const MIN_SCALE = 0.75;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clipStart(text: string, max: number): string {
  return text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
}

export function CallGraphView({ data, title }: { data: CallGraph; title: string }) {
  const layout = layoutGraph(data);

  return (
    <div className={graph.frame}>
      <svg
        className={graph.svg}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ maxWidth: layout.width, minWidth: Math.round(layout.width * MIN_SCALE) }}
        aria-labelledby="call-graph-title"
      >
        <title id="call-graph-title">{title}</title>
        <defs>
          <marker id="call-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={graph.arrow} />
          </marker>
        </defs>

        {layout.columns.map((c) => (
          <text key={c.column} x={c.x} y={22} className={graph.columnLabel}>
            {c.label}
          </text>
        ))}

        <g>
          {layout.edges.map((e) => (
            <path
              key={`${e.callerId}-${e.calleeId}`}
              d={e.d}
              className={e.backward ? `${graph.edge} ${graph.edgeBack}` : graph.edge}
              style={{ strokeOpacity: 0.22 + 0.7 * e.confidence, strokeWidth: 0.8 + 1.4 * e.confidence }}
              markerEnd="url(#call-arrow)"
            >
              <title>{`Confidence ${e.confidence.toFixed(2)}, called on line ${e.callLines.join(", ")}`}</title>
            </path>
          ))}
        </g>

        <g>
          {layout.nodes.map((n) => {
            const isRoot = n.symbolId === data.rootId;
            const classes = [graph.node, isRoot && graph.root, n.isEntryPoint && graph.entry].filter(Boolean).join(" ");
            return (
              <a key={n.symbolId} href={`/symbols/${n.symbolId}/graph?depth=${data.depth}`} className={classes}>
                <title>{`${n.name} (${n.kind}) in ${n.path}, lines ${n.startLine} to ${n.endLine}${n.isEntryPoint ? ", entry point" : ""}`}</title>
                <rect x={n.x} y={n.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={3} />
                <text x={n.x + 12} y={n.y + 19} className={graph.name}>
                  {clip(n.name, 24)}
                </text>
                <text x={n.x + 12} y={n.y + 35} className={graph.path}>
                  {n.kind === "module" ? "top-level code" : clipStart(n.path, 30)}
                </text>
                {n.isEntryPoint && <rect x={n.x + NODE_WIDTH - 10} y={n.y + 6} width={4} height={NODE_HEIGHT - 12} className={graph.entryMark} />}
              </a>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
