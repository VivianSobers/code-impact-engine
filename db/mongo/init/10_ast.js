const fs = require('fs');
const path = require('path');

const dir = process.env.CIE_MONGO_DIR || '/cie-db/mongo';
const dbName = process.env.CIE_MONGO_DB || process.env.MONGO_INITDB_DATABASE || 'cie';

const schema = JSON.parse(fs.readFileSync(path.join(dir, 'ast.schema.json'), 'utf8'));
const indexes = JSON.parse(fs.readFileSync(path.join(dir, 'ast.indexes.json'), 'utf8'));

const target = db.getSiblingDB(dbName);
const validation = {
  validator: { $jsonSchema: schema },
  validationLevel: 'moderate',
  validationAction: 'error',
};

if (target.getCollectionNames().includes('ast')) {
  target.runCommand({ collMod: 'ast', ...validation });
} else {
  target.createCollection('ast', validation);
}

const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const existing of target.ast.getIndexes()) {
  if (existing.name === '_id_') continue;
  const spec = indexes.find((ix) => ix.name === existing.name);
  const stale = !spec || !sameKey(spec.key, existing.key) || Boolean(spec.unique) !== Boolean(existing.unique);
  const clashes = indexes.some((ix) => ix.name !== existing.name && sameKey(ix.key, existing.key));
  if (stale || clashes) target.ast.dropIndex(existing.name);
}

for (const { name, key, ...options } of indexes) {
  target.ast.createIndex(key, { name, ...options });
}

print(`ast collection ready in ${dbName} with ${indexes.length} indexes`);
