import path from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { repoRoot } from "../../parse/src/config";

// Code embedding model, run locally. The app embeds search queries with the same model
// (lib/search/model.ts), and symbol_embedding.model records which one made a vector.
export const EMBEDDING_MODEL = "jinaai/jina-embeddings-v2-base-code";
export const EMBEDDING_DIMS = 768;
export const MODEL_CACHE = path.join(repoRoot, ".cache/models");

const BATCH = 16;
let extractor: Promise<FeatureExtractionPipeline> | null = null;

function model(): Promise<FeatureExtractionPipeline> {
  env.cacheDir = MODEL_CACHE;
  extractor ??= pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" }).catch((error: unknown) => {
    extractor = null;
    throw new Error(
      `Could not load ${EMBEDDING_MODEL}. The first run downloads it (about 160 MB) into ${MODEL_CACHE}. ${String(error)}`,
    );
  });
  return extractor;
}

// Mean-pooled, unit-length vectors, so cosine similarity is a dot product.
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extract = await model();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const output = await extract(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true });
    vectors.push(...(output.tolist() as number[][]));
  }
  return vectors;
}
