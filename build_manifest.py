#!/usr/bin/env python3
"""Regenerate data/manifest.json for static/GitHub Pages deployment."""
from pathlib import Path
import json

root = Path(__file__).resolve().parent
data = root / 'data'
data.mkdir(exist_ok=True)
files = []
for p in sorted(data.iterdir(), key=lambda x: x.name.casefold()):
    if not p.is_file() or p.name == 'manifest.json' or p.suffix.lower() not in {'.json', '.jsonl', '.ndjson'}:
        continue
    st = p.stat()
    files.append({'name': p.name, 'path': p.name, 'size': st.st_size, 'modified': int(st.st_mtime)})
(data / 'manifest.json').write_text(json.dumps({'version': 1, 'files': files}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Wrote data/manifest.json with {len(files)} file(s).')
