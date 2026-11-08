// Places a tree from left to right: each move one column further right, the end of every
// line on its own row, and each move vertically centered on the moves that follow it.

export type LayoutNode = { id: string; children: LayoutNode[] };

export type Placed = { id: string; x: number; y: number; depth: number; parent: string | null };

export function layoutTree(
    root: LayoutNode,
    { colWidth, rowHeight }: { colWidth: number; rowHeight: number },
) {
    const nodes = new Map<string, Placed>();
    let row = 0;
    let maxDepth = 0;
    const place = (node: LayoutNode, depth: number, parent: string | null): number => {
        maxDepth = Math.max(maxDepth, depth);
        let y: number;
        if (node.children.length === 0) {
            y = row * rowHeight;
            row++;
        } else {
            const ys = node.children.map((c) => place(c, depth + 1, node.id));
            y = (ys[0] + ys[ys.length - 1]) / 2;
        }
        nodes.set(node.id, { id: node.id, x: depth * colWidth, y, depth, parent });
        return y;
    };
    place(root, 0, null);
    return {
        nodes,
        width: (maxDepth + 1) * colWidth,
        height: Math.max(1, row) * rowHeight,
    };
}
