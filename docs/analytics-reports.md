# Analytics reports: blog and campaign events

Example Analytics Engine queries for the official blog and the share campaign. The event
catalogue and the privacy reasoning live in [architecture.zh-Hant.md](architecture.zh-Hant.md)
(Traditional Chinese); the write format is defined by `src/analytics.ts`.

Numbers that come from D1 (attribution, retention, spend) are not in Analytics Engine. Read
them on the staff dashboard at `/review/campaign/stats`.

## Data point layout

Dataset: `hearthroom_events` (the `EVENTS` binding in `wrangler.toml`). One data point per event.

| Column | Holds |
|---|---|
| `index1` | event name (same value as `blob1`; Analytics Engine samples per index, so rare events are not drowned by frequent ones) |
| `blob1` | event |
| `blob2` | surface the event was fired from (`from`): `blog`, `campaign`, `board`, `card`, ... else `direct` |
| `blob3` | route template (set for server events; empty for the blog and campaign beacons) |
| `blob4` | UI locale (for example `zh-Hant`), not the locale of the post |
| `blob6` | country |
| `blob7` | external referrer host (HTML loads only, so empty for beacon events) |
| `blob11` | subject: blog post slug or campaign slug for the events below |
| `blob12` | outcome: `ok` or `error` |
| `blob14` | detail: for `blog_share`, one of `share_web`, `share_clipboard`, `share_abort` |
| `blob15` | client: `server`, `beacon` or `bot` |
| `double1..4` | duration ms, result count, offset, HTTP status (all 0 for beacon events) |

The blog and campaign events are beacon events (`POST /v1/e`): they are fired by the browser,
so `blob15` is `beacon`, or `bot` if the user agent looks like a crawler. Beacon numbers can be
forged by anyone, so use them for trends and comparisons, not for billing or ranking.

| Event | Fired when | `subject` |
|---|---|---|
| `blog_view` | a post page loads (not in preview) | post slug |
| `blog_read_end` | the end of the post scrolls into view, once per page load | post slug |
| `blog_cta` | the campaign block inside a post is clicked | post slug |
| `blog_share` | share button used; `detail` says how | post slug |
| `campaign_view` | campaign page loads, once per slug per page session | campaign slug |
| `campaign_apply` | apply action on the campaign page | campaign slug |
| `campaign_share` | a share link is copied | campaign slug |

`blog_share` with `detail = 'share_abort'` is a dismissed share sheet, not a share. The
queries below leave it out.

## Counting rule

Always `SUM(_sample_interval)`, never `COUNT(*)`. Analytics Engine samples under high
volume and `_sample_interval` is the number of real events each stored row stands for; summing
it is the documented way to get an estimate. See the Cloudflare docs on
[querying sampled data](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/). Today the two are equal, but `COUNT(*)` would silently go wrong once
sampling starts.

## 1. Per blog post

Views, read-to-end, campaign block clicks and shares per post over 7 days:

```sql
SELECT blob11 AS post,
       SUM(IF(blob1 = 'blog_view', _sample_interval, 0))     AS views,
       SUM(IF(blob1 = 'blog_read_end', _sample_interval, 0)) AS read_end,
       SUM(IF(blob1 = 'blog_cta', _sample_interval, 0))      AS cta,
       SUM(IF(blob1 = 'blog_share' AND blob14 != 'share_abort', _sample_interval, 0)) AS shares
FROM hearthroom_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob1 IN ('blog_view', 'blog_read_end', 'blog_cta', 'blog_share')
  AND blob15 != 'bot'
GROUP BY post
ORDER BY views DESC
FORMAT JSON
```

Change `'7'` to the number of days you want. `read_end / views` is a trend indicator, not an
exact completion rate: the numerator and denominator are independent beacons.

Caveat: `(column_id, slug)` is unique in D1, not `slug` alone, and events carry only the
slug. Two posts with the same slug in different columns are counted together. Keep slugs
unique across columns if you rely on these numbers.

## 2. Per blog column

Events do not carry the column, so Analytics Engine cannot group by column. Run query 1,
then join its result with D1 post metadata outside the query (a script or a spreadsheet),
and sum per `column_slug`.

D1 query for the slug-to-column mapping:

```sql
SELECT p.slug AS post, c.slug AS column_slug
FROM blog_posts p
JOIN blog_columns c ON c.id = p.column_id
WHERE p.status IN ('published', 'unpublished');
```

Drop the `WHERE` to include drafts. The two result sets are only joinable on the slug, which
is why the slug caveat in section 1 matters here too.

## 3. Per campaign

```sql
SELECT blob11 AS campaign,
       SUM(IF(blob1 = 'campaign_view', _sample_interval, 0))  AS views,
       SUM(IF(blob1 = 'campaign_apply', _sample_interval, 0)) AS applies,
       SUM(IF(blob1 = 'campaign_share', _sample_interval, 0)) AS shares
FROM hearthroom_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob1 IN ('campaign_view', 'campaign_apply', 'campaign_share')
  AND blob15 != 'bot'
GROUP BY campaign
ORDER BY views DESC
FORMAT JSON
```

`campaign_apply` counts clicks of the apply action, not accepted applications. Accepted
applications, attribution and spend are D1 numbers: use `/review/campaign/stats`.

## 4. Surface breakdown for campaign and blog traffic

`blob2` is the page the browser was on when the event fired (set by the router), not an
external referrer. What happens while people are on the blog and campaign pages:

```sql
SELECT blob2 AS surface, blob1 AS event,
       SUM(_sample_interval) AS n
FROM hearthroom_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob2 IN ('blog', 'campaign')
  AND blob15 != 'bot'
GROUP BY surface, event
ORDER BY surface, n DESC
FORMAT JSON
```

Server events (`blob15 = 'server'`) are included: for them `blob2` is the page that made the
API call, which is how blog and campaign page loads show up as API traffic. To restrict the
result to the named blog and campaign events, add the `blob1 IN (...)` lists from sections 1
and 3.

Where blog and campaign events came from, by country and UI language:

```sql
SELECT blob6 AS country, blob4 AS locale, SUM(_sample_interval) AS views
FROM hearthroom_events
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob1 IN ('blog_view', 'campaign_view')
  AND blob15 != 'bot'
GROUP BY country, locale
ORDER BY views DESC
LIMIT 50
FORMAT JSON
```

External referrers (`blob7`) are recorded only on HTML loads, which beacon events are not, so
this dataset cannot say which external site sent a blog reader. Use Cloudflare Web Analytics
for that.

## Running the queries

Use the account-level Analytics Engine SQL API:

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --data-binary @query.sql
```

The token needs the Account Analytics Read permission. Keep the token and the account id in
your shell or secret store; they never go into this repository. Dataset tables are queried by
name (`hearthroom_events`); `timestamp` is the write time.

## Privacy boundary

Events carry slugs only. Post and campaign slugs are public; the beacon endpoint never
receives member ids, content ids or free text, and `subject` is restricted to
`[A-Za-z0-9_-]` and 64 characters. Do not add a member id, account id or email to these events
or to a query's `GROUP BY`. Anything that needs a person (attribution, retention, spend) is
computed from D1 on the staff dashboard `/review/campaign/stats`.
