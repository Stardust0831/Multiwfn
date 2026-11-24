"""Download an existing CI package and verify its run, source and artifact digest."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run', required=True, type=int)
parser.add_argument('--head', required=True)
parser.add_argument('--artifact', required=True)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
repo = 'Stardust0831/Multiwfn'


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', f'repos/{repo}/{path}']))


run = api(f'actions/runs/{args.run}')
assert run['head_sha'] == args.head, 'package source SHA differs from requested source'
assert run['conclusion'] == 'success', 'source package workflow did not pass'
artifacts = api(f'actions/runs/{args.run}/artifacts')['artifacts']
artifact = next(a for a in artifacts if a['name'] == args.artifact and not a['expired'])
args.output.mkdir(parents=True, exist_ok=True)
archive = args.output / 'artifact.zip'
with archive.open('wb') as output:
    subprocess.run(['gh', 'api', f"repos/{repo}/actions/artifacts/{artifact['id']}/zip"],
                   stdout=output, check=True)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
assert artifact['digest'] == f'sha256:{digest}', 'artifact digest mismatch'
with zipfile.ZipFile(archive) as zipped:
    zipped.extractall(args.output / 'payload')
provenance = {'source_run': args.run, 'source_head': args.head,
              'artifact': artifact, 'verified_sha256': digest,
              'payloads': [{'name': p.name, 'bytes': p.stat().st_size,
                            'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                           for p in (args.output / 'payload').iterdir() if p.is_file()]}
(args.output / 'provenance.json').write_text(json.dumps(provenance, indent=2))
print(json.dumps(provenance, indent=2))
