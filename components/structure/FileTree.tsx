import Link from "next/link";
import { encodePath } from "@/lib/structure/params";
import { formatNumber, plural } from "@/lib/structure/format";
import type { FileEntry } from "@/lib/structure/types";
import tree from "./fileTree.module.css";

interface DirNode {
  name: string;
  path: string;
  dirs: Map<string, DirNode>;
  files: FileEntry[];
  fileCount: number;
  loc: number;
  symbols: number;
}

function emptyDir(name: string, path: string): DirNode {
  return { name, path, dirs: new Map(), files: [], fileCount: 0, loc: 0, symbols: 0 };
}

function buildTree(files: FileEntry[]): DirNode {
  const root = emptyDir("", "");
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    const chain = [root];
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part;
      let next = node.dirs.get(part);
      if (!next) {
        next = emptyDir(part, path);
        node.dirs.set(part, next);
      }
      node = next;
      chain.push(node);
    }
    node.files.push(file);
    for (const dir of chain) {
      dir.fileCount += 1;
      dir.loc += file.loc;
      dir.symbols += file.symbolCount;
    }
  }
  return compact(root);
}

function compact(node: DirNode): DirNode {
  for (const [key, child] of node.dirs) {
    let merged = child;
    while (merged.files.length === 0 && merged.dirs.size === 1) {
      const only = [...merged.dirs.values()][0];
      merged = { ...only, name: `${merged.name}/${only.name}` };
    }
    node.dirs.set(key, compact(merged));
  }
  return node;
}

function Row({ name, depth, cells }: { name: React.ReactNode; depth: number; cells: React.ReactNode[] }) {
  return (
    <span className={tree.row} style={{ "--depth": depth } as React.CSSProperties}>
      <span className={tree.name}>{name}</span>
      {cells.map((cell, i) => (
        <span key={i} className={tree.cell}>
          {cell}
        </span>
      ))}
    </span>
  );
}

function Directory({ node, depth, repoId }: { node: DirNode; depth: number; repoId: number }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className={tree.list}>
      {dirs.map((dir) => (
        <li key={dir.path}>
          <details open={depth < 1 || dir.fileCount <= 12}>
            <summary className={tree.dir}>
              <Row
                depth={depth}
                name={<span className={tree.dirName}>{dir.name}/</span>}
                cells={[plural(dir.fileCount, "file"), formatNumber(dir.loc), formatNumber(dir.symbols)]}
              />
            </summary>
            <Directory node={dir} depth={depth + 1} repoId={repoId} />
          </details>
        </li>
      ))}
      {node.files.map((file) => (
        <li key={file.path} className={tree.file}>
          <Row
            depth={depth}
            name={
              <Link href={`/repositories/${repoId}/files/${encodePath(file.path)}`}>{file.path.split("/").pop()}</Link>
            }
            cells={[file.language, formatNumber(file.loc), formatNumber(file.symbolCount)]}
          />
        </li>
      ))}
    </ul>
  );
}

export function FileTree({ files, repoId }: { files: FileEntry[]; repoId: number }) {
  const root = buildTree(files);
  return (
    <div className={tree.tree}>
      <div className={tree.head} aria-hidden="true">
        <Row depth={0} name="Path" cells={["Language", "Lines", "Symbols"]} />
      </div>
      <Directory node={root} depth={0} repoId={repoId} />
    </div>
  );
}
