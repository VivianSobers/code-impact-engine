-- Only an admin can confirm or dismiss a clone cluster. Closing a cluster stamps
-- reviewed_at; reopening it clears the reviewer.
CREATE FUNCTION clone_cluster_review_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    -- Unknown statuses are left to the CHECK constraint.
    IF NEW.status NOT IN ('confirmed', 'dismissed') THEN
        IF TG_OP = 'UPDATE' AND NEW.status = 'open' THEN
            NEW.reviewed_by := NULL;
            NEW.reviewed_at := NULL;
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'closing clone cluster % needs a reviewer', NEW.cluster_id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM app_user WHERE user_id = NEW.reviewed_by AND role = 'admin') THEN
        RAISE EXCEPTION 'user % is not an admin and cannot review clone clusters', NEW.reviewed_by
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    NEW.reviewed_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER clone_cluster_review_guard
    BEFORE INSERT OR UPDATE OF status ON clone_cluster
    FOR EACH ROW EXECUTE FUNCTION clone_cluster_review_guard();

-- Confirm or dismiss a clone cluster and record waivers for some of its members, as
-- one unit. The procedure does not commit: the caller wraps it in a transaction, and
-- any error leaves the cluster and the waivers unchanged. The row lock makes a
-- concurrent second review wait and then fail instead of overwriting the first.
CREATE PROCEDURE review_clone_cluster(
    p_cluster_id bigint,
    p_reviewer   bigint,
    p_status     text,
    p_waive      bigint[] DEFAULT '{}',
    p_reason     text     DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_status   text;
    v_outsider bigint;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('confirmed', 'dismissed') THEN
        RAISE EXCEPTION 'review outcome must be confirmed or dismissed, not %', p_status
            USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT status INTO v_status FROM clone_cluster WHERE cluster_id = p_cluster_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'clone cluster % does not exist', p_cluster_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_status <> 'open' THEN
        RAISE EXCEPTION 'clone cluster % was already reviewed', p_cluster_id USING ERRCODE = 'serialization_failure';
    END IF;

    SELECT w INTO v_outsider
    FROM unnest(coalesce(p_waive, '{}')) AS w
    WHERE NOT EXISTS (SELECT 1 FROM symbol s WHERE s.symbol_id = w AND s.cluster_id = p_cluster_id)
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'symbol % is not a member of clone cluster %', v_outsider, p_cluster_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF cardinality(coalesce(p_waive, '{}')) > 0 AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
        RAISE EXCEPTION 'waiving symbols needs a reason' USING ERRCODE = 'check_violation';
    END IF;

    -- clone_cluster_review_guard checks that the reviewer is an admin and stamps reviewed_at.
    UPDATE clone_cluster SET status = p_status, reviewed_by = p_reviewer WHERE cluster_id = p_cluster_id;

    INSERT INTO waives (user_id, symbol_id, reason)
    SELECT p_reviewer, w, btrim(p_reason) FROM unnest(coalesce(p_waive, '{}')) AS w
    ON CONFLICT (user_id, symbol_id) DO UPDATE SET reason = EXCLUDED.reason, waived_at = now();
END $$;
