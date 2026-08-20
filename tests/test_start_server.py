from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import start_server


def test_parse_bom_prefixed_json(tmp_path):
    payload = '{"ok": true}'
    path = tmp_path / 'bom.json'
    path.write_bytes(b'\xef\xbb\xbf' + payload.encode('utf-8'))

    import json

    parsed = json.loads(path.read_text(encoding='utf-8-sig'))

    assert parsed['ok'] is True


def test_discover_json_files_from_sibling_dataset(tmp_path):
    app_dir = tmp_path / 'app'
    app_dir.mkdir()
    dataset_dir = tmp_path / 'dataset'
    dataset_dir.mkdir()
    (dataset_dir / 'example.json').write_text('{"ok": true}', encoding='utf-8')

    discovered = start_server.discover_json_files(app_dir)

    assert any(path.name == 'example.json' and path.parent.name == 'dataset' for path in discovered)


def test_discover_ndjson_and_jsonl_files(tmp_path):
    app_dir = tmp_path / 'app'
    app_dir.mkdir()
    dataset_dir = tmp_path / 'dataset'
    dataset_dir.mkdir()
    (dataset_dir / 'corpus.ndjson').write_text('{"location":"Book__1","sentence":"a"}\n{"location":"Book__2","sentence":"b"}', encoding='utf-8')
    (dataset_dir / 'corpus.jsonl').write_text('{"location":"Book__1","sentence":"a"}', encoding='utf-8')

    discovered = start_server.discover_json_files(app_dir)
    names = {path.name for path in discovered}

    assert 'corpus.ndjson' in names
    assert 'corpus.jsonl' in names
