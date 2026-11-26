-- Roadmap 3.3c: the calendar read-back (docs/porting/maps/3.3.md, "The
-- read-back"; ADR 0011 §1; owner decision 230). The notification that a
-- calendar change was not applied is in-app only, never email: no member's
-- preference row may ask for one, for any writer. The usecase refuses the
-- choice first (400 `EMAIL_NOT_OFFERED`); this CHECK holds it for every
-- writer, as `NotificationPreference_immediate_types` holds immediate email.
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_in_app_only_types"
    CHECK ("type" <> 'CALENDAR_CHANGE_NOT_APPLIED' OR "emailDelivery" = 'OFF');
