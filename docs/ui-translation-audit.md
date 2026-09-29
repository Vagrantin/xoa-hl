# XO 5.113.2 UI translation audit

XOA-HL is pinned to Xen Orchestra commit `e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c`. The English catalog is the reference. The update settings added by XOA-HL contribute 49 messages, including the localized minute label. Every one of those messages now has a nonempty translation in each of the 13 shipped locales. Brand and service names (`XOA-HL`, `xo-server`, `AlmaLinux`) remain in Latin characters. Weekday names use the selected UI locale through `FormattedDate`.

The inherited XO batches now cover 66 shared labels and actions, including status, notifications, VM, backup, storage, network, licensing, certificate, and common form terms. Entries already translated in a locale were preserved. `scripts/core-ui-keys.txt` records the scope enforced by CI.

The inherited Xen Orchestra catalog remains incomplete. The following counts come from `python3 scripts/audit-ui-translations.py /path/to/patched/xen-orchestra` after applying the six patches. “Missing” means there is no entry for an English message ID; “undefined” means a locale explicitly declares an untranslated entry. These are distinct ways the UI falls back to English. The catalog contains 2,698 IDs after the XOA-HL patch.

| Locale | Missing IDs | Undefined entries | XOA-HL messages | Core UI |
| --- | ---: | ---: | ---: | ---: |
| Spanish (`es`) | 1,531 | 609 | 49/49 | 66/66 |
| Persian (`fa`) | 1,125 | 0 | 49/49 | 66/66 |
| French (`fr`) | 1,513 | 1 | 49/49 | 66/66 |
| Hebrew (`he`) | 1,705 | 940 | 49/49 | 66/66 |
| Hungarian (`hu`) | 1,591 | 52 | 49/49 | 66/66 |
| Italian (`it`) | 724 | 1 | 49/49 | 66/66 |
| Japanese (`ja`) | 128 | 1,359 | 49/49 | 66/66 |
| Polish (`pl`) | 1,703 | 8 | 49/49 | 66/66 |
| Portuguese (`pt`) | 1,705 | 398 | 49/49 | 66/66 |
| Russian (`ru`) | 163 | 1,650 | 49/49 | 66/66 |
| Swedish (`sv`) | 1,531 | 183 | 49/49 | 66/66 |
| Turkish (`tr`) | 1,128 | 120 | 49/49 | 66/66 |
| Chinese (`zh`) | 1,951 | 2 | 49/49 | 66/66 |

This is **not yet a complete translation of the whole XO interface**. Missing upstream terms need domain review by language. Do not fill gaps with English copies to satisfy a key count: common terms such as VM, host, SR, pool, snapshot, backup, and appliance should be chosen in context for each locale. Review ICU plurals and placeholders, then test actual UI screens at the supported locale, including right-to-left rendering for Persian and Hebrew. The audit script gates XOA-HL messages and the core UI batch while reporting the remaining inherited gaps.

To reproduce locally: check out the pinned XO commit, apply `patches/*.patch` in filename order, then run `python3 scripts/audit-ui-translations.py <checkout>`. The `Validate XO patches` workflow performs the same checks on pull requests.
