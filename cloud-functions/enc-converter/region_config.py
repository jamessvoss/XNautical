"""
Shared region configuration for enc-converter services.

Loads DISTRICT_PREFIXES from config/regions.json (bundled in Docker image).
Used by server.py, compose_job.py, and merge_job.py to avoid duplicating
the region prefix mapping.
"""

import json
import os

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Look for regions.json in several locations (Docker image, local dev)
_SEARCH_PATHS = [
    os.path.join(_SCRIPT_DIR, 'regions.json'),
    os.path.join(_SCRIPT_DIR, '..', '..', 'config', 'regions.json'),
]

DISTRICT_PREFIXES = {}
SCALE_PREFIXES = ['US1', 'US2', 'US3', 'US4', 'US5', 'US5C', 'US6']

for _path in _SEARCH_PATHS:
    if os.path.exists(_path):
        with open(_path, 'r') as _f:
            _master = json.load(_f)
        DISTRICT_PREFIXES = {k: v['prefix'] for k, v in _master['regions'].items()}
        break

if not DISTRICT_PREFIXES:
    raise RuntimeError(
        'regions.json not found -- DISTRICT_PREFIXES will be empty. '
        'Ensure regions.json is bundled in the Docker image. '
        f'Searched: {_SEARCH_PATHS}'
    )


def get_district_prefix(region_id: str) -> str:
    """Get the app-side filename prefix for a region."""
    if region_id in DISTRICT_PREFIXES:
        return DISTRICT_PREFIXES[region_id]
    raise ValueError(
        f'Unknown region_id: {region_id}. '
        f'Add it to config/regions.json. Known regions: {list(DISTRICT_PREFIXES.keys())}'
    )
