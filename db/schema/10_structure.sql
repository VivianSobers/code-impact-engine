CREATE TABLE repository (
    repo_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           text        NOT NULL,
    url            text        NOT NULL,
    default_branch text        NOT NULL DEFAULT 'main',
    added_date     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT repository_url_key UNIQUE (url),
    CONSTRAINT repository_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT repository_branch_not_blank CHECK (btrim(default_branch) <> '')
);

CREATE TABLE file (
    repo_id      bigint  NOT NULL,
    path         text    NOT NULL,
    language     text    NOT NULL,
    loc          integer NOT NULL DEFAULT 0,
    content_hash char(64) NOT NULL,
    ast_doc_id   char(24),
    CONSTRAINT file_pkey PRIMARY KEY (repo_id, path),
    CONSTRAINT file_repo_fkey FOREIGN KEY (repo_id)
        REFERENCES repository (repo_id) ON DELETE CASCADE,
    CONSTRAINT file_path_relative CHECK (path <> '' AND left(path, 1) <> '/' AND path !~ '\\'),
    CONSTRAINT file_language_known CHECK (language IN ('javascript', 'typescript', 'python', 'java', 'go')),
    CONSTRAINT file_loc_nonnegative CHECK (loc >= 0),
    CONSTRAINT file_content_hash_sha256 CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT file_ast_doc_id_objectid CHECK (ast_doc_id ~ '^[0-9a-f]{24}$')
);

CREATE TABLE symbol (
    symbol_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo_id        bigint  NOT NULL,
    path           text    NOT NULL,
    name           text    NOT NULL,
    kind           text    NOT NULL,
    signature      text,
    start_line     integer NOT NULL,
    end_line       integer NOT NULL,
    is_entry_point boolean NOT NULL DEFAULT false,
    embedding_id   bigint,
    cluster_id     bigint,
    CONSTRAINT symbol_file_fkey FOREIGN KEY (repo_id, path)
        REFERENCES file (repo_id, path) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT symbol_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT symbol_kind_known CHECK (kind IN ('function', 'method', 'class', 'interface', 'enum', 'module')),
    CONSTRAINT symbol_start_line_positive CHECK (start_line >= 1),
    CONSTRAINT symbol_span_ordered CHECK (end_line >= start_line),
    CONSTRAINT symbol_location_key UNIQUE (repo_id, path, kind, name, start_line)
);

CREATE INDEX symbol_name_idx ON symbol (name);
CREATE INDEX symbol_entry_point_idx ON symbol (repo_id) WHERE is_entry_point;

CREATE TABLE calls (
    caller_id             bigint       NOT NULL,
    callee_id             bigint       NOT NULL,
    call_line             integer      NOT NULL,
    resolution_confidence numeric(3,2) NOT NULL,
    CONSTRAINT calls_pkey PRIMARY KEY (caller_id, callee_id, call_line),
    CONSTRAINT calls_caller_fkey FOREIGN KEY (caller_id)
        REFERENCES symbol (symbol_id) ON DELETE CASCADE,
    CONSTRAINT calls_callee_fkey FOREIGN KEY (callee_id)
        REFERENCES symbol (symbol_id) ON DELETE CASCADE,
    CONSTRAINT calls_call_line_positive CHECK (call_line >= 1),
    CONSTRAINT calls_confidence_range CHECK (resolution_confidence BETWEEN 0 AND 1)
);

CREATE INDEX calls_callee_idx ON calls (callee_id);

CREATE TABLE imports (
    importer_repo_id bigint NOT NULL,
    importer_path    text   NOT NULL,
    imported_repo_id bigint NOT NULL,
    imported_path    text   NOT NULL,
    CONSTRAINT imports_pkey PRIMARY KEY (importer_repo_id, importer_path, imported_repo_id, imported_path),
    CONSTRAINT imports_importer_fkey FOREIGN KEY (importer_repo_id, importer_path)
        REFERENCES file (repo_id, path) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT imports_imported_fkey FOREIGN KEY (imported_repo_id, imported_path)
        REFERENCES file (repo_id, path) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT imports_not_self CHECK (
        importer_repo_id <> imported_repo_id OR importer_path <> imported_path
    )
);

CREATE INDEX imports_imported_idx ON imports (imported_repo_id, imported_path);
