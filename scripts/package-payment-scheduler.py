#!/usr/bin/env python3
"""Build a scheduler-only repair from the verified active ZIP. No cloud operations."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

CHANGED_FILES = {
    'src/shared/server/phase3-integrations.mjs',
    'src/shared/server/phase3-service.mjs',
    'src/production-scheduler.mjs',
}
VERIFIED_BASE_SHA256 = '3c8e52bae55141a775457555a067faf8388df8e5af84fdd5881e78a3c2f8967d'


def build(source, destination, stage=None, patch_path=None):
    source, destination = Path(source), Path(destination)
    if hashlib.sha256(source.read_bytes()).hexdigest() != VERIFIED_BASE_SHA256:
        raise ValueError('Source ZIP does not match the verified deployed package')
    patch = Path(patch_path) if patch_path else Path(__file__).resolve().parents[1] / 'infrastructure/production-deployment/stripe-payment-scheduler/expiry-review.patch'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='blorenge-scheduler-repair-') as temporary:
        work = Path(temporary)
        with zipfile.ZipFile(source) as original:
            if original.testzip() is not None:
                raise ValueError('Source archive integrity failed')
            for name in CHANGED_FILES:
                target = work / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(original.read(name))
            subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-i', str(patch)], cwd=work, check=True, capture_output=True)
            with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as output:
                for info in original.infolist():
                    content = (work / info.filename).read_bytes() if info.filename in CHANGED_FILES else original.read(info.filename)
                    output.writestr(copy.copy(info), content)
            with zipfile.ZipFile(destination) as output:
                if original.namelist() != output.namelist() or output.testzip() is not None:
                    raise ValueError('Output inventory or integrity failed')
                changed = {name for name in original.namelist() if original.read(name) != output.read(name)}
                if changed != CHANGED_FILES:
                    raise ValueError('Unexpected scheduler package changes')
                # The domain module, over-offering guard, dependencies and runtime files remain identical.
                if stage:
                    stage = Path(stage)
                    for info in output.infolist():
                        target = (stage / info.filename).resolve()
                        if not target.is_relative_to(stage.resolve()):
                            raise ValueError('Unsafe ZIP entry')
                        if info.is_dir():
                            target.mkdir(parents=True, exist_ok=True)
                        else:
                            target.parent.mkdir(parents=True, exist_ok=True)
                            target.write_bytes(output.read(info.filename))
                return {'baseSha256': VERIFIED_BASE_SHA256,
                        'schedulerZipSha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                        'schedulerZipBytes': destination.stat().st_size,
                        'fileCount': len(output.namelist()), 'changedFiles': sorted(changed),
                        'domainAndOverOfferingGuardUnchangedFromDeployed': True,
                        'allOtherFilesByteIdentical': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('destination')
    parser.add_argument('--stage')
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.destination, args.stage), indent=2))
