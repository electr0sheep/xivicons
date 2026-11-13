# xivicons

**/micons** is a search page for Final Fantasy XIV macro icons. Find the icon you want, click it, and paste the `/micon` command into your macro.

**Live at [xivicons.app](https://xivicons.app)**

## Using it

- Type to search. Results are grouped by category, with the closest matches first.
- Click an icon to copy its command, for example `/micon "Sprint" general`. While the search box has focus, Enter copies the highlighted first result.
- Items that come in high quality have an **HQ** button that copies the HQ version.
- Item icons only show in game while you have at least one of that item in your inventory or armoury chest.
- **One tile per icon** collapses names that share an icon (886 orchestrion rolls all use the same one).
- The address bar keeps your search, so links like [xivicons.app/?q=sprint&cat=general](https://xivicons.app/?q=sprint&cat=general) can be shared.
- Press `/` to jump to the search box.

## Running it locally

You need Node 18 or newer. There is nothing to install.

```sh
node fetch-data.mjs   # writes public/data.js; takes about a minute and a half
npx wrangler dev      # serves public/ at http://localhost:8787
```

Any static file server pointed at `public/` works too.

## Updating the data

Run `node fetch-data.mjs` again after each game patch to pick up new icons. It prints one line per game sheet:

- `ok`: rows were kept.
- `WARN`: the sheet loaded but no rows were kept, which usually means a field name changed.
- `FAIL`: the request itself broke.

If anything goes wrong, `public/data.js` is left as it was.

`SHEETS` and `CATEGORIES` at the top of `fetch-data.mjs` control which game sheets feed each category and the order the categories appear in.

## Deploying

The site is static and runs on Cloudflare Workers; [`wrangler.jsonc`](wrangler.jsonc) serves the `public/` folder.

```sh
node fetch-data.mjs
npx wrangler deploy
```

`public/data.js` is gitignored, so generate it before each deploy. If you deploy from GitHub through Cloudflare's Git integration, set the build command to `node fetch-data.mjs`.

## How it works

- `fetch-data.mjs` downloads names and icon IDs from 13 game sheets via [XIVAPI](https://v2.xivapi.com) and writes them to `public/data.js` as `window.MICON_DATA`. Each entry is `[name, iconId, categoryIndex]`, with a trailing `1` for items that can be HQ.
- `public/index.html` is the whole site: markup, styles and script in one file, with no build step. Icon images load straight from XIVAPI.
- Category IDs double as the `/micon` type word (`general`, `mount`, `pvpaction` and so on). Actions are the game's default, so their commands leave it off.
- The HQ version adds a space and the game's HQ symbol (U+E03C) after the name, inside the quotes. Browsers can't draw that character, so the copy confirmation shows a stand-in, but the copied text contains the real one.

## Credits

Game data and icon images come from [XIVAPI](https://v2.xivapi.com). FINAL FANTASY XIV icons and names © SQUARE ENIX.

The code is released into the public domain under the [Unlicense](LICENSE).
