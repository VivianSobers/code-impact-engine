"use client";

import { useState } from "react";
import type { ImpactRow } from "@/lib/structure/impact";
import type { SymbolDetail } from "@/lib/structure/types";
import { WorkflowGraph } from "./WorkflowGraph";
import styles from "./workflowGraph.module.css";

interface ImpactViewProps {
  target: SymbolDetail;
  rows: ImpactRow[];
  children: React.ReactNode;
}

export function ImpactView({ target, rows, children }: ImpactViewProps) {
  const [viewMode, setViewMode] = useState<"graph" | "table" | "both">("graph");

  return (
    <div>
      <div className={styles.viewTabs} role="tablist" aria-label="Impact presentation mode">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "graph"}
          className={`${styles.viewTab} ${viewMode === "graph" ? styles.viewTabActive : ""}`}
          onClick={() => setViewMode("graph")}
        >
          🟣 Workflow Graph
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "table"}
          className={`${styles.viewTab} ${viewMode === "table" ? styles.viewTabActive : ""}`}
          onClick={() => setViewMode("table")}
        >
          📋 Tabular Breakdown
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === "both"}
          className={`${styles.viewTab} ${viewMode === "both" ? styles.viewTabActive : ""}`}
          onClick={() => setViewMode("both")}
        >
          🔀 Split View
        </button>
      </div>

      {(viewMode === "graph" || viewMode === "both") && (
        <WorkflowGraph target={target} rows={rows} title={`Impact workflow of ${target.name}`} />
      )}

      {(viewMode === "table" || viewMode === "both") && <div>{children}</div>}
    </div>
  );
}
