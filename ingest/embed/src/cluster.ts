export interface SimilarPair {
  a: number;
  b: number;
  similarity: number;
}

export interface Cluster {
  members: number[];
  similarity: number;
}

// Clone detection has two steps. pgvector finds each symbol's nearest neighbours by
// cosine similarity of their embeddings; a neighbour at least CANDIDATE_SIMILARITY away
// is a candidate. A candidate is a clone when the token structure of the two bodies is
// at least CLONE_STRUCTURE alike (see structure.ts). On express, renamed copies scored
// 0.78-0.84 cosine, as low as unrelated functions with a similar purpose, while their
// structure scored 0.96-1.0 against 0.79 for the closest non-copy.
export const CANDIDATE_SIMILARITY = 0.7;
export const CLONE_STRUCTURE = 0.85;
// How many nearest neighbours of each symbol are considered.
export const NEIGHBOURS = 5;
// Bodies shorter than this many lines are too small to call duplicates.
export const MIN_LINES = 4;

// Single-linkage grouping: symbols connected through similar pairs share a cluster.
// The cluster's similarity is its weakest link, so a long chain can hold two members
// that are less alike than the threshold; the score shows that.
export function clusterPairs(pairs: SimilarPair[]): Cluster[] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const add = (x: number) => {
    if (!parent.has(x)) parent.set(x, x);
  };

  for (const { a, b } of pairs) {
    if (a === b) continue;
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }

  const clusters = new Map<number, Cluster>();
  for (const x of parent.keys()) {
    const root = find(x);
    const cluster = clusters.get(root) ?? { members: [], similarity: 1 };
    cluster.members.push(x);
    clusters.set(root, cluster);
  }
  for (const { a, b, similarity } of pairs) {
    if (a === b) continue;
    const cluster = clusters.get(find(a))!;
    cluster.similarity = Math.min(cluster.similarity, similarity);
  }

  return [...clusters.values()]
    .map((c) => ({ members: c.members.sort((x, y) => x - y), similarity: c.similarity }))
    .sort((x, y) => x.members[0] - y.members[0]);
}
