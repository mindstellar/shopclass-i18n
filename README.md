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

## Branches

**All work happens on `develop`.** Shopclass publishes its templates to `develop` whenever its
own `develop` changes them, so new strings reach translators while the release is still being
built, not after it ships. Crowdin reads those templates from `develop`, and its translation
pull requests target `develop`. Version bumps and re-merges run on `develop` only.

**`master` is never edited directly.** At a Shopclass release, `develop` is merged into `master`
as it stands — translations, templates and versions together. Because `master` has no commits
of its own, that merge never conflicts, and stable sites see the same version numbers
prerelease sites already saw, which only ever go up.

Merge at the release, not before: `develop` may already carry strings for code a stable site
does not run yet.

## Translating

Translation happens on Crowdin: **https://crowdin.com/project/shopclass**. Nothing to clone,
nothing to install.

1. Open the project and sign in. Anyone can join; pick your language from the list.
2. Open a file and translate. `core` is the admin panel, `messages` the notices people see,
   `theme` the public site, `mail.json` the 21 emails Shopclass sends.
3. Leave it. Your work is saved as you go, and reaches this repository on its own.

New English strings appear on Crowdin as soon as Shopclass changes them, so a language can be
ready before the release that needs it.

### What to keep

- **Placeholders stay exactly as they are**: `%s`, `%d`, `%1$s`, `{WEB_TITLE}`, `{ITEM_URL}`.
  Shopclass puts real values there. You may move them within the sentence; `%s` and `%d` without
  a number must keep their order. A lost `{ITEM_URL}` raises no error — it sends a mail with the
  link missing.
- **HTML stays**: translate the words between the tags, not the tags or their links.
- **Plural forms**: Crowdin shows one box per form your language uses, and says which counts each
  one covers. Russian's second box is for 2–4, not for everything above one. Fill every box.
- Product names — Shopclass, PHP, cron, SMTP — stay as they are.

### How your work reaches a site

Crowdin opens a pull request into `develop` here, roughly hourly. Once it is merged, prerelease
sites fetch from `develop`; stable sites get everything at the next Shopclass release, when
`develop` is merged into `master`.

### Prefer working in the files?

Open a pull request against `develop`: edit the `.po` for your language and run
`npm run merge -- <locale>` to recompile the `.mo`. It is sent up to Crowdin after the merge by
`crowdin-upload.yml` — Crowdin imports translations from this repository only once, so without
that its next pull request would undo your change.

Never edit anything in `src/templates/`. It is generated from the Shopclass source; changes
there are overwritten on the next sync.

### A missing language

If your language is not on the list, open an issue and it will be added — see
*Adding a language* below for what a new locale needs.

## Dates, currency and language names

`scripts/locale-conventions.json` decides `short_name`, `direction`, `date_format` and
`currency_format`; `npm run conventions` writes them into every `locale.json`. Editing a
`locale.json` alone therefore does not last — the next run puts the convention back, which
is what stopped five locales printing American date order.

If a format is wrong for your language, say so in a pull request. Either change
`scripts/locale-conventions.json` directly, or change your `locale.json` and run:

```bash
npm run conventions -- --adopt de_DE
```

which copies what your `locale.json` now says into the conventions file, where it sticks.
While the two disagree, `npm run check` reports it rather than letting the difference
vanish silently.

Language names stay in English: the picker they appear in is the English-speaking admin's.

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

Only `s_title` and `s_description` are translated. The `fk_i_page_id` and `s_internal_name`
fields are hidden in Crowdin, and the `language` field is set from the folder name by
`npm run conventions` — Shopclass refuses a pack whose `mail.json` language disagrees with
its folder, and that is not something to ask a translator for.

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
