# Lv Glean (小驴拾遗)

[![Quality gates](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml) [![CodeQL](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml) [![Latest release](https://img.shields.io/github/v/release/ai68298100/siyuan-glean?label=latest%20release)](https://github.com/ai68298100/siyuan-glean/releases/latest)

> Organize SiYuan clippings into a library for confirmation, read-later queues, reading management, and review; eligible SiYuan inbox items can also be imported when prerequisites are met.

Lv Glean organizes clippings and articles already in SiYuan. It does not crawl the web, and ordinary notes are never captured just because they sit in a selected notebook. You review the source evidence and confirm each candidate before it enters the library.

[中文说明](README.md) · [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest) · [Capability matrix](docs/CAPABILITY-MATRIX.md) · [Feedback](https://github.com/ai68298100/siyuan-glean/issues/new/choose)

## v1.3.16 update (2026-10-24)

This release delivers multi-dimensional metadata alignment on resurface cards and interactive annual heatmap filtering in the stats review view.

**New features & improvements:**

- **Resurface Cards Rich Metadata Alignment**: Cards in `ResurfaceView.svelte` now present emerald WeChat publisher badges (`.glean-source-wechat`), reading duration tier badges, and user tags (`#tag`) along with AI tags (`✨aiTag`).
- **Interactive Annual Heatmap Cell Drill-Down**: Cells in `StatsView.svelte` (`glean-stats__day`) now support keyboard focus and click-to-filter for completed articles on that specific day (`selectedDayDate`).

## v1.3.15 update (2026-10-24)

This release equips the native SiYuan reading context capsule with emerald WeChat identification and a direct reader launch button, plus interactive tag pills across all library cards.

**New features & improvements:**

- **Native Reading Capsule WeChat Badge & Direct Reader Access**: `ReadingContext.svelte` now displays the emerald WeChat badge and publisher name on WeChat notes, along with an "📖 Open in Glean Reader" button to jump directly into deep distraction-free reading with companion tools.
- **Library Cards Interactive Tag & AI Tag Pills**: Kanban, list, and table items in `DockPanel.svelte` now render user tags (`#tag`) and AI tags (`✨aiTag`) with instant drill-down filtering on click.

## v1.3.14 update (2026-10-24)

This release delivers deep URL-level WeChat article recognition in the library workbench, smooth Space / Shift+Space page turning shortcuts for the reader, and full AI Quiz question generation across the highlights wall.

**New features & improvements:**

- **WeChat Article Identification in Library Workbench**: `DockPanel.svelte` integrates `isWechatUrl` to ensure WeChat clippings are identified and styled with the emerald badge even without `entry.site` metadata, preventing "unknown source" fallbacks and enabling one-click publisher filtering.
- **Modern Spacebar Page-Turn Shortcuts**: Following Readwise Reader / Cubox / Kindle standards, reader mode now supports `Space` (smooth page-down) and `Shift+Space` (smooth page-up); clearly documented in the `?` shortcut modal.
- **Highlights Wall Lv Exam Federation**: Highlights cards across timeline and article views now feature the "📝 AI Quiz" button, connecting directly to Lv Exam (`LvExam`) with ghost button fallback.

## v1.3.13 update (2026-10-23)

This release implements the ecosystem directive hardening, thoroughly eliminating `.dialog-content input` global CSS leaks, synchronizing ghost button degradation across the highlights wall, adapting cross-platform hotkeys, and guarding the new 256x256 high-contrast `icon.png` asset.

**New features & improvements:**

- **Eliminated Global `.dialog-content input` Leaks**: Scoped mobile dialog form styles strictly under `.lv-glean`, `.glean-dialog`, and `[class*="glean"]` namespaces, preventing unwanted overrides on native SiYuan or third-party modals.
- **Synchronized Ghost Flashcard Buttons**: Highlights timeline and grouped article views now detect Lv Cards (`hasCardsInstalled`) and apply 45% ghost button styling with an informative tooltip when uninstalled.
- **Cross-Platform Adaptive Hotkeys**: Tuned default workbench shortcut dynamically (`⌥⌘G` on macOS, `Ctrl+Alt+G` on Windows/Linux), eliminating modifier parsing issues on non-Mac desktops.

## v1.3.12 update (2026-10-23)

This release brings automatic WeChat Official Account recognition and manual rescan, in-sidebar highlight keyword search filtering, and single-highlight AI Quiz generation (Lv Exam federation with ghost button fallback).

**New features & improvements:**

- **Automatic WeChat Official Account Recognition**: Automatically probes content DOM and header text upon opening WeChat clippings without author; seamlessly writes back `custom-clip-author`; provides a one-click "Rescan publisher" button in the WeChat card.
- **Enhanced Sidebar Highlight Study Stream**: Highlights filter bar automatically displays when 4 or more highlights exist; added "📝 AI Quiz" button to highlight cards with ghost fallback for uninstalled Lv Exam plugin.

## v1.3.11 update (2026-10-23)

This release implements the unified `.lv-dialog-title-wrap` branded dialog header standard across all dialog surfaces (22×22 pine green wheat icon + title text + compact version badge) and reinforces deep series article path null-safety.

**New features & improvements:**

- **Unified `.lv-dialog-title-wrap` Dialog Headers**: Dialog header bars across settings, formatting, onboarding, migration, import, flashcards, and workbench popup surfaces are now unified with standard brand insignia and version badge.
- **Micro-Interaction & Defensiveness Hardening**: Fortified optional chaining and undefined checks in series collection traversal to eliminate edge-case null pointer hazards.

## v1.3.10 update (2026-10-23)

This release implements the full Lv Ecosystem Directive (Epoch 6), featuring ecosystem federation bridge integration, automatic reading checkin logging, ghost degradation for flashcard and exam quiz creation, Raikiri workbench widget registration, 32×32 monochrome wheat icon upgrade, global CSS pollution elimination, and Nordic Pine Green + Harvest Wheat aesthetic tokens.

**New features & improvements:**

- **Ecosystem Federation & Automatic Checkin**: Deep integration with `ecosystem-bridge-kit` SDK; automatically logs checkin events when articles are marked done with zero hard dependencies; four bridge aliases (`siyuanGlean`, `xiaolvGlean`, `lvGlean`, `LvGlean`) with first-instance-wins and safe teardown.
- **Flashcard & Exam Question Ghost Degradation**: In-article selection bar detects Lv Cards (`window.xiaolvCards`) and Lv Exam (`window.LvExam`); renders a 45% ghost button with helpful installation tooltips when uninstalled; registers the `glean-later-list` reading stream widget with Lv Raikiri.
- **Monochrome Vector Icon Upgrade**: Upgrades `iconGleanWheat` to an open-book base with wheat stalk, two pairs of grain seeds, and top wisdom bead, ensuring needle-sharp rendering on 16px retina displays.
- **Global CSS Pollution Cleansing & Brand Styling**: Completely wraps raw `.dialog-content` selectors to prevent pollution of SiYuan native modals; injects brand tokens `--lv-brand: #0D9488` and `--lv-accent-wheat: #FB923C` with active physical micro-tactile button feedback.
- **Marketplace Discovery & Engineering Hardening**: Prepends brand keywords `"小驴"`, `"小驴拾遗"`, `"xiaolv"`, `"lv"` to `plugin.json`; enables `"settingsWindow": true`; adds root `CHANGELOG.md` and `.github/workflows/release.yml`.

## v1.3.9 update (2026-10-22)

This release focuses on alignment with SiYuan's latest official Petal lifecycle contracts, four-dimensional reading metrics with tier color dots, in-place highlight color cycling and color filtering, smooth back-to-top floating capsule for deep reading, and one-click expand/collapse all for article highlight groups.

**New features & improvements:**

- **Official Petal Lifecycle Alignment**: Implements `onDataChanged` to prevent full plugin reload during cross-device cloud sync or external writes; adds single-instance guard to `onLayoutReady` to prevent duplicate topbar icons; integrates official `open-siyuan-url-plugin` protocol and `sync-end` event for instant UI refresh.
- **Reading Metrics & Highlight Color Management**: Four-dimensional metrics capsule integrates `resolveReadingTimeTier` color dots (short/emerald, medium/azure, long/amber); sidebar highlight dots support 1-click cycling across 4 colors (yellow/red/blue/green) with block-level IAL persistence and in-place color filtering; compact tag bar display below metrics.
- **Smooth Back-to-Top Floating Capsule**: Floating action button (`.glean-reader__back-to-top`) smoothly appears when reading progress exceeds 12%, allowing effortless return to document start in long essays.
- **Expand/Collapse All in Grouped Highlights**: Highlights view toolbar adds one-click "Collapse all / Expand all" action in article grouping mode (`allGroupsOpen`).

## v1.3.8 update (2026-10-22)

This release delivers comprehensive WeChat Official Account clipping optimizations, fulltext in-page highlight search, floating selection toolbar with inline notes, precision highlight targeting, Bento streak and reading achievement milestones, and an overhauled settings dialog.

**Added & Enhanced:**

- **WeChat Official Account deep optimizations**:
  - Automatically identifies publisher names, publication time, and author lead summaries without extra AI token costs.
  - Automatically fixes `data-src` lazy-loaded images, restores CSS `background-image` panoramic illustrations, and avoids anti-hotlink 403 errors.
  - Reverse-engineers LaTeX math formulas into standard Markdown syntax and purifies code blocks without line-number clutter.
  - Converts `<mpvideo>` and Tencent Video embeds to structured cards and extracts audio widgets to voice quote cards.
  - Adds a dedicated WeChat companion card with publisher avatar, Biz ID, WeRead web reading shortcut, clean short link copying, and series/folder chapter continuous navigation.
  - Library cards and rows feature one-click WeChat source facet filtering.
- **Enhanced deep reader (ReaderTab)**:
  - In-page fulltext search using the modern, non-invasive `CSS.highlights` API with bidirectional navigation.
  - Selection floating toolbar (`glean-reader__selection-bar`) for instant quotes, inline notes ("Quote with Memo"), flashcards, and translation.
  - Theme switching (Follow SiYuan / Paper / Eye-protection green), immersive mode with breathing toolbar fade-out and Escape restoration.
- **Highlight and quote knowledge flow**:
  - Companion panel lists document highlights with smooth scroll and pulse highlight feedback.
  - Highlights wall "Original" action precisely targets and scrolls directly to the referenced quote block.
  - Flat timeline view with vertical rail and interactive circular anchors; exports quotes to linked SiYuan documents with native block references.
- **Today's Gleaning and stats achievements**:
  - Bento habit loop: streak flame card and 7-day stepper pill bar for calm reading motivation.
  - Reading achievements: 6 milestone badges on the stats review page.
  - Reading time tier badges (emerald green for short, azure blue for medium, amber orange for long); Kanban titles capped with `line-clamp: 3`.
- **Expanded settings panel**:
  - Expanded to 920×720px with 8 categories equipped with dedicated SVG icons; fixed newbie hint banner truncation.
- **Complete keyboard accessibility**:
  - Collapsible library rail (`railCollapsed`); full keyboard triage across library, highlights, resurface, and modal dialogs.

## v1.3.7 update (2026-10-19)

This release unifies keyboard accessibility across dialogs, introduces reading time tier filtering inspired by Readwise Reader and Cubox, and completes reading-facade routing for uninterrupted reading continuity.

**Added:**

- **Reading time tier filtering**: Filter articles by estimated reading time (short ≤5 min, medium 6-15 min, long >15 min) in library secondary filters, combining seamlessly with site, author, tag, and content type.
- **Keyboard accessibility and shortcut workflows**: Escape closes FormattingDialog, FlashcardDialog, ArchiveDialog, and RestoreDialog; `Ctrl+Enter` / `Cmd+Enter` provides quick draft saving and card confirmation.
- **Unified reading-facade routing and session continuity**: Opening existing inbox articles routes through `facade.openReadingDocument` to connect recent reading history and ReaderTab; Today's Gleaning features an in-session "Continue Reading" card; TTS playback remembers speech rate (0.75x–1.5x) and resumes from the current chunk; "Continue Reading" command supports alternating between reading history and current document.
- **Friendly site branding**: New `displaySiteName` pure function projects high-frequency domains (WeChat, Zhihu, Bilibili, SSPAI, Juejin, GitHub, etc.) to clean brand names while preserving raw `custom-clip-site` facts.
- **Excerpts and statistics enhancements**: Highlights wall supports one-click "Clear selection" and formatted Markdown quote copying, plus bulk export to `.md` files; stats heatmap and daily table support click-to-filter completed articles; added calm conversion funnel card.
- **Data sovereignty and security safeguards**: Canonical URL deduplication strips tracking parameters; custom AI endpoint validates HTTP vs HTTPS and warns on cleartext public endpoints; backup exports adopt standard timestamped filenames with package summaries; hardened high-contrast and forced-colors styling.

**Improved & Fixed:**

- Responsive titles and row density for library and candidate views, preventing horizontal text squeezing in narrow split panes.
- Batch action bar preserves selections across filter changes, returning keyboard focus safely; fixed mobile topbar/bottombar CSS selectors for edge-to-edge safe areas.
- Candidate source replenishment input supports Enter to submit and Escape to cancel; restore dialog supports partial-failure retry.

See the [release candidate record](docs/RELEASE-CANDIDATE.md) for automated gates and release evidence. Real-host, screen-reader, mobile, and external capabilities remain tracked under B-0002 and B-0004–B-0008.

## v1.3.6 update (2026-10-16)

This hotfix addresses repeated reading-context refresh related to [#16](https://github.com/ai68298100/siyuan-glean/issues/16), with the same lifecycle paths reviewed in native editors, ReaderTab, and Workbench preview.

- Repeated load/switch events for the same native editor now reuse its reading context, avoiding remounts and repeated loading skeletons.
- Background refresh keeps the resolved article content or no-bar state, reducing guide-background and reading-bar flicker.
- Embedded editors in ReaderTab and Workbench preview no longer receive an extra native reading context.
- Highlights, ReaderTab, and Settings keep existing content during background refresh, reducing skeleton-card, loading-bar, and usage-counter jumps.

See the [release candidate record](docs/RELEASE-CANDIDATE.md) for this run's automated gates and release evidence. Real-host, screen-reader, mobile, and external capabilities remain subject to B-0002 and B-0004–B-0008 acceptance.

## v1.3.5 update (2026-10-16)

This patch makes the “document facts saved, derived index sync pending” outcome explicit across write paths and tightens the acceptance boundaries for AI, AV, imports, snapshots, flashcards, and check-in integration. Real-host, model, and external-service acceptance remains tracked under B-0002 and B-0004–B-0008.

**Fixed:**

- Capture, status, rating/priority, author edits, reading AI, Today's Gleaning, archive/restore, snapshots, and Workbench preview now show an index-pending result when document attributes were saved but the derived index could not be persisted.
- Added service and UI regressions to keep user attributes intact and avoid reporting ordinary success or snapshot failure for an index-only failure.

**Documentation:**

- Expanded the real acceptance matrices for article Q&A, author suggestions, one-way AV projection, flashcard recovery, Pocket HTML/CSV, and automatic snapshots.

## v1.3.4 update (2026-10-14)

This patch consolidates the shared design-token system without changing user-facing behavior or visual intent, while making asynchronous actions, index writes, and migration recovery more reliable. Real-host visual, screen-reader, and external integrations remain subject to B-0002/B-0005 acceptance.

**Added:**

- Three-layer design tokens (primitive, semantic, and component) plus the `tokens:audit` script; see [`docs/UI-STANDARD.md`](docs/UI-STANDARD.md).
- Migration checkpoint task identity and incremental recovery guards, so failed rows can be re-confirmed and retried against current document facts.

**Improved:**

- Shared colors, 4px spacing, typography, radii, shadows, z-index, and motion tokens; buttons, labels, and cards now reuse component variants.
- Kernel requests and bulk actions now share busy locks, timeouts, race protection, classified errors, and retryable feedback to prevent duplicate writes and stale responses.
- Empty, error, validation, and recovery states are aligned across migration, library refresh, Today's Gleaning, settings, and AI tag cleanup.

**Fixed:**

- Index read/save failures no longer report silent success; fact-source readback failures show refresh/rebuild guidance, while full reconciliation and rebuild can clear the damaged-index guard.
- Corrected field validation and focus placement, disabled invalid entry points, compressed recovery checkpoints, and duplicate AV bindings caused by delayed index visibility.

Measured consolidation: spacing token coverage improved from 36.7% to 96.7%; typography coverage from 31.6% to 99.8%; radii, shadows, z-index, and motion reached 100%. Color literals fell from 32 occurrences/27 values to 24/20, and token declarations from 231 to 210. The 24-case real-host visual matrix still awaits B-0002 evidence.

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

### v1.3.6 (2026-10-16)

Fixed: native reading contexts now handle repeated load/switch events idempotently and preserve resolved content or the no-bar state during background refresh. Embedded editors in ReaderTab and Workbench preview no longer mount an extra native reading context. Related issue: [#16](https://github.com/ai68298100/siyuan-glean/issues/16).

### v1.3.5 (2026-10-16)

This patch makes index-sync failures explicit across the main write paths and tightens the AI, AV, import, snapshot, flashcard, and check-in acceptance boundaries. Real-host, model, and external-service acceptance remains tracked separately.

Fixed: show an index-pending result when document attributes were saved but the derived index failed, without overwriting user attributes or misreporting snapshot failures; added service and UI regressions.

Documentation: expanded the matrices for article Q&A, author suggestions, one-way AV projection, flashcard recovery, Pocket HTML/CSV, and automatic snapshots.

### v1.3.4 (2026-10-14)

This release consolidated design tokens and tightened asynchronous actions, index writes, and migration recovery. Real-host visual, screen-reader, and external acceptance remained subject to B-0002/B-0005.

### v1.3.3 (2026-10-10)

This release prevented duplicate library bindings during SiYuan's asynchronous database refresh window and improved reading-companion performance and action feedback. Real-host visual and screen-reader acceptance remained pending under B-0002.

Added: AV refresh retry protection, explicit confirmation for failed import retries, localized AI channel test errors, and retryable failed items from bulk archive.

Improved: consistent article preview/open actions, busy states for settings and bulk actions, and clearer Today's Gleaning, filter, and statistics hierarchy.

Fixed: excerpt flashcards without a locatable source block, partial archive feedback, and related bilingual copy.

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

This release is [v1.3.16](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.3.16). See the [release candidate record](docs/RELEASE-CANDIDATE.md) for automated gates and release evidence; this does not mean every real environment has been accepted.

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
