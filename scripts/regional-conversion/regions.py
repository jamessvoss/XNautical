"""
Regional definitions for Alaska chart packs.

Each region defines:
- name: Display name
- id: Short identifier for filenames
- bounds: [west, south, east, north] in degrees
- description: What areas are covered
"""

REGIONS = {
    "overview": {
        "name": "Alaska Overview",
        "id": "alaska_overview",
        "bounds": [-180.0, 48.0, -130.0, 75.0],
        "description": "All of Alaska at overview scale (US1+US2)",
        "scales": [1, 2],  # Only US1 and US2
        "min_zoom": 0,
        "max_zoom": 10,
        "required": True,  # Always installed
    },
    "southeast": {
        "name": "Southeast Alaska",
        "id": "southeast_alaska",
        "bounds": [-140.0, 54.5, -130.0, 60.5],
        "description": "Ketchikan, Juneau, Sitka, Glacier Bay, Inside Passage",
        "scales": [3, 4, 5, 6],
        "min_zoom": 8,
        "max_zoom": 18,
        "required": False,
    },
    "southcentral": {
        "name": "Southcentral Alaska", 
        "id": "southcentral_alaska",
        "bounds": [-155.0, 57.0, -140.0, 62.0],
        "description": "Kodiak, Homer, Seward, Valdez, Prince William Sound",
        "scales": [3, 4, 5, 6],
        "min_zoom": 8,
        "max_zoom": 18,
        "required": False,
    },
    "southwest": {
        "name": "Southwest Alaska",
        "id": "southwest_alaska",
        "bounds": [-180.0, 50.0, -155.0, 57.0],
        "description": "Aleutian Islands, Dutch Harbor, Unalaska",
        "scales": [3, 4, 5, 6],
        "min_zoom": 8,
        "max_zoom": 18,
        "required": False,
    },
    "western": {
        "name": "Western Alaska",
        "id": "western_alaska",
        "bounds": [-180.0, 57.0, -155.0, 67.0],
        "description": "Bristol Bay, Bethel, Nome, Norton Sound",
        "scales": [3, 4, 5, 6],
        "min_zoom": 8,
        "max_zoom": 18,
        "required": False,
    },
    "northern": {
        "name": "Northern Alaska",
        "id": "northern_alaska",
        "bounds": [-180.0, 67.0, -130.0, 75.0],
        "description": "Arctic coast, Barrow, Prudhoe Bay",
        "scales": [3, 4, 5, 6],
        "min_zoom": 8,
        "max_zoom": 18,
        "required": False,
    },
}

# Zoom ranges for each chart scale
# These overlap slightly for smooth transitions
SCALE_ZOOM_RANGES = {
    1: {"min": 0, "max": 8},    # US1 Overview
    2: {"min": 6, "max": 10},   # US2 General  
    3: {"min": 8, "max": 13},   # US3 Coastal
    4: {"min": 11, "max": 16},  # US4 Approach
    5: {"min": 14, "max": 18},  # US5 Harbor
    6: {"min": 16, "max": 22},  # US6 Berthing
}

def get_chart_scale(chart_id: str) -> int:
    """Extract scale level from chart ID (e.g., US4AK1234 -> 4)"""
    if chart_id.startswith("US") and len(chart_id) > 2:
        try:
            return int(chart_id[2])
        except ValueError:
            pass
    return 1  # Default to overview

def chart_in_region(chart_bounds: list, region_bounds: list) -> bool:
    """Check if chart bounds overlap with region bounds"""
    cw, cs, ce, cn = chart_bounds
    rw, rs, re, rn = region_bounds
    
    # Check for intersection
    return not (ce < rw or cw > re or cn < rs or cs > rn)

def get_zoom_range(scale: int) -> tuple:
    """Get min/max zoom for a chart scale"""
    if scale in SCALE_ZOOM_RANGES:
        return SCALE_ZOOM_RANGES[scale]["min"], SCALE_ZOOM_RANGES[scale]["max"]
    return 0, 18
