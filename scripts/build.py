"""Produce the flat distribution HACS downloads, using only the Python stdlib."""
from pathlib import Path
import argparse
import json

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
parser = argparse.ArgumentParser()
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
files = {
    'gardena-mower-card.js': (ROOT / 'src/gardena-mower-card.js').read_text().replace('__VERSION__', VERSION).encode(),
    'scene.css': (ROOT / 'src/scene.css').read_bytes(),
    'THIRD_PARTY_NOTICES.md': (ROOT / 'THIRD_PARTY_NOTICES.md').read_bytes(),
}
files.update({p.name: p.read_bytes() for p in (ROOT / 'assets').iterdir() if p.is_file()})
dist = ROOT / 'dist'
if args.check:
    assert dist.exists(), 'Run python3 scripts/build.py first'
    assert set(files) == {p.name for p in dist.iterdir()}, 'Unexpected/missing distribution files'
    for name, data in files.items():
        assert (dist / name).read_bytes() == data, f'Stale distribution: {name}'
    print('Distribution is complete and reproducible.')
else:
    dist.mkdir(exist_ok=True)
    for name, data in files.items():
        (dist / name).write_bytes(data)
    print(f'Built Gardena Mower Card {VERSION}: {len(files)} files')
