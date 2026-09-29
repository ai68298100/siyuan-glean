# Lv Glean (小驴拾遗)

> **Glean your clippings before they gather dust.**

Lv Glean manages articles already saved in SiYuan. It turns clippings into a reading library where each item can be confirmed, triaged, read, and reviewed. It is not an RSS reader and does not crawl pages for you. Ordinary notes do not enter the library just because they sit in a selected notebook, and opening a document is not treated as finishing it.

The shortest loop is: **find source evidence → preview candidates → confirm → triage → start reading → explicitly mark done → review later**. Article state lives on document attributes and survives plugin removal.

[中文说明](README.md)

## What problem it solves

The official SiYuan Web Clipper is convenient, but the source URL and time are often template text in the document body. Search, databases, and queries cannot manage those clippings as articles. Lv Glean adds a `custom-clip-*` document-attribute schema and a rebuildable index for reading views.

The scan range only says where to look. A document becomes a candidate only when it has source evidence such as a valid URL, an exact `#剪藏` tag, or an official clipper source line. Candidates show why they were found and what is missing. Articles enter the five-state library only after the user confirms an individual candidate or the migration report.

## Current capabilities

### Capture, migration, and library

- **Five states**: inbox, later, reading, done, and archived.
- **One capture rule**: candidate review, the editor context menu, the command palette, the SiYuan inbox, and external imports use the same attribute-writing path.
- **Preview-first migration**: a dry-run report comes before batched backfill. Progress can be saved, paused, and resumed; existing URL, status, priority, and rating values are protected.
- **Candidate decisions**: add or correct a source URL, explicitly capture as a local document, or exclude a false positive. Candidates do not count toward the inbox, resurfacing, or reading statistics.
- **Content carriers**: panel cards label full-text clippings, link-only items, and explicitly selected local documents. Unknown word count, duration, or time provenance stays unknown. A shared carrier badge and navigation policy is in place: full-text opens the SiYuan document first, link-only items open a valid source URL, and local/unknown items show no web action. Mobile acceptance remains in B-0002.
- **Reading views**: Dock, Workbench, and Kanban use the same document-attribute state. Title/site/user-tag/source/time-provenance/carrier filters, sorting, batch status changes, snapshots, and index rebuild are available. Visual consistency across canvases and mobile actions remain under B-0002.

### Reading and resurfacing

- **Start reading** sets `reading` and opens the document or source according to its carrier. Full-text clippings also show a low-distraction context beside the native editor with title, carrier, source, status, and actions. A link-only item without a source URL is clearly reported rather than presented as opened.
- **Mark as done** is the only action that sets `done`; the optional check-in bridge also fires on this explicit action.
- **Today's gleaning** selects a small set from unfinished items with a factual "why it appeared" note (idle days, your priority, source, an unread topic). Start reading, Skip for today, and Archive are idempotent and only change that day's display; picks project from the reconciled index.
- **Queue and stale-item hints** show when the inbox is over quota; stale items expand into a checklist first, and only the checked ones are archived, with the real success count reported.

### Optional AI and integrations

- **AI enrichment** can be manual or explicitly enabled for automatic use: one-line summaries, AI tags, and semantic similarity hints. The default mode is manual and does not spend tokens automatically. AI tags are separate from user tags.
- **Reading assistance** exposes SiYuan AI actions for summaries, key points, and counterarguments. Related articles, translation, cost hints, and failure behavior remain under the T-1718 acceptance work.
- **Stats and reports** include article, word, site, and tag statistics plus Markdown weekly reports. "Done this week" counts only articles with a trusted completion time (explicit mark-done or a read time from the import file); legacy entries without one are never fabricated. Resurface and stale-archive now project from a reconciled index (T-1710).
- **Optional integrations** have code entry points for an attribute-view library, the SiYuan inbox, Pocket/Omnivore/wallabag imports, HTML snapshots of clipped documents, quote cards, agent tools, and the Lv Checkin bridge. Real exports, devices, and external-service checks are tracked in [docs/BLOCKERS.md](docs/BLOCKERS.md).

## First run

1. Install and enable the plugin. In Settings, select one or more clipping notebooks as **library notebooks**. Existing `#剪藏` documents can also be discovered as candidates.
2. Open the library panel → **Organize clippings** → **Show report first (no writes)**.
3. Review each candidate: add a valid source URL, choose Capture as local document, or exclude a false positive. Ordinary notes without evidence are never bulk-captured.
4. Confirm the report and start batched backfill. Known URL, content type, word count, and time provenance are written to attributes; unknown fields remain visibly unknown.
5. Triage items into Read later, Start reading, or Archive. After finishing, explicitly choose **Mark as done**.

New items can also be confirmed from the candidate cards or added from the document context menu. External imports usually contain only a source URL, and the UI distinguishes them from full-text clippings.

## Data, privacy, and boundaries

- Document attributes are the source of truth for article state and metadata. Plugin `saveData` holds derived indexes, migration progress, preferences, and AI usage/logs; none is the article-state source of truth.
- Existing user URL, status, priority, and rating values are protected. A status is overwritten only by an explicit user action.
- AI uses your configured SiYuan model by default, or an optional Glean-specific OpenAI-compatible channel. The plugin ships no API key and requires no account subscription. When the custom channel is enabled, article text is sent in prompts to the endpoint you provide; follow that service's privacy policy. AI failure does not block reading.
- The plugin does not provide RSS subscriptions, cloud accounts or sync, social collections, paywalls, or automatic reading. It now uses Folo/RSS-inspired unified timeline, carrier labels, and source guidance; switchable AI reading assistance is being verified item by item under T-1718. See [docs/RESEARCH-folo.md](docs/RESEARCH-folo.md).
- SiYuan **v3.8.5+** is supported by the manifest. Desktop, mobile, and browser flows are validated separately. Official-extension clipping, real AI, inbox, external imports, and device UI status are listed in [docs/BLOCKERS.md](docs/BLOCKERS.md).

Code entry points do not mean every platform path has passed acceptance. Full isolated E2E, author desktop review, mobile/browser smoke checks, and the release gate are tracked by T-1713; the README does not claim those checks are complete.

## The Lv plugin family

Four Lv (小驴) SiYuan plugins are currently developed:

- [小驴雷切 / Lv Quickcut](https://github.com/ai68298100/siyuan-quickcut): quick web clipping and processing
- [小驴打卡 / Lv Checkin](https://github.com/ai68298100/siyuan-checkin): reading and habit check-ins
- [小驴人脉 / Lv Contacts](https://github.com/ai68298100/siyuan-contacts): contact and relationship management
- **小驴拾遗 / Lv Glean**: clipping organization, reading triage, and daily resurfacing

## Community

QQ group for discussion: **871707735**

## Development

```bash
pnpm install
pnpm dev        # development build with live reload
pnpm check      # tsc + svelte-check
pnpm test       # unit tests + architecture gates
pnpm build      # production build → dist/ + package.zip
pnpm spike      # isolated kernel spike; never touches the real workspace
```

Project documents: [DATA-CONTRACT.md](docs/DATA-CONTRACT.md), [PRODUCT-REPLAN.md](docs/PRODUCT-REPLAN.md), [ROADMAP.md](docs/ROADMAP.md), and [DECISIONS.md](docs/DECISIONS.md).

## License

[MIT](LICENSE)
