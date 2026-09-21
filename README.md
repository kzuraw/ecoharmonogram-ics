# EcoHarmonogram ICS

A self-hosted Cloudflare Worker that converts one EcoHarmonogram address schedule
into an Apple Calendar subscription.

The Worker refreshes the complete calendar every day at 03:17 UTC, stores the
last valid ICS snapshot in Workers KV, and serves it through a secret URL. The
first valid subscription request initializes KV lazily, so the calendar works
immediately after deployment.

## Calendar behavior

- One all-day event per collection date, titled `Odbiór odpadów`.
- Waste collected on the same date is merged into one Polish-language list.
- Official category instructions and schedule footer text are included.
- Entries not marked as collection-visible by EcoHarmonogram are excluded.
- Every event alerts at 15:00 on the previous day.
- Stable UIDs let Apple Calendar reconcile additions, edits, and removals.
- Events are transparent and do not mark the day as busy.
- The feed is rebuilt from the authoritative upstream schedule; it does not
  maintain a separate historical archive.

If a refresh fails, the existing KV snapshot remains untouched. The failure is
written to Cloudflare logs and the next daily cron retries it.
If the upstream schedule is unchanged, the Worker also preserves the existing
snapshot, ETag, and event timestamps instead of making Apple reprocess events.

## Requirements

- Node.js 24 LTS
- pnpm 12.4.2
- A Cloudflare account with Workers and Workers KV

## Local development

Install dependencies and create a local configuration:

```sh
pnpm install
cp .dev.vars.example .dev.vars
```

Replace every placeholder in `.dev.vars`. The token should be a long random
value, for example one generated with `openssl rand -hex 32`. The real address
and token stay in this gitignored file.

Start the local Worker:

```sh
pnpm dev
```

Open the subscription path using the token from `.dev.vars`:

```text
http://localhost:8787/calendar/<CALENDAR_TOKEN>.ics
```

Trigger the scheduled handler locally when the development server is running:

```sh
curl "http://localhost:8787/cdn-cgi/local/scheduled?cron=17+3+*+*+*&format=json"
```

## Verification

```sh
pnpm lint
pnpm test
```

The first command runs formatting checks and strict TypeScript type-checking.
The second runs tests inside Cloudflare's Workers runtime. Tests use synthetic
address fixtures and never call the live EcoHarmonogram API.

## Deployment

The repository does not deploy automatically. Complete these steps manually
after reviewing a local calendar.

1. Authenticate Wrangler:

   ```sh
   pnpm wrangler login
   ```

2. The production `CALENDAR_KV` namespace is already configured in
   `wrangler.jsonc`. For a different Cloudflare account, create a namespace and
   replace its ID before deploying.

3. Add each production value as an encrypted Worker secret. Wrangler prompts
   for each value, so it does not need to appear in shell history:

   ```sh
   pnpm wrangler secret put CALENDAR_TOKEN
   pnpm wrangler secret put ECO_TOWN
   pnpm wrangler secret put ECO_DISTRICT
   pnpm wrangler secret put ECO_STREET
   pnpm wrangler secret put ECO_HOUSE_NUMBER
   pnpm wrangler secret put ECO_STREET_SIDE
   ```

4. Verify and deploy:

   ```sh
   pnpm lint
   pnpm test
   pnpm deploy
   ```

5. Make one request to initialize KV:

   ```text
   https://<worker-host>/calendar/<CALENDAR_TOKEN>.ics
   ```

## Apple Calendar subscription

In Calendar on macOS, choose **File → New Calendar Subscription**, paste the
HTTPS subscription URL, and set the desired auto-refresh interval. Ensure
**Ignore alerts** is disabled; otherwise Apple Calendar can suppress the alarm
embedded in each event.

Treat the full subscription URL as a password. Anyone who obtains it can read
the calendar. Rotate access by changing `CALENDAR_TOKEN`; old paths then return 404.

## HTTP behavior

Only `GET` and `HEAD` requests to the exact tokenized path are accepted. Other
paths return 404 without revealing whether the Worker hosts a calendar. The
response supports `ETag` revalidation and reports snapshot freshness through
`Last-Modified`, `X-Calendar-Last-Updated`, and `X-Calendar-Event-Count` headers.

## Acknowledgements

The upstream API protocol implementation was developed with reference to the
[EcoHarmonogram Home Assistant integration](https://github.com/mampfes/hacs_waste_collection_schedule/blob/master/custom_components/waste_collection_schedule/waste_collection_schedule/service/EcoHarmonogramPL.py).
See [Third-party notices](THIRD_PARTY_NOTICES.md) for attribution and license
details.

This is an unofficial project. It is not affiliated with or endorsed by
EcoHarmonogram or WebSolution. The upstream API is undocumented and may change
without notice.

## License

This project is available under the [MIT License](LICENSE).
