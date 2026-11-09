import { ActionIcon, Box, Group, Tooltip } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { IconFocusCentered, IconMinus, IconPlus } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { layoutTree } from "@/utils/treeLayout";

// A drawn tree: moves as boxes, joined by curved lines, branching from left to right.
// Drag to move it, scroll to zoom.

export type DiagramNode = {
  id: string;
  label: string;
  // root: the start position; mine/theirs: whose move it is; ghost: a suggestion that is not
  // in the tree (dashed); other: a summary like "other moves"
  kind: "root" | "mine" | "theirs" | "ghost" | "other";
  children: DiagramNode[];
  // Shown when the node has moves that can be opened or closed
  toggle?: { open: boolean; hidden: number; onToggle: () => void };
  onClick?: () => void;
  // Who played the move: white moves are drawn light, black moves dark
  side?: "white" | "black";
  // Small round flag at the top left (e.g. "not the most played move on Lichess")
  flag?: { color: string };
  // Small share bars below the move
  bars?: { value: number | undefined; color: string }[];
  // A second line of text instead of the bars
  note?: string;
  // Border color, e.g. for the status of a move in your games
  accent?: string;
  // Small round marker at the top right (transpositions)
  marker?: { color: string; onClick: () => void };
  title?: string;
};

export type DiagramLink = { from: string; to: string; color: string };

export const NODE_W = 128;
export const NODE_H = 48;
const COL = NODE_W + 56;
const ROW = NODE_H + 14;
const PAD = 24;

function flatten(node: DiagramNode, out: DiagramNode[] = []) {
  out.push(node);
  for (const c of node.children) flatten(c, out);
  return out;
}

const BAR_H = 4;
const BAR_GAP = 3;

// The share bars, one below the other, the last one ending at `bottom`
function Bars({
  bars,
  x,
  bottom,
}: {
  bars: NonNullable<DiagramNode["bars"]>;
  x: number;
  bottom: number;
}) {
  const width = NODE_W - 20;
  const top = bottom - bars.length * BAR_H - (bars.length - 1) * BAR_GAP;
  return (
    <>
      {bars.map((bar, i) => {
        const by = top + i * (BAR_H + BAR_GAP);
        const value = bar.value ?? 0;
        return (
          <g key={i}>
            <rect
              x={x + 10}
              y={by}
              width={width}
              height={BAR_H}
              rx={BAR_H / 2}
              fill="var(--mantine-color-default-border)"
            />
            {bar.value !== undefined && value > 0 && (
              <rect
                x={x + 10}
                y={by}
                width={Math.max(width * value, 4)}
                height={BAR_H}
                rx={BAR_H / 2}
                fill={bar.color}
              />
            )}
          </g>
        );
      })}
    </>
  );
}

function NodeBox({
  node,
  x,
  y,
  highlighted,
}: {
  node: DiagramNode;
  x: number;
  y: number;
  highlighted: boolean;
}) {
  const top = y - NODE_H / 2;
  const solid = node.kind === "mine" || node.kind === "theirs";
  const dark = solid && node.side === "black";
  const light = solid && node.side === "white";
  const fill =
    node.kind === "root"
      ? "var(--mantine-color-dark-5)"
      : dark
        ? "#1f2023"
        : light
          ? "#f8f9fa"
          : node.kind === "mine"
            ? "var(--mantine-primary-color-light)"
            : node.kind === "ghost" || node.kind === "other"
              ? "transparent"
              : "var(--mantine-color-default)";
  const textColor =
    node.kind === "root" || dark ? "#f1f3f5" : light ? "#1a1b1e" : "var(--mantine-color-text)";
  const dimColor = dark ? "#adb5bd" : light ? "#5c5f66" : "var(--mantine-color-dimmed)";
  const stroke = highlighted
    ? "var(--mantine-color-orange-5)"
    : (node.accent ??
      (node.kind === "mine"
        ? "var(--mantine-primary-color-filled)"
        : dark
          ? "#5c5f66"
          : "var(--mantine-color-default-border)"));
  const strokeWidth = highlighted ? 3.5 : node.accent || node.kind === "mine" ? 2.4 : 1.2;
  const hasBars = !!node.bars && node.bars.length > 0;
  const lines = 1 + (hasBars ? 1 : 0) + (node.note ? 1 : 0);
  const manyBars = hasBars && node.bars!.length > 1;
  const labelY =
    lines === 1
      ? y + 4.5
      : lines === 3
        ? manyBars
          ? top + 13
          : top + 15
        : manyBars
          ? top + 17
          : top + 18;
  return (
    <g
      opacity={node.kind === "ghost" ? 0.55 : 1}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={node.onClick}
      style={{ cursor: node.onClick ? "pointer" : "default" }}
    >
      {node.title && <title>{node.title}</title>}
      <rect
        x={x}
        y={top}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={node.kind === "ghost" || node.kind === "other" ? "5 4" : undefined}
      />
      <text
        x={x + NODE_W / 2}
        y={labelY}
        textAnchor="middle"
        fontSize={13}
        fontWeight={node.kind === "mine" || node.kind === "root" ? 700 : 500}
        fontStyle={node.kind === "other" ? "italic" : undefined}
        fill={textColor}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {node.label}
      </text>
      {node.note && (
        <text
          x={x + NODE_W / 2}
          y={hasBars ? (manyBars ? top + 26 : top + 29) : top + 34}
          textAnchor="middle"
          fontSize={10.5}
          fill={dimColor}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {node.note}
        </text>
      )}
      {hasBars && (
        <Bars
          bars={node.bars!}
          x={x}
          bottom={manyBars ? top + NODE_H - 6 : top + (node.note ? 40 : 34) + 1}
        />
      )}
      {node.flag && (
        <g>
          <circle cx={x + 4} cy={top + 4} r={8} fill={node.flag.color} />
          <text
            x={x + 4}
            y={top + 8}
            textAnchor="middle"
            fontSize={11}
            fontWeight={700}
            fill="white"
            style={{ pointerEvents: "none" }}
          >
            L
          </text>
        </g>
      )}
      {node.marker && (
        <g
          onClick={(e) => {
            e.stopPropagation();
            node.marker!.onClick();
          }}
          style={{ cursor: "pointer" }}
        >
          <circle cx={x + NODE_W - 4} cy={top + 4} r={8} fill={node.marker.color} />
          <text
            x={x + NODE_W - 4}
            y={top + 8}
            textAnchor="middle"
            fontSize={11}
            fill="white"
            style={{ pointerEvents: "none" }}
          >
            ⇄
          </text>
        </g>
      )}
      {node.toggle && (
        <g
          onClick={(e) => {
            e.stopPropagation();
            node.toggle!.onToggle();
          }}
          style={{ cursor: "pointer" }}
        >
          <circle
            cx={x + NODE_W}
            cy={y}
            r={9}
            fill="var(--mantine-color-body)"
            stroke="var(--mantine-color-default-border)"
          />
          <text
            x={x + NODE_W}
            y={y + 4}
            textAnchor="middle"
            fontSize={12}
            fontWeight={700}
            fill="var(--mantine-color-dimmed)"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {node.toggle.open ? "−" : "+"}
          </text>
          {!node.toggle.open && node.toggle.hidden > 0 && (
            <text
              x={x + NODE_W + 13}
              y={y + 4}
              fontSize={10}
              fill="var(--mantine-color-dimmed)"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {node.toggle.hidden}
            </text>
          )}
        </g>
      )}
    </g>
  );
}

type View = { x: number; y: number; k: number };

export default function TreeDiagram({
  root,
  links = [],
  highlight = null,
  focus = null,
}: {
  root: DiagramNode;
  links?: DiagramLink[];
  highlight?: string | null;
  // Moves the view to this node whenever it changes
  focus?: { id: string } | null;
}) {
  const { t } = useTranslation();
  const { ref, width, height } = useElementSize();
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = useMemo(() => layoutTree(root, { colWidth: COL, rowHeight: ROW }), [root]);
  const nodes = useMemo(() => flatten(root), [root]);
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const [dragging, setDragging] = useState(false);

  const rootY = layout.nodes.get(root.id)?.y ?? 0;
  const current: View = view ?? { x: PAD, y: height / 2 - rootY, k: 1 };

  function fit() {
    if (!width || !height) return;
    const k = Math.min(1.2, (width - 2 * PAD) / layout.width, (height - 2 * PAD) / layout.height);
    const scale = Math.max(0.2, k);
    setView({
      x: PAD,
      y: (height - layout.height * scale) / 2 + (ROW / 2) * scale,
      k: scale,
    });
  }

  function zoom(factor: number, cx = width / 2, cy = height / 2) {
    setView((prev) => {
      const v = prev ?? current;
      const k = Math.min(2.5, Math.max(0.2, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  }

  // Scrolling zooms around the mouse; needs a non-passive listener to stop page scrolling
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomRef.current(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  // Bring a node into the middle when asked (only when `focus` changes, not on every load)
  const layoutRef = useRef(layout);
  const sizeRef = useRef({ width, height });
  useEffect(() => {
    layoutRef.current = layout;
    sizeRef.current = { width, height };
  });
  useEffect(() => {
    const placed = focus ? layoutRef.current.nodes.get(focus.id) : undefined;
    const { width: w, height: h } = sizeRef.current;
    if (!placed || !w || !h) return;
    setView((prev) => {
      const k = (prev ?? { k: 1 }).k;
      return { k, x: w / 2 - (placed.x + NODE_W / 2) * k, y: h / 2 - placed.y * k };
    });
  }, [focus]);

  const pos = (id: string) => layout.nodes.get(id);

  return (
    <Box ref={ref} pos="relative" w="100%" h="100%" style={{ overflow: "hidden" }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: "block", cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, view: current };
          setDragging(true);
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setView({ ...d.view, x: d.view.x + e.clientX - d.x, y: d.view.y + e.clientY - d.y });
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        <defs>
          <marker
            id="tree-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--mantine-color-violet-5)" />
          </marker>
        </defs>
        <g transform={`translate(${current.x},${current.y}) scale(${current.k})`}>
          {nodes.map((node) => {
            const p = pos(node.id);
            const parent = p?.parent ? pos(p.parent) : undefined;
            if (!p || !parent) return null;
            const x1 = parent.x + NODE_W;
            const x2 = p.x;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`edge-${node.id}`}
                d={`M${x1},${parent.y} C${mid},${parent.y} ${mid},${p.y} ${x2},${p.y}`}
                fill="none"
                stroke="var(--mantine-color-default-border)"
                strokeWidth={node.kind === "mine" ? 2.2 : 1.4}
                strokeDasharray={node.kind === "ghost" || node.kind === "other" ? "5 4" : undefined}
              />
            );
          })}
          {links.map((link) => {
            const a = pos(link.from);
            const b = pos(link.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W / 2;
            const y1 = a.y + (b.y >= a.y ? NODE_H / 2 : -NODE_H / 2);
            const x2 = b.x + NODE_W / 2;
            const y2 = b.y + (b.y >= a.y ? -NODE_H / 2 : NODE_H / 2);
            const bend = Math.max(60, Math.abs(y2 - y1) / 3);
            return (
              <path
                key={`link-${link.from}-${link.to}`}
                d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 + bend},${y2} ${x2},${y2}`}
                fill="none"
                stroke={link.color}
                strokeWidth={1.8}
                strokeDasharray="6 4"
                markerEnd="url(#tree-arrow)"
                opacity={0.8}
              />
            );
          })}
          {nodes.map((node) => {
            const p = pos(node.id);
            if (!p) return null;
            return (
              <NodeBox
                key={node.id}
                node={node}
                x={p.x}
                y={p.y}
                highlighted={highlight === node.id}
              />
            );
          })}
        </g>
      </svg>
      <Group gap={4} pos="absolute" top={8} right={8}>
        <Tooltip label={t("Repertoire.Diagram.ZoomIn")}>
          <ActionIcon variant="default" onClick={() => zoom(1.25)}>
            <IconPlus size="1rem" />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("Repertoire.Diagram.ZoomOut")}>
          <ActionIcon variant="default" onClick={() => zoom(0.8)}>
            <IconMinus size="1rem" />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t("Repertoire.Diagram.Fit")}>
          <ActionIcon variant="default" onClick={fit}>
            <IconFocusCentered size="1rem" />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
