# The Left Bank — Notion → website events feed

Replaces the page-load Notion fetch on /upcoming with a pre-built static feed.
Notion stays the source of truth; the website reads a cached copy that rebuilds
four times a day. If Notion is slow or down, the site serves the last good build.

## How it works

```
Notion Events DB ──(GitHub Action, 4x daily)──> events.json + events.html + schema.json
                                                      │
                                            GitHub Pages (free CDN)
                                                      │
                              Squarespace code block fetches events.json
                              and injects Event JSON-LD for Google
```

What the build respects (matches the database's own field descriptions):

- Only **Confirmed** or **Published** rows, today onwards (Europe/London)
- **Date TBA** rows render last as "date to be announced"
- **Featured**: soonest flagged event gets the accent frame; blurb and ticket
  link show only on the featured event
- **Entry** blank = free; "ticketed" tag shown otherwise
- **Web Meta** appears after the slot ("all vinyl, jazz")

## Setup (one-off, ~20 minutes)

1. **Notion integration**
   - notion.so/my-integrations → New integration → name it "LB website feed",
     capabilities: *Read content* only.
   - Copy the secret. On the 🎫 Events Calendar page: ••• → Connections → add
     the integration.

2. **GitHub repo**
   - New private repo, e.g. `leftbank-events`. Add these three files
     (`build.js`, `.github/workflows/build-events.yml`, this README).
   - Settings → Secrets and variables → Actions → add:
     - `NOTION_TOKEN` — the integration secret
     - `NOTION_DATABASE_ID` — `a503e211-c0f2-49a3-ab6c-3fe33a747ce0`
   - Settings → Pages → Source: **GitHub Actions**.
   - Actions tab → "Build events feed" → Run workflow. First run publishes to
     `https://YOURUSER.github.io/leftbank-events/events.json` — open it and
     check the September nights are there.

3. **Squarespace**
   - Edit /upcoming → replace the current Notion-fetch code block with
     `squarespace-embed.html`, changing `FEED_BASE` to your Pages URL.
   - Keep the existing evergreen residencies copy above the block — the embed
     only adds the dated list below it, and if the feed is ever unreachable
     the page still reads correctly.

4. **Retire the old client-side Notion call** — and if the old code contained
   a Notion token, revoke that integration in Notion afterwards, since it has
   been visible in the page source.

## Verify

- Search Console → URL inspection → /upcoming → Test live URL → rendered HTML
  contains the dated events.
- search.google.com/test/rich-results on /upcoming → Event items detected.

## Notes

- The `Web /events` checkbox in Notion is a manual tracking field; this build
  doesn't write back to Notion (read-only token). If you later want it
  auto-ticked, grant update capability and it's a five-line addition.
- The cron (05:00, 11:00, 17:00, 23:00 UTC) means a night added in the
  afternoon is live the same evening. For instant publishes, use the manual
  "Run workflow" button.
- The same events.json is a clean feed for Rockhub, GBP post automation, or
  Instagram templates later — one source, many surfaces.
