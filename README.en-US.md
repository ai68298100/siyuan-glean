# Lv Glean (小驴拾遗)

[![Quality gates](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml) [![CodeQL](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml) [![Latest release](https://img.shields.io/github/v/release/ai68298100/siyuan-glean?label=latest%20release)](https://github.com/ai68298100/siyuan-glean/releases/latest)

> Organize SiYuan clippings into a library for confirmation, read-later queues, reading management, and review; eligible SiYuan inbox items can also be imported when prerequisites are met.

Lv Glean organizes clippings and articles already in SiYuan. It does not crawl the web, and ordinary notes are never captured just because they sit in a selected notebook. You review the source evidence and confirm each candidate before it enters the library.

[中文说明](README.md) · [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest) · [Capability matrix](docs/CAPABILITY-MATRIX.md) · [Feedback](https://github.com/ai68298100/siyuan-glean/issues/new/choose)

## v1.3.3 update (2026-10-10)

This release prevents duplicate library bindings during SiYuan's asynchronous database refresh window and improves reading-companion performance and action feedback. Real-host visual and screen-reader acceptance is still pending under B-0002.

**Added:**

- AV refresh retry protection: when existing rows are temporarily unavailable, the refresh waits before deciding that bindings are missing.
- Retrying failed imports now requires explicit confirmation; AI channel test exceptions show localized feedback; failed items from bulk archiving remain selected and can be retried.

**Improved:**

- Article preview and open actions now use title buttons consistently; related controls are locked during settings saves and bulk actions to prevent accidental changes.
- Today's Gleaning actions use a fixed two-column layout with centered labels and equal-width unavailable-source slots; filter labels are centered and the period-completed note uses a smaller type size.

**Fixed:**

- Flashcards can no longer be created from excerpts without a locatable source block; partial archive failures now provide feedback, and alignment and type-size issues in Today's Gleaning, filters, and statistics are corrected.

## The Lv plugin family

| Plugin | One-line description | GitHub repository |
| --- | --- | --- |
| Lv Quickcut / 小驴雷切 | A unified workspace and context-switching platform. | [siyuan-speed-switch](https://github.com/ai68298100/siyuan-speed-switch) |
| Lv Checkin / 小驴打卡 | A local-first workspace for habits, check-ins, and reviews. | [siyuan-checkin](https://github.com/ai68298100/siyuan-checkin) |
| Lv Contacts / 小驴人脉 | Manage contacts, relationships, and related information in SiYuan. | [siyuan-contacts](https://github.com/ai68298100/siyuan-contacts) |
| Lv Glean / 小驴拾遗 | Organize clippings with reading management and later review. | [siyuan-glean](https://github.com/ai68298100/siyuan-glean) |
| Lv Exam / 小驴考试 (Beta) | A local question bank, practice, mock exams, review of mistakes, and AI assistance. | [siyuan-exam](https://github.com/ai68298100/siyuan-exam) |
| Lv Home / 小驴管家 (Beta) | Household and life records, due-date reminders, and task follow-up. | [siyuan-home](https://github.com/ai68298100/siyuan-home) |
| Lv Cards / 小驴闪卡 (Beta) | A local-first lifecycle flashcard learning platform in SiYuan. | [siyuan-lv-cards](https://github.com/ai68298100/siyuan-lv-cards) |
| Lv Common / 小驴常用 (Beta) | Quickly insert common phrases, templates, and code from SiYuan blocks. | [xiaolv-common](https://github.com/ai68298100/xiaolv-common) |

QQ group: **871707735** for bug reports, feature requests, and discussion.

<details>
<summary>Released version history (click to expand)</summary>

### v1.3.2 (2026-10-10)

This release tightened action completeness and visual consistency, added missing failure feedback, and aligned Today's Gleaning, filters, and statistics.

Improved: article preview, settings saves, bulk actions and Today's Gleaning entry points, busy states, alignment and type hierarchy; import, AI-channel testing and bulk archive failures now explain and preserve retryable work.

Fixed: excerpt flashcard preconditions, Today's Gleaning/filter/statistics display issues and related bilingual copy.

### v1.3.1 (2026-10-09)

Improved: large-library refresh and Kanban performance

- Library database binding refresh now uses efficient membership checks instead of scanning the existing binding list for every article.
- Kanban columns are bucketed in one pass after filtering and sorting, while preserving the existing order and results.
- This performance patch does not change article attributes, index format, endpoints, or settings fields.

### v1.3.0 (2026-10-09)

Added: settings category navigation

- Settings now use a "category navigation + content pane" layout: the 11 flat groups are consolidated into 8 categories (Workspace, Daily gleaning, Reading, AI enrichment, AI channel, Integrations, Data & recovery, Maintenance), each with a one-line description; the dialog widened to 720×640.
- Library notebook selection gained search, a selection counter and one-tap clear — no more scrolling through long chip lists.
- Narrow windows / mobile automatically fall back to horizontal category tabs with 44px touch targets.

Added: AI tag cleanup entry

- Settings can scan similar AI tags on demand; each group requires choosing the name to keep before merging. Only the AI tag field is changed.

Improved: immediate review after merging

- Each group shows its affected article count, then rescans and refreshes the workbench after a successful merge.

Fixed: interaction and logic defects found in a full walkthrough

- "Continue reading" in the reader tab no longer reads the previous article after switching; session reading minutes survive transient context errors; the appearance toggle now opens and closes.
- An empty filtered library now shows "no articles match" with a clear-filters action instead of a blank list; candidate row actions gain busy guards against double submits.
- The migrator guards against concurrent double-click runs and confirms discarding progress; backup files can be re-selected and preview cancellation is no longer shown as an error; settings saving gained multi-window conflict protection.
- Settings show errors and retry for notebooks, check-in items and AI logs; about 25 bilingual copy fixes, including the mislabeled source-URL toast and the AI usage counter label.

Fixed: service and logic defects found in a second walkthrough

- With a pinned pick for today, daily gleaning no longer collapses to the pinned article only, and "read next" can offer other articles again; swipe action labels (later/archive) now match the actual direction.
- With split editors or multiple tabs, current-document actions (mark done, capture, AI summary) target the document you are viewing; the gear entry under SiYuan's plugin settings works again.
- Derived-index writes are now serialized so property writes can no longer overwrite a running full reconciliation; large exports and snapshot uploads use a 180s long timeout; imports gained a 32 MiB size guard.
- Text-to-speech no longer splits decimals; Omnivore imports recognize the `state` archived marker and millisecond timestamps; stats tag counts no longer inflate on duplicate tags within one article.

Improved: third-walkthrough experience details

- Running backup restores, flashcard recovery or AI tag cleanup no longer aborts when you switch settings categories; settings conflict recovery is more robust; category navigation supports arrow keys and Home/End; the notebook list distinguishes "no notebooks yet" from "no matches"; touch targets apply in narrow panels on wide viewports; keyboard focus indicators are more complete.

Hardened: fifth-walkthrough data and experience fixes

- Saved views created on one canvas are no longer silently overwritten by actions on the other; auto-save pauses when workbench preferences fail to load, so an empty snapshot cannot wipe user data.
- Duplicate saved-view names now show a notice; busy exclusion for row actions is complete; archive/restore dialogs no longer stack; the corrupted-import-progress reset entry actually works and no longer deletes healthy progress.

Hardened: fourth-walkthrough import and failure defenses

- Import parsing is hardened against malformed export files: oversized fields are capped, malformed timestamps rejected, a corrupted import-progress file can now be reset from the UI (previously required deleting the data file manually), and the progress detail list no longer stutters on tens of thousands of rows.
- The inbox shows a retry entry when its query fails instead of hiding silently, without overlapping toasts; the highlights view distinguishes "no matches" from "no highlights" and no longer shows a stale list after load failures; local documents read "Local note" in the source column.

Fixed: missing user entry for the AI tag service

- The existing suggestion/merge service is now available from Settings. Bulk author backfill remains a separate task with per-article confirmation boundaries.

### v1.2.1 (2026-10-08)

Added: v1.2.1 mainline release

- The current `main` line, popup layout fixes, README update summaries, and merged reliability improvements are published together as `v1.2.1`.

Improved: wide-canvas and standalone popup layout

- Wide-canvas Today's Gleaning cards stay bottom-aligned; standalone Workbench and settings popups now stretch across the content area instead of wrapping Chinese text or squeezing buttons.

Fixed: accidental narrow-layout activation

- Fixed host dialog content shrinking and incorrectly activating narrow-container rules; flashcard recovery, source ownership checks, and data sovereignty boundaries are unchanged.

</details>

## Install and get started

Compatible with SiYuan `v3.8.5+`. Download `package.zip` from the [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest), then install and enable the plugin in SiYuan.

1. In plugin settings, select one or more clipping notebooks for your library.
2. Open the library and choose **Organize clippings**. Start with the report preview, which makes no writes.
3. Review the source evidence for each candidate. Confirm it, add a source URL, keep it as a local document, or exclude a false positive.
4. Triage items into Inbox, Read later, Reading, or Archived. Explicitly choose **Mark as done** when you finish an article.

Ordinary notes are not bulk-captured just because of their location, and opening an article does not mark it as done.

## What you can do

- **Build a trusted library**: find candidates from source evidence, preview before confirmation, migrate existing clippings, filter, sort, and triage in batches.
- **Read by content type**: distinguish full-text clippings, link-only items, and local documents. Dock, Workbench, and Kanban share the same article state. Start reading and Mark as done are separate actions.
- **Resurface and review**: Today's Gleaning explains why an item returned; weekly, monthly, and yearly reviews can produce reports and CSV files.
- **Add capabilities as needed**: the reader tab (experimental and off by default), highlights, formatting drafts, AI, imports, snapshots, the SiYuan inbox, and plugin bridges have separate prerequisites. See the [capability matrix](docs/CAPABILITY-MATRIX.md).

## Data and privacy

- SiYuan document attributes are the source of truth for article state and metadata; the plugin index can be rebuilt. Uninstalling the plugin does not actively remove article attributes.
- Automatic processing protects existing source URLs, status, priority, rating, and author values. Explicit edits update only their selected fields.
- The plugin does not provide RSS crawling, cloud-account sync, or automatic reading, and it ships no model API key.
- AI features can be disabled individually. They are manual-only by default and require a configured model or channel. When used, article text is sent to the service you configured. Review the privacy terms of a custom endpoint. AI failures or quota limits do not block the core library.

## Compatibility and acceptance

The current stable release is [v1.3.3](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.3.3). Its automated gates have passed; this does not mean every real environment has been accepted.

Desktop host, Android/mobile, browser frontend, real models, the official clipper, external files, and subscription services still require environment-specific checks. Prerequisites, fallbacks, and open blockers are listed in the [capability matrix](docs/CAPABILITY-MATRIX.md) and [known blockers](docs/BLOCKERS.md). Unit tests and isolated E2E are not device acceptance.

## Documentation

- [Capability matrix](docs/CAPABILITY-MATRIX.md): implementation, verification, prerequisites, and real-environment boundaries.
- [Data contract](docs/DATA-CONTRACT.md): article attributes, indexes, and recovery rules.
- [Real-host acceptance guide](docs/ACCEPTANCE.md) · [Reader acceptance](docs/READER-ACCEPTANCE.md).
- [AI acceptance](docs/AI-ACCEPTANCE.md) · [Integration acceptance](docs/INTEGRATION-ACCEPTANCE.md) · [Known blockers](docs/BLOCKERS.md).
- [Changelog](docs/CHANGELOG.md): release notes per version.

> Shortcut: `⌥⌘G` opens the workbench (customizable in SiYuan's Settings → Hotkeys).

## Feedback and community

Use the [issue templates](https://github.com/ai68298100/siyuan-glean/issues/new/choose) and include your SiYuan version, plugin version, frontend type, and reproduction steps. Remove document titles, body text, URLs, and secrets from screenshots or logs before sharing. The QQ group **871707735** is also available for bug reports, feature requests, and discussion.

## Development

Requires Node.js `>=24` and pnpm `12.5.1`. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before contributing. Common commands: `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm test`, and `pnpm build`.

## License

[MIT](LICENSE)
