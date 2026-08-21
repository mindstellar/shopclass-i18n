# Shopclass translations

Every language Shopclass ships in. Shopclass fetches from this repository when you pick a
language during install and from **Settings → Languages** afterwards, so a translation
merged here reaches sites without waiting for a Shopclass release.

Translations for **Shopclass 6.2 and later**. Earlier Osclass-era translations live in
[i10n-osclass](https://github.com/mindstellar/i10n-osclass) and are not updated.

## Layout

```
src/templates/          the English source — generated from Shopclass, do not hand-edit
  core.pot              admin and core strings
  messages.pot          user-facing messages
  theme.pot             bundled theme strings
  mail.json             the 21 email templates
  locale.json           metadata skeleton
src/translations/<locale>/
  core.po  core.mo      one catalogue per domain, .po is the source, .mo is compiled
  messages.po/.mo
  theme.po/.mo
  mail.json             email templates for this language
  locale.json           name, direction, date and currency format
locale_list.json        generated index of every locale here
```

`master` serves stable Shopclass releases, `develop` serves prereleases. Which branch a
site reads follows the version it runs.

## Translating

Most translation happens in Crowdin, which commits back here — you do not need to clone
anything to translate. To work in the files directly, edit the `.po` for your language and
run `npm run merge -- <locale>` to recompile the `.mo`.

Never edit anything in `src/templates/`. It is generated from the Shopclass source; changes
there are overwritten on the next sync.

## Adding a language

```bash
npm install
npm run new-locale -- fr_CA --name "French (Canada)"
```

Options: `--short` (menu label), `--direction ltr|rtl`, `--date-format`, `--author`.

That creates `src/translations/fr_CA/` complete — metadata, email templates, and empty
catalogues for all three domains. Then:

1. Open `src/translations/fr_CA/locale.json` and check `direction`, `date_format` and
   `currency_format`. These decide how dates and prices render, and the defaults are a
   guess.
2. Translate the `.po` files, or push the branch and let Crowdin pick the language up.
3. Run `npm run build-list` to add it to `locale_list.json`.
4. Run `npm run check`.

Copying another language's folder is the one thing not to do: it carries that language's
`locale_code`, author and version, and packs assembled that way have shipped missing
`locale.json` entirely — which makes them impossible to install rather than merely
incomplete.

## Email templates

`mail.json` holds 21 templates. Translate the text freely, but keep every `{PLACEHOLDER}`
exactly as it appears in the English source: Shopclass substitutes real values for them
when it sends. Dropping `{ITEM_URL}` does not raise an error — it sends a mail with the
link missing.

`npm run check` reports any placeholder that has gone astray.

## Keeping up with Shopclass

When Shopclass adds strings, the templates here are refreshed and every language re-merged:

```bash
npm run merge
```

Existing translations survive wherever the English string is unchanged; new strings appear
untranslated. Strings Shopclass has removed are dropped.

## Versions

`locale.json` carries a version, and Shopclass compares it against the one a site
installed to decide whether to offer an update. It is bumped automatically: a push that
changes a language's files bumps that language's patch version and rebuilds
`locale_list.json`. Nothing needs editing by hand, and a version only moves when the
content under it did.

## Display conventions

`scripts/locale-conventions.json` records the date order, currency placement and writing
direction for each language. `npm run new-locale` seeds from it, and `npm run conventions`
brings every existing `locale.json` back in line after it is edited.

This file exists because the defaults were wrong for years: German, Czech, Danish, Greek
and Catalan all printed dates as `m/d/Y`, inherited from the English pack they were copied
from.

## Checks

```bash
npm run check
```

Fails on anything that makes a language uninstallable — a missing `locale.json`, a
`locale_code` that disagrees with its folder, malformed JSON, a missing email template.
Reports, without failing, placeholders a translation has lost, since correcting those is a
translator's call.

## Licence

GPL-3.0-or-later, matching Shopclass.
