-- Sub-phase 2.7f: the `islestone_bg_en` text-search configuration
-- (docs/porting/maps/2.7.md, part 3; ADR 0008 D2; owner decisions 126 and
-- 145 to 147; docs/search.md).
--
--   1. The Bulgarian Hunspell dictionary (`bulgarian_hunspell`, PostgreSQL's
--      `ispell` template over `bulgarian.dict` / `bulgarian.affix`, which
--      ONLY Islestone's Postgres image carries: deploy/postgres/Dockerfile).
--   2. The configuration: a copy of `english` (Latin words through the
--      Snowball `english_stem`, with its stop list), whose other-letter words
--      (Cyrillic, accented Latin) go through the Bulgarian dictionary, then
--      `simple`, so a word the dictionary does not know is indexed as typed.
--   3. The fixtures: a fixed list of Bulgarian inflections and English words
--      must stem to their lemmas, or the migration fails.
--   4. 2.7b's two `simple` full-text indexes are replaced by
--      `islestone_bg_en` ones, so titles, project names, stored vectors and
--      queries stem alike.
--
-- FAIL CLOSED (decision 126). On a server without the dictionary files (the
-- stock pgvector image), step 1 raises, the migration fails, `migrate` exits
-- and both application images wait at wait-for-migrations. Nothing here, or
-- anywhere, falls back to `simple` or `english`. The one-time rollout onto
-- the new image is docs/deployment.md, "The Postgres image" (decision 147).
--
-- The previous image keeps working: its queries spell
-- `to_tsvector('simple', …)`, which no longer has an index but still runs,
-- within the workspace's rows.
--
-- The fixture list is `SEARCH_CONFIGURATION_FIXTURES` in
-- src/lib/search/configuration.ts too (the startup and readiness checks);
-- tests/unit/search/search-configuration.test.ts holds the two equal.

-- ─── 1) The dictionary ───────────────────────────────────────────

DO $$
BEGIN
    CREATE TEXT SEARCH DICTIONARY public.bulgarian_hunspell (
        TEMPLATE = ispell,
        DictFile = bulgarian,
        AffFile = bulgarian
    );
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'islestone_bg_en: the Bulgarian dictionary could not be loaded (%). This server is not running Islestone''s Postgres image (deploy/postgres/Dockerfile, ghcr.io/rodnapamet/islestone-postgres), which carries bulgarian.dict and bulgarian.affix in $SHAREDIR/tsearch_data. Move the database onto that image first: docs/deployment.md, "The Postgres image".', SQLERRM
        USING ERRCODE = 'undefined_file';
END
$$;

-- ─── 2) The configuration ────────────────────────────────────────

CREATE TEXT SEARCH CONFIGURATION public.islestone_bg_en (COPY = pg_catalog.english);
ALTER TEXT SEARCH CONFIGURATION public.islestone_bg_en
    ALTER MAPPING FOR word, hword, hword_part WITH public.bulgarian_hunspell, simple;

-- ─── 3) The fixtures ─────────────────────────────────────────────

DO $$
DECLARE
    f record;
    got text;
BEGIN
    FOR f IN SELECT * FROM (VALUES
        ('книгите', 'книга'),
        ('задачата', 'задача'),
        ('задачи', 'задача'),
        ('проектите', 'проект'),
        ('коментарите', 'коментар'),
        ('потребителите', 'потребител'),
        ('сроковете', 'срок'),
        ('срокът', 'срок'),
        ('въпросите', 'въпрос'),
        ('отговорът', 'отговор'),
        ('работихме', 'работя'),
        ('държавата', 'държава'),
        ('Задачата', 'задача'),
        ('running', 'run'),
        ('tests', 'test'),
        ('fixing', 'fix'),
        ('щъркелоподобни', 'щъркелоподобни')
    ) AS t(input, lexeme)
    LOOP
        got := array_to_string(tsvector_to_array(to_tsvector('public.islestone_bg_en', f.input)), ' ');
        IF got IS DISTINCT FROM f.lexeme THEN
            RAISE EXCEPTION 'islestone_bg_en: "%" stems to "%", expected "%". The Bulgarian dictionary in this image is not the pinned one (deploy/postgres/dictionary.json).', f.input, got, f.lexeme
                USING ERRCODE = 'data_exception';
        END IF;
    END LOOP;
END
$$;

-- ─── 4) Titles and project names on the configuration ────────────
--
-- Same shape as 2.7b's (tenant-leading, live rows only); a query must spell
-- the expression exactly, `to_tsvector('islestone_bg_en', …)`, for the
-- planner to use it.

DROP INDEX IF EXISTS "WorkItem_search_title_fts";
CREATE INDEX "WorkItem_search_title_fts" ON "WorkItem"
    USING gin ("tenantId", to_tsvector('islestone_bg_en', "title"))
    WHERE "deletedAt" IS NULL;

DROP INDEX IF EXISTS "Project_search_name_fts";
CREATE INDEX "Project_search_name_fts" ON "Project"
    USING gin ("tenantId", to_tsvector('islestone_bg_en', "name"))
    WHERE "deletedAt" IS NULL;
