# XO 5.113.2 UI translation audit

XOA-HL is pinned to Xen Orchestra commit `e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c`. The English catalog is the reference. The update settings added by XOA-HL contribute 49 messages, including the localized minute label. Every one of those messages now has a nonempty translation in each of the 13 shipped locales. Brand and service names (`XOA-HL`, `xo-server`, `AlmaLinux`) remain in Latin characters. Weekday names use the selected UI locale through `FormattedDate`.

The inherited Xen Orchestra catalog remains incomplete. The following counts come from `python3 scripts/audit-ui-translations.py /path/to/patched/xen-orchestra` after applying the four patches. “Missing” means there is no entry for an English message ID; “undefined” means a locale explicitly declares an untranslated entry. These are distinct ways the UI falls back to English. The catalog contains 2,698 IDs after the XOA-HL patch.

| Locale | Missing IDs | Undefined entries | XOA-HL messages |
| --- | ---: | ---: | ---: |
| Spanish (`es`) | 1,597 | 609 | 49/49 |
| Persian (`fa`) | 1,191 | 0 | 49/49 |
| French (`fr`) | 1,579 | 1 | 49/49 |
| Hebrew (`he`) | 1,771 | 940 | 49/49 |
| Hungarian (`hu`) | 1,657 | 52 | 49/49 |
| Italian (`it`) | 757 | 1 | 49/49 |
| Japanese (`ja`) | 128 | 1,425 | 49/49 |
| Polish (`pl`) | 1,769 | 8 | 49/49 |
| Portuguese (`pt`) | 1,771 | 398 | 49/49 |
| Russian (`ru`) | 163 | 1,716 | 49/49 |
| Swedish (`sv`) | 1,597 | 183 | 49/49 |
| Turkish (`tr`) | 1,194 | 120 | 49/49 |
| Chinese (`zh`) | 2,017 | 2 | 49/49 |

This is **not yet a complete translation of the whole XO interface**. Missing upstream terms need domain review by language. Do not fill gaps with English copies to satisfy a key count: common terms such as VM, host, SR, pool, snapshot, backup, and appliance should be chosen in context for each locale. Review ICU plurals and placeholders, then test actual UI screens at the supported locale, including right-to-left rendering for Persian and Hebrew. The audit script is a CI gate for XOA-HL's own messages and a visibility report for the inherited catalog; it does not mark upstream gaps complete.

To reproduce locally: check out the pinned XO commit, apply `patches/*.patch` in filename order, then run `python3 scripts/audit-ui-translations.py <checkout>`. The `Validate XO patches` workflow performs the same checks on pull requests.
