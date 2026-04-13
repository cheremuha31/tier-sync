
Tier Sync is an Obsidian community plugin that turns your Steam library into a drag-and-drop tier board inside your vault.

## Features

- Sync owned Steam games with `include_appinfo` and a configurable minimum playtime filter.
- Accept a Steam ID64, vanity name, or full `steamcommunity.com` profile URL.
- Add Steam games manually by searching their titles, even if they do not appear in your owned-games sync.
- Add custom games through RAWG title search with better cover art.
- Keep tier assignments stable across syncs while removing games that no longer match the library filter.
- Search the board by game name.
- Create, rename, recolor, reorder, and delete custom tiers.
- Export the current board as a Markdown note in your vault.

## Setup

1. Create a Steam Web API key at https://steamcommunity.com/dev/apikey.
2. Open **Settings → Community plugins → Tier Sync**.
3. Paste your API key.
4. Enter your Steam ID64, vanity name, or profile URL.
5. Adjust **Minimum playtime** if needed.
6. Run **Sync from Steam**.

Manual additions:

- Use **Add Steam game** to include short games or titles from family sharing.
- Add a RAWG API key in settings to enable custom game search.
- Use **Add custom game** to search other games by title.

## Commands

- **Open tier sync board**
- **Sync Steam library**
- **Export tier list as markdown**
- **Add Steam game manually**
- **Add custom game manually**

## Data sources

- Steam sync uses the official Steam Web API.
- Manual Steam search and missing-cover recovery use public Steam store endpoints.
- Custom game search uses the RAWG API and requires a user-provided API key.

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Release artifacts

For manual installation or release uploads, copy these files into:

```text
<Vault>/.obsidian/plugins/tier-sync/
```

Files:

- `main.js`
- `manifest.json`
- `styles.css`

## BRAT setup

This repository is intended to be installed through BRAT from GitHub releases.

Release flow:

1. Update the plugin version in `package.json`.
2. Run `npm version patch`, `npm version minor`, or `npm version major`.
3. Push commits and tags with `git push && git push --tags`.
4. GitHub Actions builds the plugin and uploads `manifest.json`, `main.js`, `styles.css`, and `versions.json` to the release.

`data.json` is intentionally local and should not be committed to this repository.
