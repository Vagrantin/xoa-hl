# XO 5.113.2 UI translation audit

XOA-HL is pinned to Xen Orchestra commit `e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c`. The English catalog is the reference. XOA-HL contributes 60 messages, including the update settings, localized minute label, and source-banner text. Every one of those messages now has a nonempty translation in each of the 13 shipped locales. Brand and service names (`XOA-HL`, `xo-server`, `AlmaLinux`) remain in Latin characters. Weekday names use the selected UI locale through `FormattedDate`.

The inherited XO batches now cover 83 shared labels and actions, including status, notifications, VM, backup, storage, network, licensing, certificate, tags, custom fields, and common form terms. Entries already translated in a locale were preserved. `scripts/core-ui-keys.txt` records the scope enforced by CI.

The inherited Xen Orchestra catalog remains incomplete. The following counts come from `python3 scripts/audit-ui-translations.py /path/to/patched/xen-orchestra` after applying all the patches. “Missing” means there is no entry for an English message ID; “undefined” means a locale explicitly declares an untranslated entry. These are distinct ways the UI falls back to English. The catalog contains 2,704 IDs after the XOA-HL patches.

| Locale | Missing IDs | Undefined entries | XOA-HL messages | Core UI |
| --- | ---: | ---: | ---: | ---: |
| Spanish (`es`) | 1,514 | 609 | 60/60 | 83/83 |
| Persian (`fa`) | 1,108 | 0 | 60/60 | 83/83 |
| French (`fr`) | 1,496 | 1 | 60/60 | 83/83 |
| Hebrew (`he`) | 1,688 | 940 | 60/60 | 83/83 |
| Hungarian (`hu`) | 1,574 | 52 | 60/60 | 83/83 |
| Italian (`it`) | 707 | 1 | 60/60 | 83/83 |
| Japanese (`ja`) | 127 | 1,343 | 60/60 | 83/83 |
| Polish (`pl`) | 1,686 | 8 | 60/60 | 83/83 |
| Portuguese (`pt`) | 1,688 | 398 | 60/60 | 83/83 |
| Russian (`ru`) | 162 | 1,634 | 60/60 | 83/83 |
| Swedish (`sv`) | 1,514 | 182 | 60/60 | 83/83 |
| Turkish (`tr`) | 1,111 | 120 | 60/60 | 83/83 |
| Chinese (`zh`) | 1,934 | 2 | 60/60 | 83/83 |

This is **not yet a complete translation of the whole XO interface**. Missing upstream terms need domain review by language. Do not fill gaps with English copies to satisfy a key count: common terms such as VM, host, SR, pool, snapshot, backup, and appliance should be chosen in context for each locale. Review ICU plurals and placeholders, then test actual UI screens at the supported locale, including right-to-left rendering for Persian and Hebrew. The audit script gates XOA-HL messages and the core UI batch while reporting the remaining inherited gaps.

The documentation patch names the home-page links explicitly: “Xen Orchestra doc” points to `https://docs.xen-orchestra.com/`, and “XCP-hl doc” points to `https://xcp-hl.net` in every shipped locale. Japanese uses the clearer `マニュアル` label for these links. The source banner has dedicated localized messages and links to `https://xcp-hl.net`, preventing upstream disclaimer translations from replacing the XOA-HL banner.

To reproduce locally: check out the pinned XO commit, apply `patches/*.patch` in filename order, then run `python3 scripts/audit-ui-translations.py <checkout>`. The `Validate XO patches` workflow performs the same checks on pull requests.
