-- Sub-phase 2.4b-c: questions and the marked answer (docs/porting/maps/2.4b.md;
-- ADR 0002 §15; owner decisions 113 to 118).
--
-- 1) Prisma's DDL: WorkItem.answerCommentId, its index, Comment's
--    (id, workItemId, tenantId) unique key and the composite FK, which makes
--    another item's comment unstorable. NO ACTION, so the purge's cascade
--    from an item to its comments (one statement) passes.
-- 2) The backstop Prisma cannot declare: comments are soft-deleted, so the
--    FK cannot stop a delete of the marked comment. The usecase refuses it
--    (decision 113: clear the answer first); this trigger refuses setting
--    `deletedAt` on a comment an item marks as its answer, for any writer.
--    It watches `deletedAt` only: the key-rotation sweeps re-wrap the
--    encrypted `body` with a raw UPDATE, which must pass.
--
-- No new table and no RLS change.

-- ─── 1) Column, index, unique key and FK ──────────────────────────
ALTER TABLE "WorkItem" ADD COLUMN     "answerCommentId" TEXT;

CREATE UNIQUE INDEX "Comment_id_workItemId_tenantId_key" ON "Comment"("id", "workItemId", "tenantId");

CREATE INDEX "WorkItem_tenantId_answerCommentId_idx" ON "WorkItem"("tenantId", "answerCommentId");

ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_answerCommentId_id_tenantId_fkey" FOREIGN KEY ("answerCommentId", "id", "tenantId") REFERENCES "Comment"("id", "workItemId", "tenantId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ─── 2) The marked answer is never soft-deleted ───────────────────
CREATE OR REPLACE FUNCTION comment_answer_not_deleted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "WorkItem"
        WHERE "tenantId" = OLD."tenantId" AND "answerCommentId" = OLD."id"
    ) THEN
        RAISE EXCEPTION 'ANSWER_COMMENT_LOCKED: comment % is a work item''s marked answer; clear the answer first', OLD."id"
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER comment_answer_not_deleted
    BEFORE UPDATE OF "deletedAt" ON "Comment"
    FOR EACH ROW
    WHEN (OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL)
    EXECUTE FUNCTION comment_answer_not_deleted();
