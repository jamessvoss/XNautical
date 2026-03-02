#!/usr/bin/env python3
"""
Parallel Region Provisioning

Batch provisioning script that creates Alaska sub-regions and optionally
re-provisions standard CGD districts — all in PARALLEL. Each region fires
off its own Cloud Run instances simultaneously.

Usage:
    python3 create_alaska_regions.py                           # Alaska sub-regions only (all 6 in parallel)
    python3 create_alaska_regions.py --all                     # ALL districts + Alaska sub-regions in parallel
    python3 create_alaska_regions.py --districts 01cgd 07cgd   # Specific standard districts only
    python3 create_alaska_regions.py --region 17cgd-Juneau     # Single Alaska sub-region
    python3 create_alaska_regions.py --dry-run                 # Discovery only
    python3 create_alaska_regions.py --skip-generators         # Storage + Firestore only
    python3 create_alaska_regions.py --skip-provisioning       # Skip create_test_district, run discovery + metadata only
    python3 create_alaska_regions.py --sequential              # Run one at a time

Pipeline per region (in its own parallel thread):
  1. create_test_district.py --source {source} --bounds ... --name {region}
     (ENC chart copy, GNIS copy, Firestore doc, ENC conversion, imagery, predictions, metadata)

After all regions complete:
  2. discover-marine-zones.js --district={region} (all in parallel)
  3. discover-ndbc-buoys.js (runs once for all districts)
  4. Re-generate metadata (all in parallel)
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger(__name__)

# ============================================================================
# Region Definitions — loaded from master config (config/regions.json)
# ============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..'))
MASTER_CONFIG_PATH = os.path.join(PROJECT_ROOT, 'config', 'regions.json')

try:
    with open(MASTER_CONFIG_PATH) as f:
        _master_config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError) as e:
    logger.error(f'Failed to load master config from {MASTER_CONFIG_PATH}: {e}')
    sys.exit(1)

# Build provisioning dicts from master config
# Each entry needs: name, source, bounds (and optionally expected_charts)
def _build_region_dicts():
    standard = {}
    alaska = {}
    known_groups = {None, 'alaska', 'test', 'subregion'}
    for region_id, cfg in _master_config['regions'].items():
        # Normalize bounds: regions.json may use a single dict or a list of dicts
        raw_bounds = cfg['bounds']
        if isinstance(raw_bounds, list):
            # Multi-rectangle bounds (e.g. 17cgd antimeridian crossing)
            bounds = raw_bounds[0] if len(raw_bounds) == 1 else raw_bounds
        else:
            bounds = raw_bounds
        entry = {
            'name': cfg['name'],
            'source': cfg['sourceDistrict'],
            'bounds': bounds,
        }
        group = cfg.get('group')
        if group == 'test':
            continue  # Skip test regions
        if group not in known_groups:
            logger.warning(f'Unknown group "{group}" for region {region_id} — treating as standard')
        if group == 'alaska':
            alaska[region_id] = entry
        else:
            standard[region_id] = entry
    return standard, alaska

STANDARD_DISTRICTS, ALASKA_REGIONS = _build_region_dicts()
ALL_REGIONS = {**STANDARD_DISTRICTS, **ALASKA_REGIONS}

# Path constants (SCRIPT_DIR and PROJECT_ROOT defined above during config loading)
CREATE_DISTRICT_SCRIPT = os.path.join(SCRIPT_DIR, 'create_test_district.py')
MARINE_ZONES_SCRIPT = os.path.join(PROJECT_ROOT, 'scripts', 'discover-marine-zones.js')
NDBC_BUOYS_SCRIPT = os.path.join(PROJECT_ROOT, 'scripts', 'discover-ndbc-buoys.js')


# ============================================================================
# Execution helpers
# ============================================================================

def run_command(cmd, description, dry_run=False):
    """Run a shell command with logging."""
    logger.info(f'  → {description}')
    logger.info(f'    $ {" ".join(cmd)}')

    if dry_run:
        logger.info('    [DRY RUN - skipped]')
        return 0

    try:
        result = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=False,
            text=True,
        )
        if result.returncode != 0:
            logger.error(f'    ✗ Command failed with exit code {result.returncode}')
        return result.returncode
    except Exception as e:
        logger.error(f'    ✗ Command failed: {e}')
        return 1


def provision_region(region_id, region_config, args, index=0):
    """Run the full provisioning pipeline for a single region.

    Designed to run in its own thread — each region gets its own
    create_test_district.py subprocess which spins up independent
    Cloud Run instances for ENC conversion, imagery, and predictions.

    The index parameter is used to stagger prediction starts across
    parallel districts to avoid overwhelming the NOAA API.
    """
    threading.current_thread().name = region_id

    source = region_config['source']
    bounds_json = json.dumps(region_config['bounds'])
    expected = region_config.get('expected_charts', '?')

    logger.info(f'{"=" * 60}')
    logger.info(f'Provisioning: {region_id} ({region_config["name"]})')
    logger.info(f'Source: {source}')
    logger.info(f'Bounds: {bounds_json}')
    logger.info(f'Expected charts: ~{expected}')
    logger.info(f'{"=" * 60}')

    cmd = [
        sys.executable, CREATE_DISTRICT_SCRIPT,
        '--source', source,
        '--bounds', bounds_json,
        '--name', region_id,
    ]
    if args.dry_run:
        cmd.append('--dry-run')
    if args.skip_generators:
        cmd.append('--skip-generators')
    if args.timeout:
        cmd.extend(['--timeout', str(args.timeout)])
    if args.resume:
        cmd.append('--resume')
    # Stagger predictions to avoid NOAA rate limiting
    prediction_delay = index * args.prediction_stagger
    if prediction_delay > 0:
        cmd.extend(['--prediction-delay', str(prediction_delay)])

    rc = run_command(cmd, f'create_test_district.py for {region_id}')
    if rc != 0:
        logger.error(f'Failed to provision {region_id} (exit code {rc})')
        return region_id, False

    logger.info(f'✓ {region_id} provisioning complete')
    return region_id, True


# ============================================================================
# Discovery helpers (marine zones, buoys, metadata)
# ============================================================================

def _run_marine_zone_single(region_id, dry_run=False):
    """Run marine zone discovery for a single region (thread target)."""
    threading.current_thread().name = f'zones-{region_id}'
    cmd = ['node', MARINE_ZONES_SCRIPT, f'--district={region_id}']
    if dry_run:
        cmd.append('--dry-run')
    rc = run_command(cmd, f'Marine zones for {region_id}', dry_run=dry_run)
    if rc != 0:
        logger.warning(f'Marine zone discovery failed for {region_id} (non-fatal)')
    return region_id, rc == 0


def run_marine_zones(region_ids, dry_run=False):
    """Run discover-marine-zones.js for all regions in parallel."""
    logger.info(f'\n{"=" * 60}')
    logger.info(f'Running marine zone discovery ({len(region_ids)} regions in parallel)')
    logger.info(f'{"=" * 60}')

    with ThreadPoolExecutor(max_workers=len(region_ids)) as executor:
        futures = {
            executor.submit(_run_marine_zone_single, rid, dry_run): rid
            for rid in region_ids
        }
        for future in as_completed(futures):
            rid = futures[future]
            try:
                _, ok = future.result()
                if ok:
                    logger.info(f'✓ Marine zones complete for {rid}')
            except Exception as e:
                logger.warning(f'Marine zone exception for {rid}: {e}')


def run_ndbc_buoys(dry_run=False):
    """Run discover-ndbc-buoys.js (processes all districts at once)."""
    logger.info(f'\n{"=" * 60}')
    logger.info('Running NDBC buoy discovery (all districts)')
    logger.info(f'{"=" * 60}')

    cmd = ['node', NDBC_BUOYS_SCRIPT]
    if dry_run:
        cmd.append('--dry-run')
    rc = run_command(cmd, 'NDBC buoy discovery', dry_run=False)
    if rc != 0:
        logger.warning('NDBC buoy discovery failed (non-fatal)')


_metadata_url_cache = None
_metadata_url_lock = threading.Lock()

def _get_metadata_url():
    """Discover the metadata service URL from Cloud Run (cached)."""
    global _metadata_url_cache
    with _metadata_url_lock:
        if _metadata_url_cache:
            return _metadata_url_cache
        try:
            url = subprocess.check_output([
                'gcloud', 'run', 'services', 'describe', 'district-metadata',
                '--region=us-central1', '--project=xnautical-8a296',
                '--format=value(status.url)',
            ], text=True).strip()
            _metadata_url_cache = url
            return url
        except Exception as e:
            logger.warning(f'Could not discover metadata URL: {e}')
            return None


def _regenerate_metadata_single(region_id):
    """Regenerate metadata for a single region (thread target)."""
    threading.current_thread().name = f'meta-{region_id}'
    logger.info(f'  → Metadata for {region_id}')
    base_url = _get_metadata_url()
    if not base_url:
        logger.warning(f'  ✗ No metadata service URL for {region_id}')
        return region_id, False
    url = f'{base_url}/generateMetadata'
    try:
        token = subprocess.check_output(
            ['gcloud', 'auth', 'print-identity-token'], text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        logger.warning(f'  ✗ Failed to get auth token for {region_id}: {e}')
        return region_id, False
    try:
        resp = requests.post(
            url,
            json={'districtId': region_id},
            headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
            timeout=300,
        )
        if resp.status_code == 200:
            logger.info(f'  ✓ Metadata complete for {region_id}')
            return region_id, True
        else:
            logger.warning(f'  ✗ Metadata generation failed for {region_id} (HTTP {resp.status_code}): {resp.text[:200]}')
            return region_id, False
    except Exception as e:
        logger.warning(f'  ✗ Metadata generation failed for {region_id}: {e}')
        return region_id, False


def regenerate_metadata(region_ids, dry_run=False):
    """Re-generate download metadata for all regions in parallel."""
    if dry_run:
        logger.info('Skipping metadata regeneration (dry run)')
        return

    logger.info(f'\n{"=" * 60}')
    logger.info(f'Regenerating download metadata ({len(region_ids)} regions in parallel)')
    logger.info(f'{"=" * 60}')

    with ThreadPoolExecutor(max_workers=len(region_ids)) as executor:
        futures = {
            executor.submit(_regenerate_metadata_single, rid): rid
            for rid in region_ids
        }
        for future in as_completed(futures):
            rid = futures[future]
            try:
                future.result()
            except Exception as e:
                logger.warning(f'Metadata exception for {rid}: {e}')


# ============================================================================
# Main
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Parallel region provisioning — Alaska sub-regions and/or standard CGD districts',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    # What to provision
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--all', action='store_true',
                       help='All districts + sub-regions in parallel')
    group.add_argument('--districts', nargs='+', metavar='ID',
                       help='Specific district IDs to provision (e.g., 01cgd 07cgd 17cgd-Juneau)')
    group.add_argument('--region',
                       help='Single region ID (e.g., 17cgd-Juneau, 07cgd)')
    group.add_argument('--alaska-only', action='store_true', default=True,
                       help='Alaska sub-regions only (default)')

    # How to run
    parser.add_argument('--dry-run', action='store_true',
                        help='Discovery only — no copies, no triggers')
    parser.add_argument('--skip-generators', action='store_true',
                        help='Only set up Storage + Firestore, skip generation triggers')
    parser.add_argument('--skip-discovery', action='store_true',
                        help='Skip marine zones and buoy discovery')
    parser.add_argument('--skip-provisioning', action='store_true',
                        help='Skip create_test_district, run discovery + metadata only')
    parser.add_argument('--sequential', action='store_true',
                        help='Run regions one at a time instead of in parallel')
    parser.add_argument('--timeout', type=int, default=7200,
                        help='Max wait seconds per generator (default: 7200)')
    parser.add_argument('--resume', action='store_true',
                        help='Resume from last checkpoint — skip completed phases per district')
    parser.add_argument('--prediction-stagger', type=int, default=45,
                        help='Seconds between prediction starts per district (NOAA rate limit, default: 45)')

    args = parser.parse_args()

    # Determine which regions to process
    if args.all:
        regions_to_process = dict(ALL_REGIONS)
    elif args.districts:
        regions_to_process = {}
        for d in args.districts:
            if d in ALL_REGIONS:
                regions_to_process[d] = ALL_REGIONS[d]
            else:
                parser.error(
                    f'Unknown region: {d}. '
                    f'Valid: {", ".join(sorted(ALL_REGIONS.keys()))}'
                )
    elif args.region:
        if args.region not in ALL_REGIONS:
            parser.error(
                f'Unknown region: {args.region}. '
                f'Valid: {", ".join(sorted(ALL_REGIONS.keys()))}'
            )
        regions_to_process = {args.region: ALL_REGIONS[args.region]}
    else:
        # Default: Alaska sub-regions only
        regions_to_process = dict(ALASKA_REGIONS)

    region_ids = list(regions_to_process.keys())
    parallel = not args.sequential and len(regions_to_process) > 1
    mode = 'parallel' if parallel else 'sequential'

    logger.info(f'========================================')
    logger.info(f'Region Provisioning')
    logger.info(f'Regions: {len(region_ids)} ({mode})')
    for rid in region_ids:
        logger.info(f'  • {rid} ({regions_to_process[rid]["name"]})')
    logger.info(f'Dry run: {args.dry_run}')
    logger.info(f'Skip provisioning: {args.skip_provisioning}')
    logger.info(f'Skip generators: {args.skip_generators}')
    logger.info(f'Skip discovery: {args.skip_discovery}')
    logger.info(f'Started: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    logger.info(f'========================================')

    # Phase 1: Provision each region via create_test_district.py
    results = {}

    if args.skip_provisioning:
        logger.info('Skipping provisioning (--skip-provisioning)')
        results = {rid: True for rid in region_ids}
    elif parallel:
        logger.info(f'Launching {len(regions_to_process)} regions in parallel...')
        with ThreadPoolExecutor(max_workers=len(regions_to_process)) as executor:
            futures = {
                executor.submit(provision_region, rid, rcfg, args, index=i): rid
                for i, (rid, rcfg) in enumerate(regions_to_process.items())
            }
            for future in as_completed(futures):
                region_id = futures[future]
                try:
                    rid, success = future.result()
                    results[rid] = success
                except Exception as e:
                    logger.error(f'Exception provisioning {region_id}: {e}')
                    results[region_id] = False
    else:
        for i, (region_id, region_config) in enumerate(regions_to_process.items()):
            _, success = provision_region(region_id, region_config, args, index=i)
            results[region_id] = success
            if not success and not args.dry_run:
                logger.error(f'Stopping after failure on {region_id}')
                break

    # Phase 2: Marine zones and buoy discovery
    successful_regions = [r for r, ok in results.items() if ok]

    if not args.skip_discovery and not args.dry_run and successful_regions:
        run_marine_zones(successful_regions, dry_run=args.dry_run)
        run_ndbc_buoys(dry_run=args.dry_run)

        # Phase 3: Re-generate metadata to include marine zone/buoy counts
        if not args.skip_generators:
            regenerate_metadata(successful_regions, dry_run=args.dry_run)

    # Summary
    logger.info(f'\n{"=" * 60}')
    logger.info('SUMMARY')
    logger.info(f'{"=" * 60}')
    for region_id, success in results.items():
        status = '✓' if success else '✗'
        name = ALL_REGIONS.get(region_id, {}).get('name', region_id)
        logger.info(f'  {status} {region_id} ({name})')

    ok_count = sum(1 for v in results.values() if v)
    fail_count = sum(1 for v in results.values() if not v)
    logger.info(f'\n  {ok_count} succeeded, {fail_count} failed')
    logger.info(f'Completed: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')

    if fail_count > 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
