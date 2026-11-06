# CRM operations

Open `/admin` with the existing owner account. The Team section creates admin, sales, and viewer accounts. Passwords require 12–200 characters and use salted scrypt. Disabling/resetting an account or changing its role invalidates its sessions. The environment-backed owner cannot be removed through the UI. Sales can read/edit their own or unassigned leads; viewers read all leads; only admins manage staff, integrations, deletion, documents and backups. CSV exports apply the same customer visibility rules as the list.

Lead cards store assignment, qualification, shipping details, quote information, actual sale value/date and lost reason. Updates use the row version and append an audit snapshot in the same SQL statement. Phone grouping preserves separate requests. Today and overdue filters use Asia/Bangkok dates. Monetary amounts are THB. The close date is a business reporting date; Ads uses the timestamp of the first recorded won transition.

## LINE

In the Integration section, save a Messaging API channel access token and recipient ID, then explicitly send a test. Blank token input retains the stored secret. Settings are AES-256-GCM encrypted using `BACKUP_ENCRYPTION_KEY`, which must be retained for database recovery. The site works without these credentials. A database outage can only use fallback LINE credentials configured in environment variables; database-stored credentials cannot be loaded during that outage.

Maintenance runs daily at 23:00 UTC (06:00–07:00 Bangkok on the current scheduler). It retries new-lead messages, processes up to five follow-up reminders, processes up to five Ads queue entries, and verifies an encrypted backup. It does not provide exact appointment-time delivery. Use the manual follow-up button during the day. A unique reminder ID and atomic lease prevent concurrent duplicate delivery. After 23 hours of uncertain delivery or five failed attempts, inspect LINE before explicitly resetting the reminder. Integrations do not deliver customer messages automatically before being configured.

## Google Ads offline outcomes

Existing web form conversion remains separate. Create import-from-click conversions (`UPLOAD_CLICKS`) for qualified leads and sales, then enter their numeric action IDs, conversion customer ID, OAuth client/refresh credentials and developer token. These are not the existing AW web conversion label. Manager ID is optional when using a manager account. Use Test to verify access/type before enabling automatic uploads. No real Ads uploads were made during development.

Only leads with a captured `gclid`, `gbraid` or `wbraid` can create a queue entry. The public form captures these only with measurement consent. No name, phone, email, shipping address or note is uploaded. Stable order IDs separate qualified/won events and prevent duplicate counting on retries. Qualified events have value 0; won events use the recorded sale amount. API errors and partial failures remain failed; five unsuccessful attempts require investigation. Once delivery is attempted, its payload is retained for safe retries. Corrections to already sent values/status require a Google Ads conversion adjustment; this UI does not retract them.

CSV is a manual alternative for GCLID entries only. Enter exact conversion names first. Confirm successfully imported rows before enabling API uploads. Do not upload both API and CSV concurrently. Downloading does not mark records as sent. Braided click identifiers require the API path. Keep configured conversion IDs consistent after sending; changing destinations requires migration/reconciliation.

## Backup and restore

Schema v3 snapshots include leads, lead history, contact events, document metadata/content, staff users, encrypted integration settings, reminders, and Ads queue. Apply db-init and migrations to an empty database, then use `scripts/restore.mjs` with `RESTORE_DATABASE_URL` and `--confirm-empty-target`. Restore refuses a populated target. Keep the original encryption key outside the database. V2 backups remain accepted; normalize phone keys afterward using `scripts/backfill-phone.mjs`.

Development verification: isolated database integration tests cover role scope, session revocation, optimistic update conflicts, shipment/sale validation, reminder deduplication and Ads partial failures. A second empty test database was restored and all eight application tables compared with the encrypted snapshot. External LINE and Ads requests were mocked. Mobile 390 px and desktop 1440 px layouts were checked for overflow.
