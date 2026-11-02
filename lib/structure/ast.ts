import type { Document } from "mongodb";
import { getDb } from "@/lib/mongo";
import type { AstStats, DeepFile, LanguageNodeTypes } from "./types";

export function nodeTypeCountsByLanguage({ repoId, limit = 10 }: { repoId: number; limit?: number }): Document[] {
  return [
    { $match: { repo_id: repoId } },
    { $project: { _id: 1, language: 1, types: "$nodes.t" } },
    { $unwind: "$types" },
    { $group: { _id: { language: "$language", type: "$types", file: "$_id" }, count: { $sum: 1 } } },
    {
      $group: {
        _id: { language: "$_id.language", type: "$_id.type" },
        count: { $sum: "$count" },
        files: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: "$_id.language",
        total_nodes: { $sum: "$count" },
        distinct_types: { $sum: 1 },
        top_types: {
          $topN: {
            n: limit,
            sortBy: { count: -1, type: 1 },
            output: { type: "$_id.type", count: "$count", files: "$files" },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        language: "$_id",
        total_nodes: 1,
        distinct_types: 1,
        top_types: {
          $map: {
            input: "$top_types",
            as: "entry",
            in: {
              type: "$$entry.type",
              count: "$$entry.count",
              files: "$$entry.files",
              share: { $round: [{ $divide: ["$$entry.count", "$total_nodes"] }, 4] },
            },
          },
        },
      },
    },
    { $sort: { total_nodes: -1, language: 1 } },
  ];
}

export function deepestNestingPerFile({ repoId, limit = 20 }: { repoId: number; limit?: number }): Document[] {
  return [
    { $match: { repo_id: repoId } },
    { $sort: { max_depth: -1, path: 1 } },
    { $limit: limit },
    {
      $set: {
        deepest: {
          $first: {
            $filter: { input: "$nodes", as: "node", cond: { $eq: ["$$node.d", "$max_depth"] }, limit: 1 },
          },
        },
      },
    },
    {
      $set: {
        ancestry: {
          $reduce: {
            input: { $range: [0, "$max_depth"] },
            initialValue: { at: "$deepest.p", chain: [] },
            in: {
              $cond: [
                { $lt: ["$$value.at", 0] },
                "$$value",
                {
                  $let: {
                    vars: { node: { $arrayElemAt: ["$nodes", "$$value.at"] } },
                    in: { at: "$$node.p", chain: { $concatArrays: [["$$node.t"], "$$value.chain"] } },
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        ast_doc_id: { $toString: "$_id" },
        repo_id: 1,
        path: 1,
        language: 1,
        loc: 1,
        node_count: 1,
        max_depth: 1,
        truncated: 1,
        deepest_node: {
          type: "$deepest.t",
          line: { $add: [{ $arrayElemAt: ["$deepest.s", 0] }, 1] },
          column: { $add: [{ $arrayElemAt: ["$deepest.s", 1] }, 1] },
        },
        ancestry: "$ancestry.chain",
      },
    },
  ];
}

export async function getAstStats(repoId: number, { typesPerLanguage = 8, deepest = 8 } = {}): Promise<AstStats> {
  const ast = (await getDb()).collection("ast");
  const [byLanguage, deepestFiles] = await Promise.all([
    ast.aggregate<LanguageNodeTypes>(nodeTypeCountsByLanguage({ repoId, limit: typesPerLanguage })).toArray(),
    ast.aggregate<DeepFile>(deepestNestingPerFile({ repoId, limit: deepest })).toArray(),
  ]);
  return { byLanguage, deepest: deepestFiles };
}
