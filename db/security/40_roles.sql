-- Database roles that mirror the two application roles in app_user.role.
--
--   cie_developer  reads every table and view, but not password hashes
--   cie_admin      everything a developer can do, plus the writes only admins may make:
--                  adding and re-ingesting repositories, reviewing clone clusters,
--                  recording waivers and managing users
--
-- Both are NOLOGIN group roles. A login role is made a member of one of them, or a
-- session that connected as the owner drops its rights with SET ROLE. Roles belong to
-- the whole cluster, so creating them is guarded; the grants belong to this database.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cie_developer') THEN
        CREATE ROLE cie_developer NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cie_admin') THEN
        CREATE ROLE cie_admin NOLOGIN;
    END IF;
END $$;

-- An admin inherits every developer privilege.
GRANT cie_developer TO cie_admin;

GRANT USAGE ON SCHEMA public TO cie_developer;

-- Developers: read-only access to the code structure, history and similarity data.
GRANT SELECT ON repository, file, symbol, calls, imports,
                author, author_email, commit, modifies,
                clone_cluster, waives, symbol_embedding
    TO cie_developer;
GRANT SELECT ON v_symbol_hotspot, v_file_ownership, v_author_activity TO cie_developer;

-- Column-level grant: developers can see who the users are and what role they have,
-- never the password hash.
GRANT SELECT (user_id, username, role, created_at) ON app_user TO cie_developer;

-- Admins: add, re-ingest and remove repositories. Re-ingesting deletes and recreates
-- the repository's files, symbols, calls and imports.
GRANT INSERT, UPDATE, DELETE ON repository, file, symbol, calls, imports TO cie_admin;

-- Admins: review clone clusters. Only the two columns a review sets are writable;
-- reviewed_at is stamped by the clone_cluster_review_guard trigger.
GRANT UPDATE (status, reviewed_by) ON clone_cluster TO cie_admin;
GRANT INSERT, UPDATE, DELETE ON waives TO cie_admin;

-- Admins: manage users, including their password hashes.
GRANT SELECT, INSERT, UPDATE, DELETE ON app_user TO cie_admin;

-- Functions are executable by PUBLIC by default. The read functions stay that way.
-- The review procedure is limited to admins, so a developer cannot even call it.
REVOKE EXECUTE ON PROCEDURE review_clone_cluster(bigint, bigint, text, bigint[], text) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE review_clone_cluster(bigint, bigint, text, bigint[], text) TO cie_admin;
