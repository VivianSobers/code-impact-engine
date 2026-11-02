"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImpactRow } from "@/lib/structure/impact";
import { encodePath } from "@/lib/structure/params";
import type { SymbolDetail } from "@/lib/structure/types";
import styles from "./workflowGraph.module.css";
import {
  computeWorkflowLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
  traceConnectedPaths,
  type WorkflowNode,
} from "./workflowLayout";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clipStart(text: string, max: number): string {
  return text.length > max ? `…${text.slice(text.length - max + 1)}` : text;
}

interface WorkflowGraphProps {
  target: SymbolDetail;
  rows: ImpactRow[];
  title?: string;
}

export function WorkflowGraph({ target, rows, title = "Interactive Impact Workflow Graph" }: WorkflowGraphProps) {
  const [entryPointsOnly, setEntryPointsOnly] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(target.symbolId);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({ x: 0, y: 0, panX: 0, panY: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);

  // Compute Layout
  const layout = useMemo(() => {
    return computeWorkflowLayout(target, rows, { entryPointsOnly });
  }, [target, rows, entryPointsOnly]);

  // Traced active paths for hover or selection
  const activePaths = useMemo(() => {
    const focusId = hoveredNodeId ?? selectedNodeId;
    if (focusId === null || !layout.nodeMap.has(focusId)) return null;
    return traceConnectedPaths(focusId, layout);
  }, [hoveredNodeId, selectedNodeId, layout]);

  // Fit to screen calculation
  const fitToView = useCallback(() => {
    if (!viewportRef.current) return;
    const { clientWidth, clientHeight } = viewportRef.current;
    if (clientWidth <= 0 || clientHeight <= 0) return;
    const padding = 32;
    const scaleX = (clientWidth - padding) / layout.width;
    const scaleY = (clientHeight - padding) / layout.height;
    const newScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.4), 1.15);
    setScale(Number(newScale.toFixed(2)));
    setPan({
      x: Math.max(0, (clientWidth - layout.width * newScale) / 2),
      y: Math.max(0, (clientHeight - layout.height * newScale) / 2),
    });
  }, [layout.width, layout.height]);

  // Reset to natural 100% scale
  const resetZoom = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  // Zoom helpers
  const zoomIn = () => setScale((s) => Math.min(Number((s + 0.15).toFixed(2)), 2.2));
  const zoomOut = () => setScale((s) => Math.max(Number((s - 0.15).toFixed(2)), 0.35));

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag with primary mouse button
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      setScale((s) => Math.min(Math.max(Number((s + delta).toFixed(2)), 0.35), 2.2));
    }
  };

  // Currently selected node object
  const selectedNode = selectedNodeId ? layout.nodeMap.get(selectedNodeId) : null;
  const upstreamCallers = selectedNodeId ? (layout.incomingEdges.get(selectedNodeId) ?? []) : [];
  const downstreamCallees = selectedNodeId ? (layout.outgoingEdges.get(selectedNodeId) ?? []) : [];
  const entryCount = rows.filter((r) => r.isEntryPoint).length;

  return (
    <section className={styles.container} aria-label={title}>
      {/* Control Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarSection}>
          <span className={styles.toolbarLabel}>Filter Flow:</span>
          <button
            type="button"
            className={`${styles.pillButton} ${!entryPointsOnly ? styles.pillButtonActive : ""}`}
            onClick={() => setEntryPointsOnly(false)}
          >
            All Call Paths ({layout.nodes.length} nodes)
          </button>
          <button
            type="button"
            className={`${styles.pillButton} ${entryPointsOnly ? styles.pillButtonActive : ""}`}
            onClick={() => setEntryPointsOnly(true)}
            disabled={entryCount === 0}
            title={entryCount === 0 ? "No entry points reached this symbol" : "Show only paths originating from entry points"}
          >
            ⚡ Entry Points Only ({entryCount})
          </button>
        </div>

        <div className={styles.toolbarSection}>
          <div className={styles.zoomGroup} role="group" aria-label="Zoom controls">
            <button type="button" className={styles.zoomBtn} onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
              −
            </button>
            <span className={styles.zoomText}>{Math.round(scale * 100)}%</span>
            <button type="button" className={styles.zoomBtn} onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
              +
            </button>
          </div>
          <button type="button" className={styles.pillButton} onClick={resetZoom} title="Reset zoom to 100%">
            Reset
          </button>
          <button type="button" className={styles.pillButton} onClick={fitToView} title="Fit entire workflow graph in view">
            Fit to View
          </button>
        </div>
      </div>

      {/* Main Graph Viewport: Crisp White Background */}
      <div className={styles.canvasCard}>
        <div
          ref={viewportRef}
          className={styles.viewport}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          tabIndex={0}
          role="region"
          aria-label="Interactive change impact workflow canvas"
        >
          <svg
            className={styles.svg}
            width={Math.round(layout.width * scale)}
            height={Math.round(layout.height * scale)}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: "top left",
            }}
          >
            <defs>
              {/* Vibrant magenta target gradient */}
              <linearGradient id="magenta-target-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d946ef" />
                <stop offset="100%" stopColor="#a21caf" />
              </linearGradient>

              {/* Purple Arrowhead marker */}
              <marker
                id="purple-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" className={styles.arrowHead} />
              </marker>

              {/* Active Purple Arrowhead marker */}
              <marker
                id="purple-arrow-active"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8 5 L 0 8.5 z" className={styles.arrowHeadActive} />
              </marker>

              {/* Purple glow filter for active connections */}
              <filter id="purple-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#9333ea" floodOpacity="0.75" />
              </filter>
            </defs>

            {/* Stage Columns & Column Headers with generous spacing */}
            <g aria-label="Workflow stages">
              {layout.stages.map((st) => (
                <g key={st.column}>
                  <rect
                    x={st.x - 16}
                    y={16}
                    width={st.width + 32}
                    height={layout.height - 32}
                    rx={12}
                    className={styles.stageBand}
                  />
                  <text x={st.x + 8} y={38} className={styles.stageTitle}>
                    {st.label}
                  </text>
                  <text x={st.x + 8} y={53} className={styles.stageSubtitle}>
                    {st.subtitle}
                  </text>
                </g>
              ))}
            </g>

            {/* Thin curved purple arrows */}
            <g aria-label="Call workflow connections">
              {layout.edges.map((edge) => {
                const isActive = activePaths ? activePaths.edges.has(edge.id) : false;
                const isDimmed = activePaths ? !isActive : false;

                const classes = [
                  styles.edge,
                  edge.isBackward && styles.edgeBackward,
                  isActive && styles.edgeActive,
                  isDimmed && styles.edgeDimmed,
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <path
                    key={edge.id}
                    d={edge.d}
                    className={classes}
                    markerEnd={isActive ? "url(#purple-arrow-active)" : "url(#purple-arrow)"}
                    filter={isActive ? "url(#purple-glow)" : undefined}
                  >
                    <title>{`Call resolved with confidence ${edge.confidence.toFixed(2)}`}</title>
                  </path>
                );
              })}
            </g>

            {/* Magenta rounded nodes */}
            <g aria-label="Workflow symbols">
              {layout.nodes.map((node) => {
                const isSelected = selectedNodeId === node.symbolId;
                const isHovered = hoveredNodeId === node.symbolId;
                const isActive = activePaths ? activePaths.nodes.has(node.symbolId) : false;
                const isDimmed = activePaths ? !isActive : false;

                const groupClasses = [
                  styles.nodeGroup,
                  node.isTarget && styles.nodeTarget,
                  isSelected && styles.nodeSelected,
                  isDimmed && styles.nodeDimmed,
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <g
                    key={node.symbolId}
                    className={groupClasses}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNodeId(node.symbolId);
                    }}
                    onMouseEnter={() => setHoveredNodeId(node.symbolId)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedNodeId(node.symbolId);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`${node.name} (${node.kind})${node.isTarget ? ", modified target" : ""}${node.isEntryPoint ? ", entry point" : ""}`}
                  >
                    <title>
                      {`${node.name} (${node.kind})\nLocation: ${node.path}\n${node.isTarget ? "Modified target symbol" : `${node.depth} step(s) away from target`}${node.isEntryPoint ? "\nEntry point (external access route)" : ""}`}
                    </title>

                    {/* Magenta rounded rectangle */}
                    <rect
                      x={0}
                      y={0}
                      width={node.width}
                      height={node.height}
                      rx={16}
                      ry={16}
                      className={styles.nodeBox}
                    />

                    {/* Left connection port (callee input) */}
                    <circle cx={0} cy={node.height / 2} r={3.5} className={styles.portDot} />
                    {/* Right connection port (caller output) */}
                    <circle cx={node.width} cy={node.height / 2} r={3.5} className={styles.portDot} />

                    {/* Kind Badge Pill */}
                    <rect
                      x={14}
                      y={10}
                      width={Math.min(node.kind.length * 7 + 14, 75)}
                      height={18}
                      rx={6}
                      fill={node.isTarget ? "rgba(255, 255, 255, 0.25)" : "#fdf4ff"}
                      stroke={node.isTarget ? "rgba(255, 255, 255, 0.5)" : "#f0abfc"}
                      strokeWidth={1}
                      className={styles.badgePill}
                    />
                    <text
                      x={14 + Math.min(node.kind.length * 7 + 14, 75) / 2}
                      y={20}
                      fill={node.isTarget ? "#ffffff" : "#a21caf"}
                      className={styles.badgeText}
                    >
                      {node.kind}
                    </text>

                    {/* Role / Entry Badge */}
                    {node.isTarget ? (
                      <g>
                        <rect
                          x={node.width - 80}
                          y={10}
                          width={66}
                          height={18}
                          rx={6}
                          fill="rgba(255, 255, 255, 0.9)"
                          className={styles.badgePill}
                        />
                        <text
                          x={node.width - 47}
                          y={20}
                          fill="#86198f"
                          className={styles.badgeText}
                        >
                          TARGET
                        </text>
                      </g>
                    ) : node.isEntryPoint ? (
                      <g>
                        <rect
                          x={node.width - 76}
                          y={10}
                          width={62}
                          height={18}
                          rx={6}
                          fill="#fef2f2"
                          stroke="#fecaca"
                          strokeWidth={1}
                          className={styles.badgePill}
                        />
                        <text
                          x={node.width - 45}
                          y={20}
                          fill="#b91c1c"
                          className={styles.badgeText}
                        >
                          ⚡ ENTRY
                        </text>
                      </g>
                    ) : (
                      <g>
                        <text
                          x={node.width - 14}
                          y={21}
                          textAnchor="end"
                          fill="#a21caf"
                          fontSize="10"
                          fontWeight="600"
                          fontFamily="var(--mono)"
                        >
                          {node.depth === 1 ? "Step 1" : `Step ${node.depth}`}
                        </text>
                      </g>
                    )}

                    {/* Node Symbol Name */}
                    <text x={14} y={45} className={styles.nodeName}>
                      {clip(node.name, 22)}
                    </text>

                    {/* Node File Path */}
                    <text x={14} y={64} className={styles.nodeSub}>
                      {clipStart(node.path, 28)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      {/* Visual Legend */}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendTargetSample} aria-hidden="true" />
          <strong>Target Symbol</strong> (Modified code)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendNodeSample} aria-hidden="true" />
          <strong>Magenta Node</strong> (Caller in impact path)
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendArrowSample} aria-hidden="true" />
          <strong>Purple Curved Arrow</strong> (Invocation path)
        </span>
        <span className={styles.legendItem}>
          <span style={{ color: "#b91c1c", fontWeight: 700 }}>⚡ ENTRY</span>
          <span>External API / Route</span>
        </span>
      </div>

      {/* Selection Inspector Drawer */}
      {selectedNode && (
        <div className={styles.inspector} aria-live="polite">
          <div className={styles.inspectorHeader}>
            <div className={styles.inspectorTitleRow}>
              <span className={styles.inspectorSymbolName}>{selectedNode.name}</span>
              <span className={styles.pillButton} style={{ borderColor: "#d946ef", color: "#86198f" }}>
                {selectedNode.kind}
              </span>
              {selectedNode.isTarget && (
                <span className={styles.pillButtonActive}>🎯 Modified Target</span>
              )}
              {selectedNode.isEntryPoint && (
                <span className={styles.pillButton} style={{ borderColor: "#ef4444", color: "#b91c1c", background: "#fef2f2" }}>
                  ⚡ External Entry Point
                </span>
              )}
            </div>

            <div className={styles.inspectorActions}>
              <Link className={styles.actionBtn} href={`/symbols/${selectedNode.symbolId}`}>
                View symbol
              </Link>
              <Link className={styles.actionBtn} href={`/symbols/${selectedNode.symbolId}/graph`}>
                Call graph
              </Link>
              {!selectedNode.isTarget && (
                <Link className={`${styles.actionBtn} ${styles.actionBtnPrimary}`} href={`/impact?symbol=${selectedNode.symbolId}`}>
                  Analyse this impact
                </Link>
              )}
              <Link
                className={styles.actionBtn}
                href={`/repositories/${selectedNode.repoId}/files/${encodePath(selectedNode.path)}`}
              >
                Open file
              </Link>
            </div>
          </div>

          <div className={styles.inspectorMeta}>
            <div className={styles.inspectorMetaItem}>
              <span className={styles.inspectorMetaLabel}>File:</span>
              <code>{selectedNode.path}</code>
            </div>
            <div className={styles.inspectorMetaItem}>
              <span className={styles.inspectorMetaLabel}>Distance:</span>
              <span>{selectedNode.isTarget ? "0 steps (Target)" : `${selectedNode.depth} step(s) away from target`}</span>
            </div>
            {!selectedNode.isTarget && (
              <div className={styles.inspectorMetaItem}>
                <span className={styles.inspectorMetaLabel}>Min Confidence:</span>
                <span>{(selectedNode.minConfidence * 100).toFixed(0)}%</span>
              </div>
            )}
          </div>

          <div className={styles.inspectorPaths}>
            <div className={styles.pathColumn}>
              <div className={styles.pathHeading}>
                Incoming Callers ({upstreamCallers.length}):
              </div>
              {upstreamCallers.length === 0 ? (
                <span className={styles.nodeSub}>Root entry point / no earlier callers in this path</span>
              ) : (
                <ul className={styles.pathList}>
                  {upstreamCallers.map((cid) => {
                    const cNode = layout.nodeMap.get(cid);
                    return (
                      <li key={cid} className={styles.pathItem}>
                        <button
                          type="button"
                          className={styles.pathItemBtn}
                          onClick={() => setSelectedNodeId(cid)}
                        >
                          {cNode ? cNode.name : `#${cid}`}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className={styles.pathColumn}>
              <div className={styles.pathHeading}>
                Outgoing Callees ({downstreamCallees.length}):
              </div>
              {downstreamCallees.length === 0 ? (
                <span className={styles.nodeSub}>Leaves / target endpoint reached</span>
              ) : (
                <ul className={styles.pathList}>
                  {downstreamCallees.map((cid) => {
                    const cNode = layout.nodeMap.get(cid);
                    return (
                      <li key={cid} className={styles.pathItem}>
                        <button
                          type="button"
                          className={styles.pathItemBtn}
                          onClick={() => setSelectedNodeId(cid)}
                        >
                          {cNode ? cNode.name : `#${cid}`}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
