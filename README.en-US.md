# Lv Glean (小驴拾遗)

> **Glean your clippings before they gather dust.**

Lv Glean is a SiYuan plugin for managing web clippings: it turns articles you saved via the official Web Clipper, inbox, or any import tool — and then never opened again — into a living reading library with a real lifecycle. Everything is stored as document attributes; uninstalling the plugin loses nothing.

[中文说明](README.md)

## Why

The official SiYuan Web Clipper stores articles with **no queryable attributes**: the source URL and time exist only as template text inside the document body. Search, databases and SQL can't manage them. Collections grow; reading doesn't.

Lv Glean's foundation is a **clip attribute spec** (`custom-clip-*` document attributes) plus a **legacy migrator**: organize your dusty clipping library in 3 minutes into something manageable, searchable and measurable.

## Features

- **Five-state triage**: inbox → read later → reading → done → archived, stored on the documents themselves
- **Dock panel**: five queues, filters, sorting by time/length/priority, batch actions
- **Legacy migrator**: dry-run report first, batched backfill (≤50 per batch, resumable), never overwrites manual fields
- **AI enrichment** (M3): one-line summary + AI tags on capture, semantic duplicate detection, related-article recommendations, preset AI actions, agent tools — all through SiYuan's built-in AI, zero extra cost, fully optional
- **Anti-dust trio** (M4): daily resurfacing ("Today's gleaning"), inbox quota hints, stale archive candidates
- **Stats**: reading stats and Markdown weekly reports (M2)
- **Data sovereignty**: attributes stay on your documents after uninstall

## Organize your library in 3 minutes

1. Install, open settings, pick your clipping notebook(s) as **library notebooks**
2. Open the panel → **Organize clippings**
3. Review the **dry-run report** → **Start backfill**
4. Done — every clipping now carries source URL, clip time, word count and reading minutes

## Compatibility

SiYuan **v3.8.5+**, desktop / mobile / browser-docked. AI features use the model **you** configured in SiYuan; the plugin ships no API keys and uploads nothing.

## The Lv plugin family

Four Lv (小驴) SiYuan plugins are currently developed:

- [Lv Quickcut / 小驴雷切](https://github.com/ai68298100/siyuan-quickcut): quick web clipping and processing
- [Lv Checkin / 小驴打卡](https://github.com/ai68298100/siyuan-checkin): reading and habit check-ins
- [Lv Contacts / 小驴人脉](https://github.com/ai68298100/siyuan-contacts): contact and relationship management
- **Lv Glean / 小驴拾遗**: clipping organization, reading triage and daily resurfacing

## Community

QQ group for discussion: **871707735**

*Glean*: to pick up the grain left behind after the harvest. Your clippings deserve the same.

## License

[MIT](LICENSE)
