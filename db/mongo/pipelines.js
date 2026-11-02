const DEFAULT_SIZE_BOUNDARIES = [0, 100, 500, 1000, 5000, 10000, 50001];

function matchRepo(repoId) {
  if (repoId === undefined || repoId === null || repoId === '') return [];
  const id = Number(repoId);
  if (!Number.isInteger(id) || id < 1) throw new Error(`invalid repoId: ${repoId}`);
  return [{ $match: { repo_id: id } }];
}

function positiveInt(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid ${name}: ${value}`);
  return n;
}

function nodeTypeCountsByLanguage({ repoId, limit } = {}) {
  const top = positiveInt(limit, 10, 'limit');
  return [
    ...matchRepo(repoId),
    { $project: { _id: 1, language: 1, types: '$nodes.t' } },
    { $unwind: '$types' },
    {
      $group: {
        _id: { language: '$language', type: '$types', file: '$_id' },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: { language: '$_id.language', type: '$_id.type' },
        count: { $sum: '$count' },
        files: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: '$_id.language',
        total_nodes: { $sum: '$count' },
        distinct_types: { $sum: 1 },
        top_types: {
          $topN: {
            n: top,
            sortBy: { count: -1, '_id.type': 1 },
            output: { type: '$_id.type', count: '$count', files: '$files' },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        language: '$_id',
        total_nodes: 1,
        distinct_types: 1,
        top_types: {
          $map: {
            input: '$top_types',
            as: 'entry',
            in: {
              type: '$$entry.type',
              count: '$$entry.count',
              files: '$$entry.files',
              share: { $round: [{ $divide: ['$$entry.count', '$total_nodes'] }, 4] },
            },
          },
        },
      },
    },
    { $sort: { total_nodes: -1, language: 1 } },
  ];
}

function deepestNestingPerFile({ repoId, limit } = {}) {
  const top = positiveInt(limit, 20, 'limit');
  return [
    ...matchRepo(repoId),
    { $sort: { max_depth: -1, path: 1 } },
    { $limit: top },
    {
      $set: {
        deepest: {
          $first: {
            $filter: {
              input: '$nodes',
              as: 'node',
              cond: { $eq: ['$$node.d', '$max_depth'] },
              limit: 1,
            },
          },
        },
      },
    },
    {
      $set: {
        ancestry: {
          $reduce: {
            input: { $range: [0, '$max_depth'] },
            initialValue: { at: '$deepest.p', chain: [] },
            in: {
              $cond: [
                { $lt: ['$$value.at', 0] },
                '$$value',
                {
                  $let: {
                    vars: { node: { $arrayElemAt: ['$nodes', '$$value.at'] } },
                    in: {
                      at: '$$node.p',
                      chain: { $concatArrays: [['$$node.t'], '$$value.chain'] },
                    },
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
        ast_doc_id: { $toString: '$_id' },
        repo_id: 1,
        path: 1,
        language: 1,
        loc: 1,
        node_count: 1,
        max_depth: 1,
        truncated: 1,
        deepest_node: {
          type: '$deepest.t',
          line: { $add: [{ $arrayElemAt: ['$deepest.s', 0] }, 1] },
          column: { $add: [{ $arrayElemAt: ['$deepest.s', 1] }, 1] },
        },
        ancestry: '$ancestry.chain',
      },
    },
  ];
}

function astSummaryByRepo({ repoId } = {}) {
  return [
    ...matchRepo(repoId),
    { $project: { repo_id: 1, language: 1, loc: 1, node_count: 1, max_depth: 1, truncated: 1 } },
    {
      $facet: {
        by_language: [
          {
            $group: {
              _id: '$language',
              files: { $sum: 1 },
              loc: { $sum: '$loc' },
              nodes: { $sum: '$node_count' },
              avg_nodes_per_file: { $avg: '$node_count' },
              avg_depth: { $avg: '$max_depth' },
              max_depth: { $max: '$max_depth' },
              truncated_files: { $sum: { $cond: ['$truncated', 1, 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              language: '$_id',
              files: 1,
              loc: 1,
              nodes: 1,
              avg_nodes_per_file: { $round: ['$avg_nodes_per_file', 1] },
              avg_depth: { $round: ['$avg_depth', 1] },
              max_depth: 1,
              truncated_files: 1,
            },
          },
          { $sort: { files: -1, language: 1 } },
        ],
        totals: [
          {
            $group: {
              _id: null,
              repos: { $addToSet: '$repo_id' },
              files: { $sum: 1 },
              loc: { $sum: '$loc' },
              nodes: { $sum: '$node_count' },
              max_depth: { $max: '$max_depth' },
            },
          },
          {
            $project: {
              _id: 0,
              repos: { $size: '$repos' },
              files: 1,
              loc: 1,
              nodes: 1,
              max_depth: 1,
            },
          },
        ],
      },
    },
    {
      $project: {
        by_language: 1,
        totals: {
          $ifNull: [{ $first: '$totals' }, { repos: 0, files: 0, loc: 0, nodes: 0, max_depth: null }],
        },
      },
    },
  ];
}

function fileSizeDistribution({ repoId, boundaries } = {}) {
  const edges = boundaries || DEFAULT_SIZE_BOUNDARIES;
  const valid =
    Array.isArray(edges) &&
    edges.length >= 2 &&
    edges.every((b, i) => Number.isInteger(b) && b >= 0 && (i === 0 || b > edges[i - 1]));
  if (!valid) throw new Error('boundaries must be at least two increasing non-negative integers');
  return [
    ...matchRepo(repoId),
    {
      $bucket: {
        groupBy: '$node_count',
        boundaries: edges,
        default: 'larger',
        output: {
          files: { $sum: 1 },
          avg_loc: { $avg: '$loc' },
          avg_depth: { $avg: '$max_depth' },
          largest: { $topN: { n: 3, sortBy: { node_count: -1, path: 1 }, output: '$path' } },
        },
      },
    },
    {
      $project: {
        _id: 0,
        min_nodes: '$_id',
        files: 1,
        avg_loc: { $round: ['$avg_loc', 1] },
        avg_depth: { $round: ['$avg_depth', 1] },
        largest: 1,
      },
    },
  ];
}

module.exports = {
  DEFAULT_SIZE_BOUNDARIES,
  nodeTypeCountsByLanguage,
  deepestNestingPerFile,
  astSummaryByRepo,
  fileSizeDistribution,
};
