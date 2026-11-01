# XO 5.113.2 UI translation audit

XOA-HL is pinned to Xen Orchestra commit `e281c536d3b1e97ccfb3b0826f91b7dbb6c4478c`. The English catalog is the reference. XOA-HL contributes 70 messages, including the update settings, localized minute label, and source-banner text. Every one of those messages now has a nonempty translation in each of the 13 shipped locales. Brand and service names (`XOA-HL`, `xo-server`, `AlmaLinux`) remain in Latin characters. Weekday names use the selected UI locale through `FormattedDate`.

The inherited XO batches now cover 96 shared labels and actions, including status, notifications, VM, backup, storage, network, licensing, certificate, tags, custom fields, and common form terms. The Dashboard report and update cards, Backup table and logs, and Jobs schedules and logs are included (xcp-hl#346). Existing translations are preserved; English placeholders on these pages are replaced. `scripts/core-ui-keys.txt` records the scope enforced by CI.

The pages captured in the XOA-HL user documentation (user, servers, about, SR disks, new VM, VM console and VM disks) are translated in French and Japanese, the documentation languages. `scripts/docs-pages-ui-keys.txt` lists those 183 keys, and the audit enforces them for `fr` and `ja` only (xcp-hl#285).

The inherited Xen Orchestra catalog remains incomplete. The following counts come from `python3 scripts/audit-ui-translations.py /path/to/patched/xen-orchestra` after applying all the patches. “Missing” means there is no entry for an English message ID; “undefined” means a locale explicitly declares an untranslated entry. These are distinct ways the UI falls back to English. The catalog contains 2,719 IDs after the XOA-HL patches.

| Locale | Missing IDs | Undefined entries | XOA-HL messages | Core UI |
| --- | ---: | ---: | ---: | ---: |
| Spanish (`es`) | 1,505 | 608 | 70/70 | 96/96 |
| Persian (`fa`) | 1,106 | 0 | 70/70 | 96/96 |
| French (`fr`) | 1,387 | 1 | 70/70 | 96/96 |
| Hebrew (`he`) | 1,679 | 936 | 70/70 | 96/96 |
| Hungarian (`hu`) | 1,565 | 52 | 70/70 | 96/96 |
| Italian (`it`) | 706 | 1 | 70/70 | 96/96 |
| Japanese (`ja`) | 122 | 1,253 | 70/70 | 96/96 |
| Polish (`pl`) | 1,677 | 8 | 70/70 | 96/96 |
| Portuguese (`pt`) | 1,679 | 397 | 70/70 | 96/96 |
| Russian (`ru`) | 161 | 1,625 | 70/70 | 96/96 |
| Swedish (`sv`) | 1,505 | 182 | 70/70 | 96/96 |
| Turkish (`tr`) | 1,109 | 117 | 70/70 | 96/96 |
| Chinese (`zh`) | 1,924 | 2 | 70/70 | 96/96 |

This is **not yet a complete translation of the whole XO interface**. Missing upstream terms need domain review by language. Do not fill gaps with English copies to satisfy a key count: common terms such as VM, host, SR, pool, snapshot, backup, and appliance should be chosen in context for each locale. Review ICU plurals and placeholders, then test actual UI screens at the supported locale, including right-to-left rendering for Persian and Hebrew. The audit script gates XOA-HL messages and the core UI batch while reporting the remaining inherited gaps.

The documentation patch names the home-page links explicitly: “Xen Orchestra doc” points to `https://docs.xen-orchestra.com/`, and “XCP-hl doc” points to `https://xcp-hl.net` in every shipped locale. Japanese uses the clearer `マニュアル` label for these links. The source banner has dedicated localized messages and links to `https://xcp-hl.net`, preventing upstream disclaimer translations from replacing the XOA-HL banner.

To reproduce locally: check out the pinned XO commit, apply the patches in `patches/series` order, then run `python3 scripts/audit-ui-translations.py <checkout>`. The `Validate XO patches` workflow performs the same checks on pull requests.

The workflow also consumes the pinned EN/FR/JA documentation glossary from
`xcp-hl` and uploads a comparison artifact with mapped UI labels, explicit gaps
and pending human review. See [shared glossary review](shared-glossary-review.md)
for the immutable source pin, report contract and terminology update process.
The comparison does not replace this catalog coverage/ICU audit or approve
translations automatically.
