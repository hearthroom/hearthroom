# Official blog language versions

Each post has one content language and belongs to one translation group. Create a
translation from **Language versions → Start translating**, or link a standalone post
using **Linked post** in its editor. Choose the matching article in the same column;
the confirmation lists its languages and publication states. The first save creates a
draft. Translation and publication are manual, and each version is published separately.
An existing language slot opens that version, including drafts and withdrawn versions.

Slugs can be chosen independently. Language suffixes have no grouping or filtering
meaning. Once a version has been publicly available, its language, column and slug are
fixed even after withdrawal. Linking or detaching does not change its URL, content,
comments, views, likes, images, campaign or revisions. An original with translations
cannot be detached; a translation can become a standalone post. Restoring content does
not restore an old language association.

Lists, pins, recommendations and Atom feeds select one published version per group in
the reader's UI language. Traditional and Simplified Chinese can substitute for one
another. English, Japanese and Korean lists omit groups without their own version.
Article links preserve the exact public version; a withdrawn formerly public link can
show another available version, with its language stated. Never-public drafts are not
fallback entry points. Article language options link the actual versions; sharing uses
the displayed version's canonical URL.

Pins remain per version. Any currently public pinned version makes the group pinned;
list limits and homepage freshness apply to distinct groups and their earliest first
publication date. A new translation does not renew an old article's homepage window.

The official writer HTTP API uses the existing application owner/admin authorization:
`POST /v1/blog/admin/posts` accepts optional `translationOfPostId` and
`expectedTranslationGroupVersion`; `PUT /v1/blog/admin/posts/:id/translation` accepts
`expectedVersion`, `expectedGroupVersion`, `targetPostId` and (when attaching)
`expectedTargetGroupVersion`. A null target creates a standalone group. Both mutations
require `operationId`; retries of the same operation must retain it. Group search is
`GET /v1/blog/admin/translation-groups` with `page`, `query`, `column`, `group`, `status`
and `missingLocale`. Public post IDs still identify individual versions. These official
writing permissions are not exposed by the public card-author MCP or CLI.
