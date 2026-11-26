-- Roadmap 3.3b: calendar sync (docs/porting/maps/3.3.md, "Calendar sync: the
-- model"; ADR 0011; owner decisions 225 to 244; docs/calendar-sync.md).
--
--   1. Prisma's DDL: the workspace's calendar sync settings, a member's
--      calendar connection and the record of each event Islestone pushed.
--   2. What Prisma cannot declare: one synced event per connection and work
--      item or milestone (partial uniques), the kind naming exactly one of
--      them, the closed lists of codes, the identifiers' shapes and lengths,
--      and a connection's token present exactly while it can be used.
--   3. Grants and the canonical RLS. The teardown deletes connections and
--      their synced events, so `app_user` holds DELETE on both; the settings
--      row is never deleted (no DELETE).
--
-- The tables are this image's own: the previous image never reads them.

-- ─── 1) Prisma's DDL ─────────────────────────────────────────────

CREATE TABLE "TenantCalendarSettings" (
    "tenantId" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "microsoftExternalTenantId" TEXT,
    "microsoftConsentGrantedAt" TIMESTAMP(3),
    "microsoftConsentGrantedByUserId" TEXT,
    "microsoftConsentRevokedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantCalendarSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "state" "CalendarConnectionState" NOT NULL DEFAULT 'CONNECTED',
    "tokenEncrypted" TEXT,
    "scopesGranted" TEXT[],
    "externalCalendarId" TEXT,
    "syncCursor" TEXT,
    "revokedReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarSyncedEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" "CalendarSyncedEventKind" NOT NULL,
    "workItemId" TEXT,
    "milestoneId" TEXT,
    "remoteEventId" TEXT NOT NULL DEFAULT '',
    "clientEventId" TEXT NOT NULL,
    "pushedDueDate" DATE NOT NULL,
    "contentHash" TEXT NOT NULL,
    "remoteVersion" TEXT,
    "state" "CalendarSyncedEventState" NOT NULL DEFAULT 'PUSHED',
    "lastError" TEXT,
    "lastPushedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarSyncedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarConnection_tenantId_state_idx" ON "CalendarConnection"("tenantId", "state");

-- CreateIndex
CREATE INDEX "CalendarConnection_userId_idx" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_tenantId_userId_provider_key" ON "CalendarConnection"("tenantId", "userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_id_tenantId_key" ON "CalendarConnection"("id", "tenantId");

-- CreateIndex
CREATE INDEX "CalendarSyncedEvent_tenantId_connectionId_state_idx" ON "CalendarSyncedEvent"("tenantId", "connectionId", "state");

-- CreateIndex
CREATE INDEX "CalendarSyncedEvent_tenantId_workItemId_idx" ON "CalendarSyncedEvent"("tenantId", "workItemId");

-- CreateIndex
CREATE INDEX "CalendarSyncedEvent_tenantId_milestoneId_idx" ON "CalendarSyncedEvent"("tenantId", "milestoneId");

-- AddForeignKey
ALTER TABLE "TenantCalendarSettings" ADD CONSTRAINT "TenantCalendarSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_connectionId_tenantId_fkey" FOREIGN KEY ("connectionId", "tenantId") REFERENCES "CalendarConnection"("id", "tenantId") ON DELETE NO ACTION ON UPDATE CASCADE;



-- ─── 2) What Prisma cannot declare ────────────────────────────────

-- One synced event per connection and item, and per connection and milestone.
CREATE UNIQUE INDEX "CalendarSyncedEvent_one_per_item" ON "CalendarSyncedEvent"("connectionId", "workItemId") WHERE "workItemId" IS NOT NULL;
CREATE UNIQUE INDEX "CalendarSyncedEvent_one_per_milestone" ON "CalendarSyncedEvent"("connectionId", "milestoneId") WHERE "milestoneId" IS NOT NULL;

-- The kind names exactly one source.
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_kind_source" CHECK (
    ("kind" = 'WORK_ITEM' AND "workItemId" IS NOT NULL AND "milestoneId" IS NULL)
    OR ("kind" = 'MILESTONE' AND "milestoneId" IS NOT NULL AND "workItemId" IS NULL)
);
-- Islestone's own identifiers: 40 and 32 lowercase hex characters.
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_client_event_id_shape"
    CHECK ("clientEventId" ~ '^[0-9a-f]{40}$');
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_content_hash_shape"
    CHECK ("contentHash" ~ '^[0-9a-f]{32}$');
-- The provider's identifiers are opaque and bounded.
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_remote_event_id_length"
    CHECK (char_length("remoteEventId") <= 1024);
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_remote_version_length"
    CHECK ("remoteVersion" IS NULL OR char_length("remoteVersion") <= 512);
-- A failure is a code from a closed list, never a provider body.
ALTER TABLE "CalendarSyncedEvent" ADD CONSTRAINT "CalendarSyncedEvent_last_error_code"
    CHECK ("lastError" IS NULL OR "lastError" IN ('UNCONFIRMED', 'PROVIDER_ERROR', 'NOT_FOUND', 'REFUSED'));

-- A connection's token is present exactly while it can be used: always while
-- CONNECTED, never once REVOKED; the teardown (DISCONNECTING) may still hold
-- it to delete the member's events, and destroys it after.
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_token_present"
    CHECK ("state" <> 'CONNECTED' OR "tokenEncrypted" IS NOT NULL);
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_token_destroyed"
    CHECK ("state" <> 'REVOKED' OR "tokenEncrypted" IS NULL);
-- A revocation carries its fixed reason, and only a revocation does.
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_revoked_reason"
    CHECK (("state" = 'REVOKED') = ("revokedReason" IS NOT NULL)
           AND ("revokedReason" IS NULL OR "revokedReason" IN ('ACCESS_WITHDRAWN', 'GRANT_INVALID')));
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_external_calendar_id_length"
    CHECK ("externalCalendarId" IS NULL OR char_length("externalCalendarId") BETWEEN 1 AND 1024);
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_sync_cursor_length"
    CHECK ("syncCursor" IS NULL OR char_length("syncCursor") BETWEEN 1 AND 2048);
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_scopes_bounded"
    CHECK (cardinality("scopesGranted") <= 20);

-- Microsoft's consent: the directory is a GUID, and a grant names when and who.
ALTER TABLE "TenantCalendarSettings" ADD CONSTRAINT "TenantCalendarSettings_microsoft_directory_shape"
    CHECK ("microsoftExternalTenantId" IS NULL
           OR "microsoftExternalTenantId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
ALTER TABLE "TenantCalendarSettings" ADD CONSTRAINT "TenantCalendarSettings_microsoft_grant_complete"
    CHECK (("microsoftExternalTenantId" IS NULL) = ("microsoftConsentGrantedAt" IS NULL)
           AND ("microsoftConsentGrantedAt" IS NULL) = ("microsoftConsentGrantedByUserId" IS NULL));
ALTER TABLE "TenantCalendarSettings" ADD CONSTRAINT "TenantCalendarSettings_version_positive" CHECK ("version" >= 1);

-- ─── 3) Grants and RLS ─────────────────────────────────────────────

-- The REVOKE is explicit because the database's default privileges grant
-- DELETE on every new table (prisma/init-roles.sh).
GRANT SELECT, INSERT, UPDATE ON "TenantCalendarSettings" TO app_user;
REVOKE DELETE, TRUNCATE ON "TenantCalendarSettings" FROM app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "CalendarConnection", "CalendarSyncedEvent" TO app_user;

ALTER TABLE "TenantCalendarSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantCalendarSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantCalendarSettings"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "TenantCalendarSettings"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "TenantCalendarSettings"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "CalendarConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CalendarConnection"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "CalendarConnection"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "CalendarConnection"
    USING (current_setting('role') != 'app_user');

ALTER TABLE "CalendarSyncedEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarSyncedEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CalendarSyncedEvent"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "CalendarSyncedEvent"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "CalendarSyncedEvent"
    USING (current_setting('role') != 'app_user');
