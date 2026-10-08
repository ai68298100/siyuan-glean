# Lv Glean (小驴拾遗)

[![Quality gates](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml) [![CodeQL](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml) [![Latest release](https://img.shields.io/github/v/release/ai68298100/siyuan-glean?label=latest%20release)](https://github.com/ai68298100/siyuan-glean/releases/latest)

> Turn the clippings already saved in SiYuan into a library you can confirm, triage, read, and review.

Lv Glean organizes clippings and articles already in SiYuan. It does not crawl the web, and ordinary notes are never captured just because they sit in a selected notebook. You review the source evidence and confirm each candidate before it enters the library.

[中文说明](README.md) · [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest) · [Capability matrix](docs/CAPABILITY-MATRIX.md) · [Feedback](https://github.com/ai68298100/siyuan-glean/issues/new/choose)

## Latest update (main · after v1.2.1, 2026-10-09)

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

Fixed: missing user entry for the AI tag service

- The existing suggestion/merge service is now available from Settings. Bulk author backfill remains a separate task with per-article confirmation boundaries.

## v1.2.1 release update (2026-10-08)

Added: v1.2.1 mainline release

- The current `main` line, popup layout fixes, README update summaries, and merged reliability improvements are published together as `v1.2.1`.

Improved: wide-canvas and standalone popup layout

- Wide-canvas Today's Gleaning cards stay bottom-aligned; standalone Workbench and settings popups now stretch across the content area instead of wrapping Chinese text or squeezing buttons.

Fixed: accidental narrow-layout activation

- Fixed host dialog content shrinking and incorrectly activating narrow-container rules; flashcard recovery, source ownership checks, and data sovereignty boundaries are unchanged.

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

The current stable release is [v1.2.1](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.2.1). Its automated gates and isolated S1 service E2E have passed; this does not mean every real environment has been accepted.

Desktop host, Android/mobile, browser frontend, real models, the official clipper, external files, and subscription services still require environment-specific checks. Prerequisites, fallbacks, and open blockers are listed in the [capability matrix](docs/CAPABILITY-MATRIX.md) and [known blockers](docs/BLOCKERS.md). Unit tests and isolated E2E are not device acceptance.

## Documentation

- [Capability matrix](docs/CAPABILITY-MATRIX.md): implementation, verification, prerequisites, and real-environment boundaries.
- [Data contract](docs/DATA-CONTRACT.md): article attributes, indexes, and recovery rules.
- [Real-host acceptance guide](docs/ACCEPTANCE.md) · [Reader acceptance](docs/READER-ACCEPTANCE.md).
- [AI acceptance](docs/AI-ACCEPTANCE.md) · [Integration acceptance](docs/INTEGRATION-ACCEPTANCE.md) · [Known blockers](docs/BLOCKERS.md).

## The Lv plugin family

Four Lv (小驴) SiYuan plugins are currently developed:

- [Lv Quickcut / 小驴雷切](https://github.com/ai68298100/siyuan-speed-switch): navigation and work-context switching
- [Lv Checkin / 小驴打卡](https://github.com/ai68298100/siyuan-checkin): reading and habit check-ins
- [Lv Contacts / 小驴人脉](https://github.com/ai68298100/siyuan-contacts): contact and relationship management
- **Lv Glean / 小驴拾遗**: clipping organization, reading triage and daily resurfacing

## Feedback and community

Use the [issue templates](https://github.com/ai68298100/siyuan-glean/issues/new/choose) and include your SiYuan version, plugin version, frontend type, and reproduction steps. Remove document titles, body text, URLs, and secrets from screenshots or logs before sharing. QQ group: **871707735**.

## Development

Requires Node.js `>=24` and pnpm `12.5.1`. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before contributing. Common commands: `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm test`, and `pnpm build`.

## License

[MIT](LICENSE)
