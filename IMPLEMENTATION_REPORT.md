# Implementation report — Knowledge layer + viewer preservation

## Implemented

- Mixed-source loader: legacy TEXTREUSE JSON + corpus JSON/JSONL/NDJSON.
- Passage Registry with Resource/Passage IDs, normalized/original text, word selectors, versions, version sources, references, DTS metadata and provenance.
- Explicit text-reuse relation object while retaining the legacy candidate structure.
- Normalized alignment inspector with direct/matrix/HTML-inferred provenance and `synopsis_table` access.
- Local Corpus Resolver + optional DTS Resolver + existing Sefaria resolver behind a common ResolverHub.
- Existing Genizah and VRR branches retained; explicit `source_family` / `provider` / `source_type` can mark local/custom/DTS/non-Sefaria sources.
- Multi-dataset combine preserves source variants/raw records/provenance rather than silently discarding alternate record metadata.
- Analysis/original text toggle in reading and synopsis views.
- Local provenance/resource information integrated into metadata cards, synopsis metadata, library, diagnostics, heatmap/network/scatter tooltips and CSV export.
- Server discovery expanded to `.json`, `.jsonl`, `.ndjson`.

## Compatibility guarantees checked

- Original tab order preserved exactly: read, synopsis, reverse, matrix, network, scatter, library, diagnostics.
- All 150 named functions originally declared in `app.js` remain present.
- All original DataModel, SefariaService and GenizahService methods remain present.
- Legacy dataset combine and synopsis CSV tests still pass.
- New tests cover NDJSON parsing, Registry lookup, local/non-Sefaria source families, Registry enrichment, explicit relations, all major DataModel visualization data paths and enriched CSV export.
- The supplied Menorat HaMaor corpus parses as 1,381 passages in one Resource, including original text, version provenance and word-range selectors.

## Automated QA commands

```bash
node --test tests/*.test.js
python3 -m pytest -q tests/test_start_server.py
node -c app.js
node -c data-model.js
node -c data-adapters.js
node -c knowledge.js
node -c resolvers.js
node -c utils.js
node -c visualizations.js
python3 -m py_compile start_server.py
git diff --check
```

The visual changes are additive and use the existing CSS variables/components. Extended research metadata is placed in collapsible `details` panels so the default interface remains close to the original density and appearance.
