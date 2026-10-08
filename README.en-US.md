# Lv Glean (小驴拾遗)

[![Quality gates](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/ci.yml) [![CodeQL](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml/badge.svg)](https://github.com/ai68298100/siyuan-glean/actions/workflows/codeql.yml) [![Latest release](https://img.shields.io/github/v/release/ai68298100/siyuan-glean?label=latest%20release)](https://github.com/ai68298100/siyuan-glean/releases/latest)

> Turn the clippings already saved in SiYuan into a library you can confirm, triage, read, and review.

Lv Glean organizes clippings and articles already in SiYuan. It does not crawl the web, and ordinary notes are never captured just because they sit in a selected notebook. You review the source evidence and confirm each candidate before it enters the library.

[中文说明](README.md) · [Latest Release](https://github.com/ai68298100/siyuan-glean/releases/latest) · [Capability matrix](docs/CAPABILITY-MATRIX.md) · [Feedback](https://github.com/ai68298100/siyuan-glean/issues/new/choose)

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

The current stable release is [v1.2.0](https://github.com/ai68298100/siyuan-glean/releases/tag/v1.2.0). Its automated gates and isolated S1 service E2E have passed; this does not mean every real environment has been accepted.

Desktop host, Android/mobile, browser frontend, real models, the official clipper, external files, and subscription services still require environment-specific checks. Prerequisites, fallbacks, and open blockers are listed in the [capability matrix](docs/CAPABILITY-MATRIX.md) and [known blockers](docs/BLOCKERS.md). Unit tests and isolated E2E are not device acceptance.

## Documentation

- [Capability matrix](docs/CAPABILITY-MATRIX.md): implementation, verification, prerequisites, and real-environment boundaries.
- [Data contract](docs/DATA-CONTRACT.md): article attributes, indexes, and recovery rules.
- [Real-host acceptance guide](docs/ACCEPTANCE.md) · [Reader acceptance](docs/READER-ACCEPTANCE.md).
- [AI acceptance](docs/AI-ACCEPTANCE.md) · [Integration acceptance](docs/INTEGRATION-ACCEPTANCE.md) · [Known blockers](docs/BLOCKERS.md).

## Feedback and community

Use the [issue templates](https://github.com/ai68298100/siyuan-glean/issues/new/choose) and include your SiYuan version, plugin version, frontend type, and reproduction steps. Remove document titles, body text, URLs, and secrets from screenshots or logs before sharing. QQ group: **871707735**.

## Development

Requires Node.js `>=24` and pnpm `12.5.1`. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before contributing. Common commands: `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm test`, and `pnpm build`.

## License

[MIT](LICENSE)
