# Appearance (XO 5.113.2 / e281c536)

Open **Profile** at the bottom of the left menu. The **Appearance** card offers:

| Theme | Treatment |
| --- | --- |
| Arctic (default) | Cool blue accents, balanced spacing, slate surfaces |
| Graphite | Compact rows, flat charcoal surfaces, square controls |
| Alpine | Warm ivory / forest surfaces, rounded navigation and separated rows |
| Horizon | Contrasting navy navigation, violet accents |

Each theme supports **System** (default), **Light** and **Dark**. System follows
`prefers-color-scheme` changes immediately; explicit Light/Dark overrides do not.
The account preference `preferences.xoaHlAppearance = { theme, mode }` uses the
existing authenticated `user.set` API. Other preference keys are untouched.
New accounts and invalid or unknown settings fall back to Arctic/System.
Saving errors are reported without applying an unsaved preference.

The browser caches only the last validated appearance (no identity or credentials)
in `xoa-hl.appearance.v1` to style the loading screen before the main bundle loads.
After authentication, the account's server preferences take precedence, including
when another user signs in on the same browser. Logout resets to Arctic/System.
A fresh browser initially shows Arctic/System until the account is loaded.
Blocked or corrupt browser storage does not prevent startup or saving to the server.

The patch retains the existing React 15, Bootstrap 4 alpha, Sass, Font Awesome and
styled-components stack, routes, permissions and actions. It targets the classic
XO 5 UI, including shared forms, React Select, dialogs, notifications and Chartist
surfaces. The separate bundled XO 6 preview has its own appearance implementation.
The VM console framebuffer is not recolored.

## Validation

`tests/test-appearance.mjs` checks all twelve preference combinations, defaults,
pre-paint bootstrap parity, blocked/corrupt storage, OS changes, manual overrides,
account switching and logout. The patch-validation workflow runs this against the
fully patched pin. `Check packaged GUI build` compiles and checks the actual GUI
payload in GitHub Actions/Docker when patches change. No local product build is
required or supported.

Before release, validate an appliance in all eight theme/scheme combinations:
Home VM/host lists, a VM detail page, Dashboard, Backup, Profile, Settings > XOA-HL
Updates, React Select menus, a confirmation dialog and error notifications.
Specifically verify the Horizon/light sidebar links and success/warning labels, plus a
SortedTable header and dialog close button in every dark palette. Check state-button
hover, focus and active feedback, table row/column highlighting and sparklines.
Verify French/Japanese labels, keyboard focus, sidebar collapse, system switching,
reload, a second account, logout and server preference save failure.

## Upgrade note

Appliance feedback follow-up (#288): verify the labeled connection form above the
server table, VM filter button/input boundaries, disk-import React Select search,
native SR storage-type options, chart axis/title text, empty heatmaps and changing
weekly metrics. About shows host brand/version/build without requiring the optional
host component plugin; the application RPM and appliance image remain separate
version fields. The issue tracker belongs to the XOA-HL section.

The XO 6 preview is a separate Vue application and does not import the XO 5 theme
stylesheet. Its reported loading failure requires an authenticated runtime check:
record HTTP status and response for `/rest/v0/hosts?fields=id,name_label`,
`/rest/v0/dashboard?ndjson=true`, and `/rest/v0/events`, plus the browser console
and corresponding xo-server journal error. Do not record authentication cookies or
tokens. A packaged asset build alone does not validate these runtime requests.

This release intentionally replaces the fixed classic XOA-HL appearance for existing
users. Accounts without an appearance preference start with Arctic/System; users can
select Graphite, Alpine or Horizon and override System with Light or Dark in Profile.
