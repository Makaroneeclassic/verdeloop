# Article Studio

Entry point: `/admin?view=writer` (owner/admin only). Creates private drafts and publishes reviewed snapshots to `/articles/<slug>/`. Generated content is never published automatically.

## Setup

1. Open OpenRouter/logo settings in Article Studio.
2. Paste an OpenRouter key, load the model catalog, and select a text and an image model. Save, then test the connection. Keys are never returned to the browser after saving.
3. The default brand mark follows the Verdeloop website wordmark. Upload PNG/JPG/WebP to replace it. Every new image is rasterized and composited with the saved logo before storage, preview or download. Existing images keep the logo they were created with.
4. Set the shared daily generation limit (default 20 requests). One image or one article is one request. OpenRouter charges vary by model; manage monetary credit limits in the OpenRouter account as well.

## Writing

Create a draft, enter a keyword/related keywords/outline/facts/template, then generate. The AI result is a proposal stored in job history; using it in the editor requires a separate click. Save the editor to create a revision. Cover and inline images are generated separately. Inline images can be appended to the article; the newest cover is used in draft preview. Images have a download action with the logo permanently embedded.

The prompt structure adapts the owner's Smart Bot Writer Google Docs extension. Extension APIs and browser-stored credentials are not reused. The original extension folder is unchanged. No simulated SERP analysis is presented as actual search results.

## Persistence and deployment

- Apply `migrations/004-writer.sql` before deploying this release. It adds tables only and is idempotent; it does not seed, delete or overwrite articles.
- Text, briefs, revisions and generation results live in Postgres. Images live in private Vercel Blob storage and are served through authenticated admin requests.
- API key and optional custom logo are encrypted in `integration_settings` using the existing backup encryption key. Keep that key backed up separately.
- Updating GitHub or deploying code does not recreate article content. Preview environments must use isolated database/storage credentials; production credentials should never be copied into a public preview.
- Backup schema version 5 includes drafts, publication snapshots, revisions, job history, image metadata and image bytes. The restore script accepts versions 2/3/4/5 into an empty, fully migrated database. Article image snapshots are capped at 50 MB; larger libraries need a separate incremental media backup before raising this threshold. A failure is surfaced by the existing maintenance checks rather than silently skipping images.

## API and operational boundaries

- OpenRouter text: `POST /api/v1/chat/completions`.
- OpenRouter images: `POST /api/v1/images`; discovery uses `/models` and `/images/models`.
- Generated HTML is sanitized on receipt and every save. Provider response errors never echo raw keys or provider response bodies.
- Jobs use unique request IDs, a shared one-running-job lock, request rate limiting and a daily cap. A browser/network retry with the same job ID reads its existing result instead of generating again. Check job history after timeouts; providers may still charge for a timed-out generation.
- The server adds branding using Sharp; vector image output from an AI model is rejected. Choose a raster image model.
- `/admin` has a 180-second function limit and provider calls time out at 135 seconds. No generation runs on page load.

## Verification

`node --test tests/writer.test.mjs tests/admin-auth.test.mjs tests/measurement.test.mjs`

`tests/writer-db.test.mjs` requires an explicitly isolated `WRITER_TEST_SCHEMA` named `writer_test_<timestamp>` and a separate test encryption key. It covers encrypted key storage, roles, conflict detection, revisions, idempotent generation and preservation of manually written content. Provider calls in tests are mocked; a real end-to-end generation requires the owner's OpenRouter key and credits.

## Keyword intent and SERP Spy

- Editorial mode is the default: no product pitch, product links or forced straw imagery. The optional relevant-product mode permits a short mention only when it helps the keyword intent.
- SERP Spy uses OpenRouter's `openrouter:web_search` tool (Exa, at most one search and five results per request). It is web research, not a Google rank/PAA/volume report. Only provider citation annotations become source links; a response without those citations is rejected.
- Research is saved as an article-kind job with `result.type = research`, sharing existing permissions, quota, backup and idempotency. No migration is required. Article generation uses the latest successful research matching the draft's exact keyword. Applying its intent/outline is an explicit editor action.
- Search and model calls consume OpenRouter credits. No research runs automatically on page load or every generation.
- Reference: https://openrouter.ai/docs/guides/features/server-tools/web-search
- Regression checks: `node --test tests/writer-intent.test.mjs tests/writer-settings.test.mjs tests/writer.test.mjs`.


## Publishing

Apply migrations through `005-publications.sql` before deployment. In the editor, apply the AI candidate if desired, fill title and SEO description, choose a keyword slug and optional cover, then click Publish. Publishing saves the draft and validates its version before creating a separate snapshot. Later draft edits stay private until Update is clicked. Slugs are immutable after first publication to preserve links. Unpublish hides both the page and its exclusively referenced public images; drafts and private originals remain.

Public pages are rendered at request time from Neon, using the same Astro header, footer, styles and consent-aware measurement shell. A postbuild script creates the function's shell and removes its temporary static route. No database content is written to GitHub or the build output. The dynamic `/articles/sitemap.xml` is linked from the main sitemap index. Private image IDs are exposed only when listed in a live publication snapshot. Backup/restore includes publication snapshots.

Validation: `tests/publications.test.mjs` covers slugs, content/media safety and escaping; with an isolated `PUBLICATION_TEST_SCHEMA=publication_test_<timestamp>`, it also verifies publish, update, stale version rejection, slug collision, snapshot isolation and unpublish/media access. Browser smoke tests use isolated data, not automatic publication of customer drafts.

## Cover art direction

Covers use GPT Image 2 with a Thai editorial graphic layout: large headline, optional subtitle and up to three topic labels, subject image on the right, Verdeloop forest/cream palette. Cover copy is stored in `brief.coverTitle`, `coverSubtitle`, `coverHighlights`; inputs outside the brief section explicitly belong to `writer-brief`. Cover headline defaults to the keyword. The real logo is composited in a reserved top-left area. Inline images stay photographic and retain a bottom-right logo. Proofread generated text before publication. Existing image files are not regenerated by deployments.
