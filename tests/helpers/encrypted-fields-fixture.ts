/**
 * A FIXTURE encryption manifest for the field-encryption extension's suites.
 *
 * Islestone's real manifest (`src/lib/security/encrypted-fields.ts`) holds one
 * entry, so suites that exercise the extension's traversal (nested writes,
 * included relations, many fields per row, models outside the manifest) would
 * have little to traverse. They mock the manifest module with this one
 * instead:
 *
 *     jest.mock('@/lib/security/encrypted-fields', () =>
 *         jest.requireActual('../helpers/encrypted-fields-fixture').fixtureManifestModule());
 *
 * The data is inflect-compliance's manifest at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, taken as TEST DATA so the copied
 * suites' assertions read unchanged. These are not Islestone models; nothing
 * here may be added to the real manifest (docs/porting/maps/1.5.md, Traps).
 * The helper functions below mirror the real module's, over this map.
 */
import type * as EncryptedFieldsModule from '@/lib/security/encrypted-fields';

export const FIXTURE_ENCRYPTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
    TenantSecuritySettings: ['auditStreamSecretEncrypted'],
    AutomationRule: ['webhookSecretEncrypted'],
    IdentityWriteJournal: ['detail'],
    LegacyIdentityAlias: ['justification'],
    ExternalWriteJournal: ['detail', 'argumentsJson', 'priorStateJson'],
    ConnectedIdentityAccount: ['protectionReason'],
    Risk: ['treatmentNotes', 'threat', 'vulnerability'],
    AssetVulnerability: ['note'],
    ScannerFinding: ['description'],
    BusinessImpactAnalysis: ['notes'],
    LossEvent: ['description', 'justification'],
    Finding: [
    'description',
    'rootCause',
    'correctiveAction',
    'analysis',
    'verificationNotes',
    ],
    Evidence: ['description'],
    EvidenceReview: ['comment'],
    PolicyVersion: ['contentText', 'changeSummary'],
    Vendor: ['description'],
    VendorDocument: ['notes'],
    VendorAssessment: ['notes'],
    VendorEvidenceBundle: ['description'],
    Task: ['description', 'resolution'],
    TaskComment: ['body'],
    Audit: [
    'auditScope',
    'criteria',
    'auditors',
    'auditees',
    'departments',
    ],
    AuditChecklistItem: ['prompt', 'notes', 'evidenceRef'],
    ControlTestRun: ['notes', 'findingSummary'],
    /*
    ─── Audit-pack item snapshots (#5150) ─────────────
    `snapshotTestRun` freezes a completed run into an audit pack and copies
    `ControlTestRun.notes` and `findingSummary` — both encrypted above —
    into this column. The middleware has already DECRYPTED them by then, so
    the copy landed in plaintext: a database dump, a backup or the read
    replica exposed the tester's narrative that the source row protects, and
    neither the encryption-at-rest guarantee nor DEK rotation covered it.
    The executor's email is in the same object.
    Encrypting the COLUMN rather than dropping those two fields from the
    snapshot (owner decision): the notes and the finding summary are the
    most audit-relevant part of a test run, and a frozen pack that omits
    them tells an external auditor less than the live record does.
    Checked before adding, because this column is not only a test-run
    snapshot:
    - it is a `String` on `AuditPackItem` (audit-workflow.prisma), so the
    middleware encrypts it. The two SIBLING `snapshotJson` columns —
    `VendorEvidenceBundleItem` and `AccessReviewConnectedDecision` — are
    `Json`, which the middleware skips (`typeof value !== 'string'`), so
    this entry cannot reach them even through the name-keyed fan-out;
    - nothing filters or sorts on it. Every reader parses it in
    application code (`snapshotName`, `needsSnapshot`), and there are
    ZERO raw-SQL touches of `AuditPackItem`, so all 23 read sites go
    through the extended client and decrypt transparently — the pack
    export and the auditor share link included;
    - the other entity types that share the column (SOA_REPORT, FILE,
    ISSUE) carry no encrypted content. They are encrypted now too,
    which is incidental cost rather than benefit, and the price of the
    column being one shape for every item type.
    LIMITATION, and it needs a backfill to close. The read path skips any
    value without a `v1:`/`v2:` envelope (`isEncryptedValue`), so rows
    written before this entry keep reading correctly AND stay in plaintext.
    The DEK rotation sweep will not fix them either: it only rewrites values
    that already carry an envelope. Existing packs therefore remain exposed
    until a backfill rewrites them through the extended client.
    */
    AuditPackItem: ['snapshotJson'],
    AccessReview: ['description'],
    BackgroundCheck: ['resultSummary'],
    AccessReviewDecision: ['notes'],
    ControlException: ['justification', 'rejectionReason'],
    AiSystem: ['purpose', 'useContext'],
    RiskScoreEvent: ['justification'],
    AgentHarnessAcceptance: ['justification'],
    DiscoveredAgentAttribution: ['signalsJson', 'proposedOwnerRef'],
    AuditWorkpaperNarrative: ['text'],
    AgentProposal: ['payloadJson', 'rationale'],
    WorkflowRun: ['contextJson', 'summary'],
    WorkflowStep: ['inputJson', 'outputJson'],
    WorkflowRunDeferral: ['transcriptJson'],
    TenantSkillVersion: ['instructions', 'evaluationRecordJson'],
    AgentProfileVersion: ['instructions', 'rejectionReason', 'flowJson', 'subagentsJson'],
    RegisteredAgent: ['description'],
    AgentRiskAssessmentAnswer: ['note'],
    AgentKillSwitch: ['reason', 'liftReason'],
    PeerAgentKillSwitch: ['reason', 'liftReason'],
    PeerAgentMessage: ['body'],
    HostConsumerMessage: ['body'],
    HostConsumerKillSwitch: ['reason', 'liftReason'],
    TenantA2aSigningKey: ['privateKeySeed'],
    RiskTreatmentPlan: ['closingRemark'],
    TreatmentMilestone: ['description'],
    Nis2SelfAssessmentAnswer: ['note'],
    AiGovSelfAssessmentAnswer: ['note'],
    Incident: ['description'],
    IncidentNotification: ['submissionNote'],
    IncidentTimelineEntry: ['entry'],
    AuditPackShareComment: ['body'],
    KnowledgeChunk: ['text'],
};

export function fixtureManifestModule(): typeof EncryptedFieldsModule {
    const models: ReadonlySet<string> = new Set(Object.keys(FIXTURE_ENCRYPTED_FIELDS));
    const names: ReadonlySet<string> = new Set(Object.values(FIXTURE_ENCRYPTED_FIELDS).flat());
    return {
        ENCRYPTED_FIELDS: FIXTURE_ENCRYPTED_FIELDS,
        ENCRYPTED_MODELS: models,
        ALL_ENCRYPTED_FIELD_NAMES: names,
        nodeHasAnyEncryptedFieldKey: (node: Record<string, unknown>) => Object.keys(node).some((k) => names.has(k)),
        getEncryptedFields: (model: string | undefined) => (model ? FIXTURE_ENCRYPTED_FIELDS[model] : undefined),
        isEncryptedModel: (model: string | undefined) => model !== undefined && models.has(model),
    };
}
