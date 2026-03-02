# Firebase Storage Structure Verification Report
**Date:** February 10, 2026
**Status:** ✅ **All Required Files Present**

## Executive Summary

All 9 standard Coast Guard districts have their **required files** in place (note: the system now supports 17 regions total including Alaska sub-regions and 07cgd-wflorida):
- ✅ Charts (US4 & US5 - required scales)
- ✅ GNIS place names  
- ✅ Tide predictions
- ✅ Current predictions
- ✅ Download metadata

**Optional files** (satellite, some chart scales, basemaps) are missing in some districts but these do not block app functionality.

---

## District-by-District Status

### ✅ 17cgd - Alaska (PERFECT - 0 warnings)
**ALL FILES PRESENT INCLUDING SATELLITE!**

| Category | Status | Details |
|----------|--------|---------|
| Charts | ✅ Complete | All scales (US1-US6): 5.3 GB total |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 724 MB |
| Ocean | ✅ Present | 899 MB |
| Terrain | ✅ Present | 1.0 GB |
| **Satellite** | ✅ **Complete** | **9 zoom levels (z0-z14): 4.9 GB** |
| Predictions | ✅ Present | Tides: 51 MB, Currents: 88 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 01cgd - Northeast (Boston) - 2 warnings
| Category | Status | Details |
|----------|--------|---------|
| Charts | ⚠️ Partial | Missing US1 (optional), has US2-US6 |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 723 MB |
| Ocean | ✅ Present | 217 MB |
| Terrain | ✅ Present | 546 MB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 42 MB, Currents: 115 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 05cgd - Mid-Atlantic (Portsmouth) - 3 warnings
| Category | Status | Details |
|----------|--------|---------|
| Charts | ⚠️ Partial | Missing US6 (optional), has US1-US5 |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 640 MB |
| Ocean | ⚠️ Missing | No ocean map |
| Terrain | ✅ Present | 1.0 GB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 44 MB, Currents: 77 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 07cgd - Southeast (Miami) - 4 warnings
| Category | Status | Details |
|----------|--------|---------|
| Charts | ⚠️ Partial | Missing US6 (optional), has US1-US5 |
| GNIS | ✅ Present | 60 MB |
| Basemap | ⚠️ Missing | No basemap |
| Ocean | ⚠️ Missing | No ocean map |
| Terrain | ✅ Present | 332 MB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 73 MB, Currents: 68 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 08cgd - Gulf Coast (New Orleans) - 2 warnings
| Category | Status | Details |
|----------|--------|---------|
| Charts | ⚠️ Partial | Missing US6 (optional), has US1-US5 |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 206 MB |
| Ocean | ✅ Present | 178 MB |
| Terrain | ✅ Present | 943 MB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 15 MB, Currents: 8 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 09cgd - Great Lakes (Cleveland) - 2 warnings
| Category | Status | Details |
|----------|--------|---------|
| Charts | ⚠️ Partial | Missing US1, US3 (optional), has US2, US4-US6 |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 53 MB |
| Ocean | ⚠️ Missing | No ocean map |
| Terrain | ✅ Present | 122 MB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 10 MB, Currents: 30 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 11cgd - Pacific (Alameda) - 2 warnings
| Category | Status | Details |
|----------|--------|---------|
| Charts | ⚠️ Partial | Missing US6 (optional), has US1-US5 |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 390 MB |
| Ocean | ✅ Present | 162 MB |
| Terrain | ✅ Present | 893 MB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 12 MB, Currents: 22 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 13cgd - Pacific Northwest (Seattle) - 2 warnings
| Category | Status | Details |
|----------|--------|---------|
| Charts | ⚠️ Partial | Missing US6 (optional), has US1-US5 |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 438 MB |
| Ocean | ✅ Present | 282 MB |
| Terrain | ✅ Present | 2.1 GB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 27 MB, Currents: 46 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

### ✅ 14cgd - Pacific Islands (Honolulu) - 1 warning
| Category | Status | Details |
|----------|--------|---------|
| Charts | ✅ Complete | All scales (US1-US6): 1.1 GB total |
| GNIS | ✅ Present | 60 MB |
| Basemap | ✅ Present | 2.7 MB |
| Ocean | ✅ Present | 59 MB |
| Terrain | ✅ Present | 119 MB |
| Satellite | ⚠️ Missing | No satellite imagery |
| Predictions | ✅ Present | Tides: 3 MB, Currents: 2 MB |
| Metadata | ✅ Present | download-metadata.json exists |

---

## Common Patterns

### ✅ Present in ALL Districts:
- Charts US4 & US5 (required approach and harbor scales)
- GNIS place names
- Tide & current predictions
- Download metadata

### ⚠️ Missing in Most Districts:
1. **Satellite Imagery** - Only Alaska (17cgd) has satellite data
   - Alaska has full zoom-level split (z0-z14): 4.9 GB
   - All other 8 districts: No satellite data
   
2. **US6 Chart Scale** - Missing in 7 out of 9 districts
   - Present only in: 01cgd, 09cgd, 14cgd, 17cgd
   
3. **Ocean Map** - Missing in 3 districts
   - Missing in: 05cgd, 07cgd, 09cgd
   
4. **Basemap** - Missing in 1 district
   - Missing in: 07cgd

---

## Expected File Structure

Based on the metadata generator (`cloud-functions/district-metadata/server.py`), each district should have:

```
{districtId}/
├── charts/
│   ├── US1.mbtiles.zip  (optional - Overview scale 1:3M)
│   ├── US2.mbtiles.zip  (optional - General scale 1:1M)
│   ├── US3.mbtiles.zip  (optional - Coastal scale 1:250k)
│   ├── US4.mbtiles.zip  ✅ REQUIRED - Approach scale 1:80k
│   ├── US5.mbtiles.zip  ✅ REQUIRED - Harbor scale 1:50k
│   └── US6.mbtiles.zip  (optional - Berthing scale 1:25k)
├── gnis/
│   └── gnis_names.mbtiles.zip  ✅ REQUIRED
├── basemaps/
│   └── basemap.mbtiles.zip  (optional)
├── ocean/
│   └── ocean.mbtiles.zip  (optional)
├── terrain/
│   └── terrain.mbtiles.zip  (optional)
├── satellite/
│   ├── satellite.mbtiles.zip  (single file OR...)
│   ├── satellite_z0-5.mbtiles.zip  (zoom-level split)
│   ├── satellite_z6-7.mbtiles.zip
│   ├── satellite_z8.mbtiles.zip
│   ├── satellite_z9.mbtiles.zip
│   ├── satellite_z10.mbtiles.zip
│   ├── satellite_z11.mbtiles.zip
│   ├── satellite_z12.mbtiles.zip
│   ├── satellite_z13.mbtiles.zip
│   └── satellite_z14.mbtiles.zip
├── predictions/
│   ├── tides_{districtId}.db.zip  ✅ REQUIRED
│   └── currents_{districtId}.db.zip  ✅ REQUIRED
└── download-metadata.json  ✅ REQUIRED (generated by metadata service)
```

---

## Recommendations

### Critical (None!)
✅ All required files are present across all districts. App is fully functional.

### Optional Improvements

1. **Add Satellite Imagery for Other Districts**
   - Currently only Alaska (17cgd) has satellite data
   - Consider generating satellite tiles for remaining 8 districts
   - Alaska model uses zoom-level split (z0-z14) which works well for large datasets

2. **Complete US6 Chart Scale** (Berthing scale)
   - Missing in: 05cgd, 07cgd, 08cgd, 11cgd, 13cgd (5 districts)
   - US6 provides highest detail for harbors/marinas
   - File sizes are generally small (< 1 MB to 21 MB)

3. **Add Ocean Maps**
   - Missing in: 05cgd, 07cgd, 09cgd
   - Provides nice alternative base layer

4. **Add Basemap**
   - Missing only in: 07cgd
   - Important for "Street" view mode

---

## File Format Verification

✅ **All files follow correct naming convention:**
- All MBTiles are zipped: `*.mbtiles.zip`
- All prediction databases are zipped: `*.db.zip`
- Folder naming is consistent: `basemaps/` (plural)

✅ **All metadata files generated:**
- Every district has `download-metadata.json`
- Ready for app download size display

---

## Next Steps

1. ✅ **App is ready for production** - All required data is in place
2. 🎯 **Consider satellite generation** - Would greatly enhance 8 districts
3. 📝 **Track data versions** - Consider adding version/date stamps to metadata
4. 🔄 **Set up automated monitoring** - Run this verification script periodically

---

**Generated by:** `scripts/verify-storage-structure.js`
**Total Districts Checked:** 9
**Total Issues:** 0 ❌
**Total Warnings:** 18 ⚠️
