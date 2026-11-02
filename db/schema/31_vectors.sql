CREATE EXTENSION IF NOT EXISTS vector;

-- One embedding per distinct symbol body and model. Symbols with identical bodies
-- (or a symbol that survives a re-parse unchanged) share a row through body_hash.
CREATE TABLE symbol_embedding (
    embedding_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    model        text        NOT NULL,
    body_hash    char(64)    NOT NULL,
    embedding    vector(768) NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT symbol_embedding_model_body_key UNIQUE (model, body_hash),
    CONSTRAINT symbol_embedding_body_hash_hex CHECK (body_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT symbol_embedding_model_not_blank CHECK (btrim(model) <> '')
);

-- Approximate nearest-neighbour search by cosine distance (the <=> operator).
CREATE INDEX symbol_embedding_hnsw_idx ON symbol_embedding
    USING hnsw (embedding vector_cosine_ops);

-- symbol.embedding_id already exists as a plain column in 10_structure.sql.
ALTER TABLE symbol
    ADD CONSTRAINT symbol_embedding_fkey FOREIGN KEY (embedding_id)
        REFERENCES symbol_embedding (embedding_id) ON DELETE SET NULL;

CREATE INDEX symbol_embedding_id_idx ON symbol (embedding_id) WHERE embedding_id IS NOT NULL;
