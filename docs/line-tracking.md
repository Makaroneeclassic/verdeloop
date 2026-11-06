# LINE buttons and verified friend conversions

Buttons: homepage/landing hero, product hero, beside request form, footer, article end. Sales pages have a desktop floating LINE button and a mobile two-button bar; no duplicate landing bar. Hidden while consent UI is open, and mobile bar hides while the form is visible/focused. All outbound LINE entry links open a new tab.

`/line/` is a noindex bridge. With no measurement consent, or LINE Login disabled, it opens the ordinary @verdeloop URL. JavaScript/network errors leave a direct LINE link available. An ordinary click never becomes an add-friend conversion.

## Configuration

Admin → **LINE — คลิกและเพิ่มเพื่อนจริง** (`/admin#line-tracking`):

1. Create a **LINE Login Web app** channel in the same Provider as the Messaging API channel for @verdeloop.
2. Basic settings → Linked LINE Official Account → @verdeloop.
3. Callback: `https://verdeloopthailand.com/api/line-login?callback=1`.
4. Enable Messaging API webhook and redelivery at the existing `/api/line-webhook`. Publish the Login channel when ready.
5. Save Login Channel ID/Secret in admin. Credentials are encrypted using existing integration storage. The Messaging API secret is a different credential.
6. Create distinct Google Ads **Website** conversion actions for clicks and verified friend adds. Count One. Use Secondary while testing. Paste each event snippet's `send_to` (`AW-…/label`). Never reuse the form conversion label, and do not additionally import the same GA4 event as a second conversion.
7. Enable Login only after linking the correct OA and configuring the callback. Test with an account not yet following the OA. Test returning/existing friends and unblock separately.

## Verification

Login uses random state bound to a Secure/HttpOnly/SameSite=Lax cookie, one-time SQL claim, 20-minute expiry, nonce and PKCE S256. The server exchanges the code, verifies the ID token with LINE, validates issuer/audience/nonce/expiry and fetches friendship status. Tokens are not saved. Identity is stored only as keyed HMAC, never forwarded to Google.

Signed webhook events are stored with unique event IDs. A conversion needs a verified Login user with `friend=true` AND a matching follow event during that flow explicitly reporting `follow.isUnblocked=false`. Missing flag, existing friend, unblock, unrelated follow, forged callback or replay do not count. Callback and webhook can arrive in either order. The callback's `friendship_status_changed` parameter is **not trusted** as proof. Unique user/session/event constraints prevent duplicates. LINE itself does not guarantee perfect classification of add vs unblock.

Google Ads browser conversion is emitted only on the verified return page with Ads consent both at start and return, and a configured friend label. GA4 emits `line_add_friend` with analytics consent. No LINE ID, name, message, email or phone is sent to Google. `transaction_id` is the conversion UUID. Clicks use a separate label and `line_click` GA4 event with button placement. Original source/click metadata is handed across same-origin tabs in a fragment (removed before navigation), consent-filtered and saved in the Login session.

The server can record verified friends even if its webhook arrives after the return page closes. **That does not mean Google Ads received a conversion.** This version sends Ads via the return browser, not an offline API upload. Closing the return page, browser changes, ad blockers, denied consent or no attributable ad click can mean fewer Ads conversions. Do not claim full cross-device attribution. The admin table reports verified website friends, not confirmed Ads delivery.

## Storage and maintenance

Migration `006-line-tracking.sql`: sessions, signed follow events, unique friend conversions and contact event placement. Daily maintenance cleans the data after at most 90 days; unsuccessful sessions after expiry plus one day. Encrypted backup v6 and restore include the three new tables. API/session records are not article content and do not change publications.

## Tests

For Tag Assistant, connect to `/line/?debug=1`. This opt-in diagnostic page stays open and waits for the explicit test button; it does not automatically redirect or initiate LINE Login. Enable advertising measurement through the existing consent settings before pressing the button. The button invokes the configured real click conversion, once per tab session, so use it only for intentional diagnostics. Check the Google Ads destination's **Hits Sent** to verify delivery; the on-page message confirms invocation, not Google receipt. Ordinary `/line/` navigation remains automatic.

`node --experimental-test-module-mocks --test tests/line-tracking.test.mjs tests/line-login.test.mjs tests/line-webhook.test.mjs tests/measurement.test.mjs`

The real SQL case runs only with `LINE_TEST_SCHEMA=line_test_<timestamp>` against an isolated schema containing migration 006 and contact_events. It tests event ordering, consent, existing friends/unblocks, unknown flags and deduplication. Never test by creating customer messages or submitting fake production leads.

References: [LINE Login add-friend flow](https://developers.line.biz/en/docs/line-login/link-a-bot/), [Messaging API follow event](https://developers.line.biz/en/reference/messaging-api/#follow-event).

## Logo asset

`public/img/line-brand.png` is the unmodified PNG from the official [LINE brand icon download](https://www.line.me/en/logo), downloaded from `https://www.line.me/static/logo/top/LINE_Brand_icon.zip`. Shared button styling retains readable contact text and renders the icon at 32px desktop / 40px mobile. Decorative image (`alt=""`) avoids repeating the button label to screen readers.
