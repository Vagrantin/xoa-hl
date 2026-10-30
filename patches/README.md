# Patch naming and order

Use `NNN-descriptive-name.patch` for new patches, with three-digit numbers and
gaps between them. Do not prepend repeated letters to influence shell sorting.
The three established base filenames remain stable because other repositories
reference them: `menu-hide-items.patch`, `xcp-hl-updates.patch` and
`xoa-hl-update-api.patch`.

`series` declares the application order. Every patch must occur exactly once;
missing, duplicate, unlisted and unsafe paths fail before application. The build,
source validation and release notes all read it through `scripts/list-patches.sh`.
Metadata IDs match filenames without the suffix; each dependency must precede
its consumer in `series`. CI checks the filename/metadata contracts and applies
the complete series to the immutable upstream pin.
