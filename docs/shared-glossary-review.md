# Shared terminology in the XO5 translation audit

Tracking: [xcp-hl #189](https://github.com/Vagrantin/xcp-hl/issues/189),
[D6 #201](https://github.com/Vagrantin/xcp-hl/issues/201), and
[UI translation #131](https://github.com/Vagrantin/xcp-hl/issues/131).

`Validate XO patches` consumes the documentation glossary from **xcp-hl**, after
applying the XOA-HL patch series to the XO5 source selected by `UPSTREAM_XO`.
The source is fixed by `scripts/ui-glossary-source.json`: repository, full commit
SHA and glossary content SHA-256. It uses the export contract delivered by
[xcp-hl #214](https://github.com/Vagrantin/xcp-hl/pull/214), merged as
`4c66ea6e05cf98c11df86ce5e34d5b0415647a1c`.

This consumes one shared term source; no second glossary or runtime catalog is
generated. The glossary is editorial input. Its documentation translations are
still drafts, and this comparison does not grant human approval to either UI
labels or documentation. Installed UI behavior remains unverified.

## CI evidence

The workflow checks out that exact documentation commit, runs its glossary
exporter, and verifies the export's source, schema, locale coverage and content
identity. It rejects a moving ref, a changed checkout, malformed/incomplete terms,
an unknown mapping or an English catalog key that does not exist. Existing
13-locale XOA-HL/core-message and ICU checks still run independently.

The `xoa-ui-glossary-review` artifact contains:

- `glossary.json`: the eight shared terms and their EN/FR/JA definitions.
- `comparison.json`: 24 term/locale rows, actual XOA-HL CI checkout and upstream
  XO commit identities, documentation commit/content identity, mapped UI message
  literals, catalog gaps and pending review status.
- `ui-glossary-source.json` and `ui-glossary-map.json`: the source pin and context
  mapping used by the run.

The artifact is retained for 14 days. Preserve its run/commit identities in the
tracking issue and attach lasting review evidence before it expires. Failed
consumer validation writes `fatalError` where an output path is available; the
upload step runs even on failure. An earlier checkout/export failure may leave
only partial evidence and must not be mistaken for a successful comparison.

`messageLiteral` preserves the catalog's JavaScript string spelling, including
quotes and ICU syntax; it is not evaluated. A missing/non-string message has no
English substitute in the report. All mapped rows remain `pending`, even when
the strings appear identical. XO Lite is recorded as `not-mapped`, with a reason:
it is a separate host-served product, not a mapped XO5 catalog term.

Missing, undefined, duplicate and empty locale entries become explicit
`catalogGaps`. They do not fail this editorial comparison; the existing required
message audit continues to gate its own scope. The initial pinned patched source
has four such gaps: French `sr`/`vm` are absent, and Japanese `sr`/`vm` are
`undefined`. Abbreviations such as VM/SR and noun/action or singular/plural labels
need contextual review, not forced literal equality with a glossary definition.

## Review or update terminology

1. Start with the artifact from the exact application PR/run being reviewed.
   Verify its documentation/XOA-HL/XO identities. CI normally checks the PR's
   synthetic merge commit; the report records that actual checkout SHA rather
   than claiming it is the PR head.
2. Compare each mapped English UI label and actual screen context against the
   glossary definition. A language reviewer checks common French/Japanese terms,
   brand names, noun/action differences, abbreviations and ICU placeholders.
   Technical review checks that the instruction and UI refer to the same object.
3. Record the reviewed scope and identities in #131/#201. Fix UI strings in the
   ordinary XOA-HL patch workflow; this report never rewrites them or marks them
   approved. Verify real screens at the release identified in that review.
4. Propose glossary changes in `Vagrantin/xcp-hl/site/data/xoa_glossary.json`.
   Let documentation review/freshness checks identify affected translations.
   Do not fork definitions here or copy English into missing localized entries.
5. After the documentation change is accepted, update the immutable commit and
   glossary revision in `ui-glossary-source.json` in a separate reviewed PR.
   Update `ui-glossary-map.json` if IDs/context change. Every exported term needs
   a mapping or an explicit reason for having none. CI will not follow a moving
   documentation branch or silently adopt a changed glossary.

The map is a focused terminology starting point, not exhaustive UI-message
coverage. Full catalog translation, named language owners and human review
remain open under #131/#201. No glossary record or successful CI run establishes
that the released appliance has passed language or lab acceptance.

## Reproduce the comparison

Use the already patched XO checkout used by the existing translation audit and
the exact documentation commit from the source pin. Export the glossary with
that documentation checkout's script, then run from the XOA-HL repository:

```bash
python3 /path/to/pinned/xcp-hl/site/scripts/export_xoa_glossary.py --output /tmp/glossary.json
python3 scripts/audit-shared-glossary.py \
  --export /tmp/glossary.json \
  --xo-source /path/to/patched/xen-orchestra \
  --docs-commit "$(git -C /path/to/pinned/xcp-hl rev-parse HEAD)" \
  --xoa-commit "$(git rev-parse HEAD)" \
  --xo-commit "$(git -C /path/to/patched/xen-orchestra rev-parse HEAD)" \
  --output /tmp/comparison.json
python3 -m unittest tests/test-shared-glossary.py
```

This runs source/report checks; it does not build an RPM or launch an appliance.
