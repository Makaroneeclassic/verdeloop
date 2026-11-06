# Verdeloop operations

Implemented 2026-09-10. Administration: https://verdeloopthailand.com/admin

## Contacts and attribution

- Consent-controlled first-party events: page views, phone clicks, LINE clicks, document downloads. Declining does not prevent form submissions. Changes are available through the measurement settings button.
- A successful form creates the authoritative lead record. Client-side `generate_lead` is sent only after an acknowledged success, not by merely opening `/thank-you/`.
- First/last campaign touches live in session storage with a 30-minute expiry after consent; sanitized UTM fields, ad click IDs, landing path, and referring hostname are attached to consenting leads. Do not put personal information in campaign names.
- Admin reports cover the last 30 days. Events are retained for 90 days; lead attribution is retained with the lead. Counts of clicks are not counts of sales or confirmed conversations.
- Optional Google integration needs `PUBLIC_GA4_ID`, `PUBLIC_GOOGLE_ADS_ID`, and `PUBLIC_GOOGLE_ADS_LEAD_LABEL` on production, followed by a rebuild. No customer name, email, phone, or message is sent to Google. Ad personalization and ad user data consent remain denied.

## Sales tracking

Statuses: new, contacted, sample_sent, quoted, won, lost. Each saved change records the actor, note, status and follow-up date in history. UI times are Asia/Bangkok. Closing a lead clears the follow-up date. Concurrent changes are rejected instead of silently overwriting someone else's edits. Search supports name, company and phone; filters include status and overdue follow-ups.

## Notifications and monitoring

- LINE still requires nonempty `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_TO` belonging to Verdeloop. Merely having environment variable names is insufficient.
- Each lead has a stable LINE retry UUID, a short processing lease, and at most five automatic attempts. Confirmed sends set `notified_at`. LINE's 409 response counts as accepted only if it includes `x-line-accepted-request-id`.
- Requests older than 23 hours after their first attempt are held for review to avoid duplicates after LINE's 24-hour idempotency window. The admin can explicitly confirm nonreceipt and start a new attempt with a new UUID.
- `/api/maintenance` requires `Authorization: Bearer <CRON_SECRET>`. Vercel cron invokes it daily during 06:00–07:00 Bangkok time. The admin can run it manually. Processes up to five pending leads per run, then performs backup and retention cleanup. Larger queues require more manual runs or a more frequent scheduler on a suitable plan.
- An operations alert uses the configured LINE recipient, throttled to once per six hours. Without LINE credentials it cannot notify externally; the dashboard still displays status.
- `/api/health` is a public, read-only readiness endpoint returning 200/503 without private details. An independent uptime service can poll it. The Vercel-hosted daily job cannot detect a total Vercel outage while Vercel itself is down.

## Backups and recovery

- Daily AES-256-GCM encrypted application snapshots are stored in the private `verdeloop-backups` Blob store in Singapore, independently of Neon. Snapshots include leads, sales history, contact events, uploaded document metadata and PDF contents. Operational counters/secrets are not included.
- Snapshots are downloaded and decrypted after writing, then compared with the source. Retention is 30 days. Capacity guards fail visibly rather than silently truncating data: 20,000 leads, 200,000 history entries/events each, 100 documents and 20 MB of document contents. Review scaling before reaching these limits.
- `BACKUP_ENCRYPTION_KEY` must remain a 32-byte base64 key. Keep the separate recovery copy safe. Rotating/deleting it makes old snapshots unreadable unless the old key is preserved.
- The admin can download an encrypted snapshot. Actual Blob storage/operation usage may incur provider charges beyond the account's included allowance; no paid plan upgrade was performed.
- This is application data recovery, not a full Postgres cluster dump. Infrastructure, secrets and schema are restored separately from the project and migration files. Neon point-in-time recovery retention was not independently verified; these Blob snapshots provide the tested recovery path.

Recovery procedure (isolated EMPTY database first):

1. Download an encrypted snapshot; retain the associated recovery key.
2. Set target `DATABASE_URL` / `DATABASE_URL_UNPOOLED`, then run `node scripts/db-init.mjs` and `node scripts/migrate.mjs` with the target environment loaded.
3. Set `RESTORE_DATABASE_URL` to the empty destination, `BACKUP_ENCRYPTION_KEY` to the correct recovery key, and `BLOB_READ_WRITE_TOKEN` to the destination private store if documents are included.
4. Run `node scripts/restore.mjs /path/to/snapshot.json.enc --confirm-empty-target` with that environment loaded. It refuses a nonempty destination. Document PDFs are restored to the destination Blob store, and data is restored transactionally with sequences reset.
5. Verify counts, samples, follow-ups, document downloads, and deletion requests before switching the application's database environment and redeploying. Restored pending notifications require review before enabling cron.

## Procurement documents

`/documents/` serves four generated specification PDFs. They are product information, not third-party certifications. The owner has chosen to provide original certificates directly through LINE @verdeloop on request; publishing certificate files on the website is not an outstanding task. Admin uploads accept PDF files up to 3 MB; uploads are explicitly published to the public document list. Files remain in private Blob storage and are served only when their public document record exists. Removing a document removes its public listing/download access.

Regenerate specification PDFs after product changes:

1. `npm run build` and serve `dist` locally.
2. `node scripts/make-spec-pdfs.mjs http://127.0.0.1:PORT public/downloads 1440`
3. Inspect all four PDFs, rebuild and deploy.

## Abuse controls

- Shared database rate limits: 5 lead attempts / 10 minutes, 120 events / 10 minutes, 10 login attempts / 15 minutes per hashed network address.
- Hashes use `RATE_LIMIT_SECRET` (admin secret only as fallback); raw IPs are not stored in limiter tables. Expired rows are cleaned by maintenance.
- Lead form storage has a unique submission UUID. Network retries and double submission do not create duplicate lead records. Honeypot submissions require valid input/consent and are flagged as spam without LINE delivery.
- If the database limiter is unavailable, form submission fails with a retry/contact message rather than accepting unbounded traffic. SQL failures during storage after limiting can still fall back to LINE.

## Validation

- Auth unit tests: `node --test tests/admin-auth.test.mjs`.
- Operations integration tests: run `tests/operations.test.mjs` with an isolated database whose name includes `_test_`. Tests reset ONLY that test database and mock LINE. Real private PDF upload/read/delete is exercised using its Blob token.
- Production customer data is never used for destructive integration tests.

### Production verification — 2026-09-10

- Deployment `dpl_4HdM34vPj1pDXEftGabsvP4TFDvB` is aliased to `verdeloopthailand.com`.
- All 5 authentication tests and 9 operations integration tests passed. Browser checks covered consent, form submission and the admin at desktop/mobile widths.
- Recovery into an empty isolated database matched the original rows, exact timestamps and uploaded PDF bytes. Temporary PDF content was removed afterward.
- Live readiness, protected maintenance access, admin login, document listing and measurement script checks passed. Mobile document/form pages at 390 px had no horizontal overflow or broken images.
- Live maintenance at 02:35 UTC successfully verified an encrypted backup containing the existing single test lead. Overall maintenance status remains degraded because LINE credentials are empty; that lead is still pending notification. No successful LINE delivery is claimed.
- Google Ads conversion IDs still require owner-provided configuration. Original certificates are supplied through LINE on request, as requested by the owner.

### GA4 activation — 2026-09-10

- Production `PUBLIC_GA4_ID` is `G-TCH65KX10K`, deployed in `dpl_AQBmD6haHphgpHjLBtmEfyG9yGbg`.
- A fresh live browser made no Google measurement requests before consent or after refusal. After acceptance, the Google tag loaded successfully, and `page_view` and `phone_click` requests targeted this ID. Google's collection endpoint returned a successful response.
- This verifies browser delivery, not access to the owner's GA4 reports. Google Ads and LINE configuration remain pending.

### Google Ads conversion activation — 2026-09-11

- Production destination: `AW-18443678211/LPgvCM6l0PMcEIPk0NpE` (ส่งฟอร์มสำเร็จ Verdeloop). The owner supplied the event snippet; value is a nominal THB 1 per lead, not sales revenue.
- The event runs only after a successful, nonduplicate form response and measurement consent. A submission UUID is sent as `transaction_id`; no contact fields are included. Navigation waits for the Google callback with an independent 2-second fallback. Tracking failure cannot mark an accepted lead as failed.
- Nine client-flow tests pass via `node --test tests/measurement.test.mjs`, covering acknowledgement, callback/fallback, consent, duplicate response, failed submissions and direct thank-you navigation.
- Account-side follow-up: set the old URL-based `/thank-you` conversion to Secondary and keep the new successful-form conversion Primary with Count = One. These account settings cannot be verified from deployed website code. Google Ads tag diagnostics must be checked in the owner's account; use Tag Assistant after accepting measurement on the site.
