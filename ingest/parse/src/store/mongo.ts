import { MongoBulkWriteError, MongoClient, ObjectId, type AnyBulkWriteOperation, type Collection, type Db } from "mongodb";
import type { FlatAst } from "../ast";
import type { Grammar, Language } from "../languages";
import { grammarPackage } from "../parser";

export interface AstDocument {
  _id?: ObjectId;
  repo_id: number;
  path: string;
  language: Language;
  content_hash: string;
  parser: { name: "tree-sitter"; grammar: string };
  parsed_at: Date;
  loc: number;
  node_count: number;
  max_depth: number;
  truncated: boolean;
  nodes: FlatAst["nodes"];
}

export interface AstInput {
  path: string;
  language: Language;
  grammar: Grammar;
  contentHash: string;
  loc: number;
  ast: FlatAst;
}

export function astDocument(repoId: number, input: AstInput, parsedAt: Date): AstDocument {
  return {
    repo_id: repoId,
    path: input.path,
    language: input.language,
    content_hash: input.contentHash,
    parser: { name: "tree-sitter", grammar: grammarPackage(input.grammar) },
    parsed_at: parsedAt,
    loc: input.loc,
    node_count: input.ast.nodes.length,
    max_depth: input.ast.maxDepth,
    truncated: input.ast.truncated,
    nodes: input.ast.nodes,
  };
}

export class AstStore {
  private readonly collection: Collection<AstDocument>;
  private readonly created: ObjectId[] = [];
  private readonly stored = new Map<string, ObjectId>();
  private existing: Map<string, ObjectId> | null = null;

  constructor(
    db: Db,
    private readonly repoId: number,
    private readonly parsedAt = new Date(),
  ) {
    this.collection = db.collection<AstDocument>("ast");
  }

  static async connect(uri: string): Promise<MongoClient> {
    return new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect();
  }

  private async loadExisting(): Promise<Map<string, ObjectId>> {
    if (!this.existing) {
      const rows = await this.collection.find({ repo_id: this.repoId }, { projection: { _id: 1, path: 1 } }).toArray();
      this.existing = new Map(rows.map((row) => [row.path, row._id as ObjectId]));
    }
    return this.existing;
  }

  async write(inputs: AstInput[]): Promise<Map<string, string>> {
    const existing = await this.loadExisting();
    const ids = new Map<string, string>();
    if (inputs.length === 0) return ids;
    const operations: AnyBulkWriteOperation<AstDocument>[] = inputs.map((input) => ({
      replaceOne: {
        filter: { repo_id: this.repoId, path: input.path },
        replacement: astDocument(this.repoId, input, this.parsedAt),
        upsert: true,
      },
    }));
    let result;
    try {
      result = await this.collection.bulkWrite(operations, { ordered: true });
    } catch (error) {
      if (error instanceof MongoBulkWriteError) {
        this.created.push(...(Object.values(error.result?.upsertedIds ?? {}) as ObjectId[]));
      }
      throw error;
    }
    inputs.forEach((input, index) => {
      const upserted = result.upsertedIds[index] as ObjectId | undefined;
      const id = upserted ?? existing.get(input.path);
      if (!id) throw new Error(`MongoDB did not return an id for ${input.path}`);
      if (upserted) this.created.push(upserted);
      this.stored.set(input.path, id);
      ids.set(input.path, id.toHexString());
    });
    return ids;
  }

  async rollback(): Promise<void> {
    if (this.created.length > 0) await this.collection.deleteMany({ _id: { $in: this.created } });
  }

  async removeStale(): Promise<number> {
    const keep = [...this.stored.values()];
    const result = await this.collection.deleteMany({ repo_id: this.repoId, _id: { $nin: keep } });
    return result.deletedCount;
  }
}
