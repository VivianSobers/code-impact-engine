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
