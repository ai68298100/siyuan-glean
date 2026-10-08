# Lv Glean (小驴拾遗)

[![Quality gates](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml) [![CodeQL](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml) [![Latest release](https://img.shields.io/github/v/release/ai68298100/siyuan-glean?label=latest%20release)](https://github.com/ai68298100/siyuan-glean/releases/latest)

> **Glean your clippings before they gather dust.**

Lv Glean manages articles already saved in SiYuan. It turns clippings into a reading library where each item can be confirmed, triaged, read, and reviewed. It is not an RSS reader and does not crawl pages for you. Ordinary notes do not enter the library just because they sit in a selected notebook, and opening a document is not treated as finishing it.

The shortest loop is: **find source evidence → preview candidates → confirm → triage → start reading → explicitly mark done → review later**. Article state lives on document attributes and survives plugin removal.

[中文说明](README.md)

The [capability matrix](docs/CAPABILITY-MATRIX.md) records implementation, isolated verification, real-environment status, prerequisites, and fallbacks. The [terminology table](docs/TERMINOLOGY.md) keeps Chinese and English UI terms aligned.

## Project status and links

- Current public release: [`v1.1.0`](https://github.com/ai68298100/siyuan-glean/releases/latest), compatible with SiYuan `v3.8.5+`.
- Package: download `package.zip` from the [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest), then install it through SiYuan's marketplace or plugin manager; development branches are not stable releases.
- Core library code and isolated regressions are in place. Desktop host, Android/mobile, browser frontend, real-model, and external-service paths are tracked and accepted separately in the capability matrix; browser previews and unit tests are not treated as real-device acceptance.
- AI enrichment is manual by default and does not run automatically or spend tokens in the background. Individual AI actions require a configured model or channel; automatic enrichment must be enabled separately. The inbox bridge, external imports, snapshots, and cross-plugin bridges also have additional prerequisites.
- Quick links: [`latest Release`](https://github.com/ai68298100/siyuan-glean/releases/latest) · [`report a problem or suggestion`](https://github.com/ai68298100/siyuan-glean/issues/new/choose) · [`all Issues`](https://github.com/ai68298100/siyuan-glean/issues) · [capability matrix](docs/CAPABILITY-MATRIX.md)

If you only want to use the plugin, download `package.zip` from the Latest Release. If you are reporting a problem, first check that it reproduces in a real SiYuan host and include the SiYuan version, plugin version, and frontend type. `dev/**` and `codex/**` branches are for ongoing development and are not stable releases.

## What problem it solves

The official SiYuan Web Clipper is convenient, but the source URL and time are often template text in the document body. Search, databases, and queries cannot manage those clippings as articles. Lv Glean adds a `custom-clip-*` document-attribute schema and a rebuildable index for reading views.

The scan range only says where to look. A document becomes a candidate only when it has source evidence such as a valid URL, an exact `#剪藏` tag, or an official clipper source line. Candidates show why they were found and what is missing. Articles enter the five-state library only after the user confirms an individual candidate or the migration report.

## Current capabilities

Desktop workbench lists can preview articles and candidates in place without changing reading status. Check source evidence, confirm or exclude a candidate, correct its URL, change status, or quote a selection while staying in the list. Resize with the divider or arrow keys; the preview toggle controls list clicks. Narrow docks open the original document, while mobile uses a full-screen preview. Three common filters stay visible, more filters share a panel, and applied conditions can be removed individually. Less frequent row actions live under “More actions”. Real host and mobile verification remains in the [reader acceptance matrix](docs/READER-ACCEPTANCE.md).

### Capture, migration, and library

- **Five states**: inbox, later, reading, done, and archived.
- **One capture rule**: candidate review, the editor context menu, the command palette, the SiYuan inbox, and external imports use the same attribute-writing path; real service prerequisites for inbox and imports are listed in the capability matrix.
- **Preview-first migration**: a dry-run report comes before batched backfill. Progress can be saved, paused, and resumed; existing URL, status, priority, and rating values are protected.
- **Source authors**: manually edit an author, publication, or channel from row actions, article previews, and the reader sidebar. Existing names are protected, conflicts keep the draft, and clearing requires saving explicitly. Click an author for all five statuses; filters, saved views, and CSV include authors. Reviews offer site-to-author details and expandable Top8 distributions with missing authors counted separately. The official extension currently exposes no author template variable; [research](docs/CLIPPER-AUTHOR-RESEARCH.md) records the boundary. AI suggestions and real-library backfill remain pending.
- **Candidate decisions**: add or correct a source URL, explicitly capture as a local document, or exclude a false positive. Candidates do not count toward the inbox, resurfacing, or reading statistics.
- **Content carriers**: panel cards label full-text clippings, link-only items, and explicitly selected local documents. Unknown word count, duration, or time provenance stays unknown. A shared carrier badge and navigation policy is in place: full-text opens the SiYuan document first, link-only items open a valid source URL, and local/unknown items show no web action. Mobile acceptance remains in B-0002.
- **Reading views**: Dock, Workbench, and Kanban use the same document-attribute state. Title/site/user-tag/source/time-provenance/carrier filters, sorting, batch status changes, snapshots, and index rebuild are available. Snapshots require SiYuan export and asset writes; you can opt in to creating one after a successful capture, while failures keep the capture and allow a manual retry. Visual consistency across canvases and mobile actions remain under B-0002.

### Reading and resurfacing

- **Improve formatting**: the reading context and reader tab offer shorter visible URLs, fewer blank lines, optional promotional/image cleanup, and encoding warnings. Review the original alongside the preview and save a separate reading draft with source links. AI formatting is off by default and requires a configured channel and manual opt-in; it produces a layout plan using the shared daily quota. The current request sends article text only: it does not send image bytes or external image URLs, and image candidates are structural evidence rather than visual judgments. Real-host rendering and model quality still need acceptance; see [formatting notes](docs/FORMATTING.md).

- **Start reading** sets `reading` and opens the document or source according to its carrier. Full-text clippings also show a low-distraction context beside the native editor with title, carrier, source, status, and actions. A link-only item without a source URL is clearly reported rather than presented as opened.
- **Mark as done** is the only action that sets `done`; the optional check-in bridge requires user opt-in, Lv Checkin enabled, and a selected target. A bridge failure never blocks the done state.
- **Reader tab (experimental, off by default)**: when enabled in settings, Start reading opens the SiYuan editor embedded in a plugin tab — body on the left (read-only preview by default, explicit switch to edit, changes save straight to SiYuan) and a companion sidebar on the right with status actions, priority/rating, body diagnostics, source and snapshot. All data stays in the SiYuan kernel; the body is never copied.
- **Today's gleaning** selects a small set from unfinished items with a factual "why it appeared" note (idle days, your priority, source, an unread topic). Start reading, Skip for today, and Archive are idempotent and only change that day's display; picks project from the reconciled index.
- **Queue and stale-item hints** show when the inbox is over quota; stale items expand into a checklist first, and only the checked ones are archived, with the real success count reported.

### Optional AI and integrations

- **AI enrichment** can be manual or explicitly enabled for automatic use: one-line summaries, AI tags, and semantic similarity hints. The default mode is manual and does not spend tokens automatically. A configured SiYuan model or Glean-specific channel is required; missing models, quota limits, and call failures skip enrichment and leave a log. AI tags are separate from user tags.
- **Reading assistance** exposes SiYuan AI actions for summaries, key points, and counterarguments. Related articles, translation, cost hints, and failure behavior remain under the T-1718 acceptance work.
- **Library highlights**: switch between the current document and confirmed library articles; search quotes by text, site, user tag, or AI tag. Select, copy, export CSV, or review a Markdown draft with source-block links. Source changes or deletion block stale exports; see [highlight notes](docs/HIGHLIGHTS.md). Real-host interaction still needs acceptance.
- **Reading review**: week/month/year periods, a yearly completion heatmap, separate user/AI tag counts, CSV, and Markdown reports with preview and confirmation. Archived articles retain trusted completion facts; unknown dates stay separate and candidates are only a current snapshot. See [counting rules](docs/READING-REVIEW.md). Real-host rendering still needs acceptance.
- **External bridge v1** exposes confirmed article attributes to other plugins. Status writes are off by default and limited to the five reading states; old references expire on unload. See [bridge protocol](docs/BRIDGE.md). Real plugin integration still needs acceptance.
- **Optional integrations** have code entry points for an attribute-view library, the SiYuan inbox, Pocket/Omnivore/wallabag imports, HTML snapshots of clipped documents, quote cards, agent tools, and the Lv Checkin bridge. Prerequisites, isolated evidence, fallbacks, and real acceptance status are tracked in the [capability matrix](docs/CAPABILITY-MATRIX.md) and [docs/BLOCKERS.md](docs/BLOCKERS.md).

## First run

1. Install and enable the plugin. In Settings, select one or more clipping notebooks as **library notebooks**. Existing `#剪藏` documents can also be discovered as candidates.
2. Open the library panel → **Organize clippings** → **Show report first (no writes)**.
3. Review each candidate: add a valid source URL, choose Capture as local document, or exclude a false positive. Ordinary notes without evidence are never bulk-captured.
4. Confirm the report and start batched backfill. Known URL, content type, word count, and time provenance are written to attributes; unknown fields remain visibly unknown.
5. Triage items into Read later, Start reading, or Archive. After finishing, explicitly choose **Mark as done**.

New items can also be confirmed from the candidate cards or added from the document context menu. External imports usually contain only a source URL, and the UI distinguishes them from full-text clippings.

## FAQ

- **Which version should I install?** Prefer `package.zip` from the [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest). Development branches can include paths that still await host acceptance.
- **Why does a capability say “pending acceptance”?** Code and isolated tests do not prove that a flow works in the author's desktop, Android, real-model, or external-service environment. See the [capability matrix](docs/CAPABILITY-MATRIX.md) and [known blockers](docs/BLOCKERS.md).
- **Will uninstalling remove article state?** Article state is stored on document attributes; plugin `saveData` only stores indexes and settings. Uninstalling does not actively remove those document attributes. Read the [data contract](docs/DATA-CONTRACT.md) before migrations.

## Data, privacy, and boundaries

- Document attributes are the source of truth for article state and metadata. Plugin `saveData` holds derived indexes, migration progress, preferences, and AI usage/logs; none is the article-state source of truth.
- Existing user URL, status, priority, rating, and author values are protected from automatic writes. Explicit status and author edits may replace their respective fields.
- AI uses your configured SiYuan model by default, or an optional Glean-specific OpenAI-compatible channel. The plugin ships no API key and requires no account subscription. When the custom channel is enabled, article text is sent in prompts to the endpoint you provide; follow that service's privacy policy. Missing models, browser CORS limits, and AI failures skip enrichment, and reading remains available.
- AI formatting currently sends article text only. It does not read, download, or send image bytes or treat image URLs as visual input; visual image cleanup remains a separate capability that requires channel support, resource authorization, and real-model acceptance.
- The plugin does not provide RSS subscriptions, cloud accounts or sync, social collections, paywalls, or automatic reading. It now uses Folo/RSS-inspired unified timeline, carrier labels, and source guidance; switchable AI reading assistance is being verified item by item under T-1718. See [docs/RESEARCH-folo.md](docs/RESEARCH-folo.md).
- The manifest declares SiYuan **v3.8.5+**, but desktop, mobile, and browser UI still require separate real-environment acceptance. Official-extension clipping, real AI, inbox, external imports, and device UI status are listed in the [capability matrix](docs/CAPABILITY-MATRIX.md) and [docs/BLOCKERS.md](docs/BLOCKERS.md).

Code entry points do not mean every platform path has passed acceptance. Full isolated E2E, author desktop review, mobile/browser smoke checks, and the release gate are tracked by T-1713; the README does not claim those checks are complete.

## Related Lv projects

Selected related projects from the Lv SiYuan ecosystem (not a complete directory):

- [小驴雷切 / Lv Speed Switch](https://github.com/ai68298100/siyuan-speed-switch): unified switching and work context
- [小驴打卡 / Lv Checkin](https://github.com/ai68298100/siyuan-checkin): reading and habit check-ins
- [小驴人脉 / Lv Contacts](https://github.com/ai68298100/siyuan-contacts): contact and relationship management
- **小驴拾遗 / Lv Glean**: clipping organization, reading triage, and daily resurfacing

## Community

For feature requests, reproducible bugs, and compatibility reports, please open a [GitHub Issue](https://github.com/ai68298100/siyuan-glean/issues) with your SiYuan version, frontend type, plugin version, reproduction steps, and sanitized screenshots when useful. QQ group: **871707735**.

## Development

```bash
Node.js >= 24, pnpm 12.5.1 (run `corepack enable` first if needed)
pnpm install
pnpm dev        # development build with live reload
pnpm check      # tsc + svelte-check
pnpm test       # unit tests + architecture gates
pnpm build      # production build → dist/ + package.zip
pnpm spike      # isolated kernel spike; never touches the real workspace
```

Project documents: [current status and polish roadmap](docs/STATUS-REVIEW-2026-10-06.md), [DATA-CONTRACT.md](docs/DATA-CONTRACT.md), [PRODUCT-REPLAN.md](docs/PRODUCT-REPLAN.md), [ROADMAP.md](docs/ROADMAP.md), and [DECISIONS.md](docs/DECISIONS.md).

## License

[MIT](LICENSE)
