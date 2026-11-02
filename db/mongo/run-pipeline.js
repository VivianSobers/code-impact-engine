const path = require('path');

const dir = process.env.CIE_MONGO_DIR || '/cie-db/mongo';
const dbName = process.env.CIE_MONGO_DB || 'cie';
const name = process.env.CIE_PIPELINE;
const pipelines = require(path.join(dir, 'pipelines.js'));

const available = Object.keys(pipelines).filter((key) => typeof pipelines[key] === 'function');
if (!available.includes(name)) {
  print(`set CIE_PIPELINE to one of: ${available.join(', ')}`);
  quit(1);
}

const options = {};
if (process.env.CIE_REPO_ID) options.repoId = process.env.CIE_REPO_ID;
if (process.env.CIE_LIMIT) options.limit = process.env.CIE_LIMIT;
if (process.env.CIE_BOUNDARIES) options.boundaries = JSON.parse(process.env.CIE_BOUNDARIES);

const pipeline = pipelines[name](options);
const collection = db.getSiblingDB(dbName).ast;

if (process.env.CIE_EXPLAIN) {
  const plan = collection.explain('executionStats').aggregate(pipeline);
  const winning = [];
  (function collect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'winningPlan') winning.push(JSON.stringify(child));
      else if (key !== 'rejectedPlans') collect(child);
    }
  })(plan);
  const used = [...new Set(winning.flatMap((text) => [...text.matchAll(/"indexName":"([^"]+)"/g)].map((m) => m[1])))];
  print(`index used: ${used.length ? used.join(', ') : 'none (collection scan)'}`);
  const docs = JSON.stringify(plan).match(/"totalDocsExamined":(\d+)/);
  if (docs) print(`documents examined: ${docs[1]}`);
}

collection.aggregate(pipeline).forEach((doc) => printjson(doc));
