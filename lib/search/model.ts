import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Must match ingest/embed/src/model.ts, which embedded the symbols: a query vector is only
// comparable with vectors from the same model. tests/unit/search.test.ts checks this.
export const EMBEDDING_MODEL = "jinaai/jina-embeddings-v2-base-code";
export const EMBEDDING_DIMS = 768;

const cache = globalThis as typeof globalThis & { cieQueryModel?: Promise<FeatureExtractionPipeline> };

function model(): Promise<FeatureExtractionPipeline> {
  env.cacheDir = path.join(process.cwd(), ".cache/models");
  cache.cieQueryModel ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" }).catch((error: unknown) => {
    cache.cieQueryModel = undefined;
    throw error;
  });
  return cache.cieQueryModel;
}

// Same pooling and normalisation as the ingest step, so cosine similarity is comparable.
export async function embedQuery(text: string): Promise<number[]> {
  const extract = await model();
  const output = await extract([text], { pooling: "mean", normalize: true });
  return (output.tolist() as number[][])[0];
}
