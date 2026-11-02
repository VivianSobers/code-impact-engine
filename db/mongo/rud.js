// Read, update and delete on the `ast` collection, run with mongosh. Creating documents
// is the ingester's job (ingest/parse/src/store/mongo.ts), so this script reads the real
// documents but only writes to a scratch copy it makes first and deletes at the end.
//
//   docker compose exec -T mongo mongosh --quiet cie /cie-db/mongo/rud.js
//
// CIE_MONGO_DB picks another database, and CIE_SOURCE_PATH another file to copy.

const dbName = process.env.CIE_MONGO_DB || 'cie';
const sourcePath = process.env.CIE_SOURCE_PATH || 'src/orders/pricing.ts';
const scratchPath = 'scratch/' + sourcePath;
const secondPath = 'scratch/second/' + sourcePath;
const ast = db.getSiblingDB(dbName).ast;

function heading(text) {
  print('\n=== ' + text);
}

// ---------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------

heading('R1. findOne with a projection: one file, without its node array');
const source = ast.findOne({ path: sourcePath });
if (!source) {
  print(`no AST document for ${sourcePath}; ingest the seed repository first`);
  quit(1);
}
printjson(ast.findOne({ path: sourcePath }, { nodes: 0, parser: 0 }));

heading('R2. find with a range filter, sort and limit: most deeply nested files');
ast
  .find({ repo_id: source.repo_id, max_depth: { $gte: 10 } }, { _id: 0, path: 1, language: 1, max_depth: 1, node_count: 1 })
  .sort({ max_depth: -1, path: 1 })
  .limit(5)
  .forEach((doc) => printjson(doc));

const plan = ast
  .find({ repo_id: source.repo_id, max_depth: { $gte: 10 } })
  .sort({ max_depth: -1, path: 1 })
  .explain('executionStats');
const indexes = JSON.stringify(plan.queryPlanner.winningPlan).match(/"indexName":"[^"]+"/g) || [];
print(`index used: ${indexes.map((m) => m.split(':')[1]).join(', ') || 'none'}, documents examined: ${plan.executionStats.totalDocsExamined}`);

heading('R3. countDocuments and distinct: files per language');
for (const language of ast.distinct('language', { repo_id: source.repo_id }).sort()) {
  print(`${language}: ${ast.countDocuments({ repo_id: source.repo_id, language })}`);
}

heading('R4. $elemMatch on the node array: files that declare a class');
ast
  .find(
    { repo_id: source.repo_id, nodes: { $elemMatch: { t: { $in: ['class_declaration', 'class_definition'] } } } },
    { _id: 0, path: 1, language: 1 },
  )
  .sort({ path: 1 })
  .forEach((doc) => printjson(doc));

heading('R5. $in and $or: Go or Java files, or anything over 25 lines');
ast
  .find(
    { repo_id: source.repo_id, $or: [{ language: { $in: ['go', 'java'] } }, { loc: { $gt: 25 } }] },
    { _id: 0, path: 1, language: 1, loc: 1 },
  )
  .sort({ loc: -1 })
  .forEach((doc) => printjson(doc));

// ---------------------------------------------------------------------------------------
// Update, on a scratch copy of the source document
// ---------------------------------------------------------------------------------------

ast.deleteMany({ repo_id: source.repo_id, path: /^scratch\// });
const copy = Object.assign({}, source, { _id: new ObjectId(), path: scratchPath });
ast.insertMany([copy, Object.assign({}, source, { _id: new ObjectId(), path: secondPath })]);
print(`\n(scratch copies ${scratchPath} and ${secondPath} inserted, ${copy.node_count} nodes each)`);

heading('U1. updateOne with $set and $inc');
printjson(
  ast.updateOne(
    { _id: copy._id },
    { $set: { parsed_at: new Date() }, $inc: { loc: NumberInt(3) } },
  ),
);
printjson(ast.findOne({ _id: copy._id }, { _id: 0, path: 1, loc: 1, parsed_at: 1 }));

heading('U2. updateOne with an aggregation pipeline: cut the tree at depth 8 and recompute');
const show = { _id: 0, node_count: 1, max_depth: 1, truncated: 1 };
printjson(ast.findOne({ _id: copy._id }, show));
printjson(
  ast.updateOne({ _id: copy._id }, [
    { $set: { nodes: { $filter: { input: '$nodes', cond: { $lte: ['$$this.d', 8] } } } } },
    { $set: { node_count: { $toInt: { $size: '$nodes' } }, max_depth: { $toInt: { $max: '$nodes.d' } }, truncated: true } },
  ]),
);
printjson(ast.findOne({ _id: copy._id }, show));

heading('U3. findOneAndUpdate returning the new document');
printjson(
  ast.findOneAndUpdate(
    { _id: copy._id },
    { $set: { 'parser.grammar': 'tree-sitter-typescript (re-parsed)' } },
    { returnDocument: 'after', projection: { _id: 0, path: 1, parser: 1 } },
  ),
);

heading('U4. Upsert by (repo_id, path), the way the ingester writes');
printjson(
  ast.updateOne(
    { repo_id: source.repo_id, path: scratchPath },
    { $set: { content_hash: 'f'.repeat(64), parsed_at: new Date() } },
    { upsert: true },
  ),
);

heading('U5. updateMany over every scratch document');
printjson(ast.updateMany({ repo_id: source.repo_id, path: /^scratch\// }, { $set: { truncated: true } }));

heading('U6. The validator and the unique index refuse bad writes');
function refused(label, write) {
  try {
    write();
    print(`${label}: accepted`);
  } catch (error) {
    print(`${label} rejected: code ${error.code}, ${error.message.split('\n')[0].slice(0, 70)}`);
  }
}
refused('language cobol', () => ast.updateOne({ _id: copy._id }, { $set: { language: 'cobol' } }));
refused('negative loc', () => ast.updateOne({ _id: copy._id }, { $set: { loc: NumberInt(-1) } }));
refused('duplicate (repo_id, path)', () => ast.insertOne(Object.assign({}, copy, { _id: new ObjectId() })));

// ---------------------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------------------

heading('D1. deleteOne by _id');
printjson(ast.deleteOne({ _id: copy._id }));

heading('D2. deleteMany by filter, then confirm nothing is left');
printjson(ast.deleteMany({ repo_id: source.repo_id, path: /^scratch\// }));
print(`scratch documents left: ${ast.countDocuments({ path: /^scratch\// })}`);
print(`documents for repo ${source.repo_id}: ${ast.countDocuments({ repo_id: source.repo_id })}`);
