"""
Generate District Download Metadata

Pre-generates a metadata file after data generation is complete.
Scans Firebase Storage for actual file sizes and includes Firestore metadata.
Saves the result to Storage as {districtId}/download-metadata.json

The app downloads this small JSON file once instead of making multiple queries.

Triggered by:
  - ENC chart conversion complete
  - Satellite generation complete
  - Basemap generation complete
  - Any data generation process

Usage:
  POST /generateMetadata
  {
    "districtId": "17cgd"
  }

Output saved to Storage:
  {districtId}/download-metadata.json

Contains:
  {
    "districtId": "17cgd",
    "name": "Alaska",
    "downloadPacks": [...],
    "metadata": {
      "buoyCount": 145,
      "marineZoneCount": 23,
      "predictionSizes": {...}
    },
    "totalSizeBytes": 10234567890,
    "generatedAt": "2026-02-10T19:30:00Z"
  }
"""

from flask import Flask, request, jsonify
from google.cloud import firestore, storage
import json
import os
import logging
from datetime import datetime, timezone

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Firebase configuration
BUCKET_NAME = os.environ.get('STORAGE_BUCKET', 'xnautical-8a296.firebasestorage.app')
PROJECT_ID = os.environ.get('GCP_PROJECT', 'xnautical-8a296')

# Load region config from bundled regions.json
_REGIONS_PATH = os.path.join(os.path.dirname(__file__), 'regions.json')
if os.path.exists(_REGIONS_PATH):
    with open(_REGIONS_PATH) as _f:
        _master_config = json.load(_f)
    DISTRICT_PREFIXES = {k: v['prefix'] for k, v in _master_config['regions'].items()}
    BASEMAP_FILENAMES = {k: f"{v['prefix']}_basemap" for k, v in _master_config['regions'].items()}
    REGION_GNIS_FILES = {k: v.get('gnisFile', 'gnis_names.mbtiles') for k, v in _master_config['regions'].items()}
else:
    # Fallback - should not happen in production (regions.json must be in Docker image)
    logger.error('regions.json not found, using empty config')
    DISTRICT_PREFIXES = {}
    BASEMAP_FILENAMES = {}
    REGION_GNIS_FILES = {}


def get_district_prefix(district_id: str) -> str:
    return DISTRICT_PREFIXES.get(district_id, district_id.replace('cgd', '').lower())


def get_file_size(bucket, storage_path):
    """Get size of a file in Firebase Storage.
    Uses get_blob() (single GET) instead of blob() + reload() for reliability
    with Firebase Storage buckets.
    """
    try:
        blob = bucket.get_blob(storage_path)
        if blob and blob.size:
            return blob.size
        if blob:
            logger.warning(f'Blob exists but size is None/0 for {storage_path}')
        else:
            logger.info(f'Blob not found: {storage_path}')
        return 0
    except Exception as e:
        logger.warning(f'Could not get size for {storage_path}: {e}')
        return 0


def get_blob_md5(bucket, storage_path):
    """Get the base64-encoded MD5 hash of a file in Firebase Storage"""
    try:
        blob = bucket.get_blob(storage_path)
        if blob and blob.md5_hash:
            return blob.md5_hash  # base64-encoded MD5
    except Exception as e:
        logger.warning(f'Could not get MD5 for {storage_path}: {e}')
    return None


def get_buoy_count(db, district_id):
    """Get number of buoys for a district from Firestore"""
    try:
        catalog_ref = db.collection('districts').document(district_id).collection('buoys').document('catalog')
        catalog_snap = catalog_ref.get()
        if catalog_snap.exists:
            stations = catalog_snap.to_dict().get('stations', [])
            return len(stations)
    except Exception as e:
        logger.warning(f'Could not get buoy count for {district_id}: {e}')
    return 0


def get_marine_zone_count(db, district_id):
    """Get number of marine zones for a district from Firestore"""
    try:
        zones_ref = db.collection('districts').document(district_id).collection('marine-zones')
        zones_snap = zones_ref.get()
        return len(list(zones_snap))
    except Exception as e:
        logger.warning(f'Could not get marine zone count for {district_id}: {e}')
    return 0


def get_prediction_sizes(bucket, district_id):
    """Get sizes of prediction databases"""
    sizes = {}
    for pred_type in ['tides', 'currents']:
        # Check per-district location: {district_id}/predictions/{pred_type}_{district_id}.db.zip
        storage_path = f'{district_id}/predictions/{pred_type}_{district_id}.db.zip'
        size = get_file_size(bucket, storage_path)
        if size > 0:
            sizes[pred_type] = size
        else:
            # Try legacy global predictions folder as fallback
            storage_path = f'predictions/{pred_type}_{district_id}.db.zip'
            size = get_file_size(bucket, storage_path)
            if size > 0:
                sizes[pred_type] = size
    return sizes


@app.route('/generateMetadata', methods=['POST'])
def generate_metadata():
    """
    Generate and save complete download metadata for a district.
    Scans Storage for actual file sizes and aggregates Firestore metadata.
    Saves result to Storage at {districtId}/download-metadata.json
    """
    try:
        data = request.get_json()
        district_id = data.get('districtId')
        
        if not district_id:
            return jsonify({'error': 'districtId is required'}), 400
        
        logger.info(f'Generating metadata for district: {district_id}')
        
        # Initialize clients
        db = firestore.Client()
        storage_client = storage.Client()
        bucket = storage_client.bucket(BUCKET_NAME)
        
        # Get basic district info from Firestore
        district_ref = db.collection('districts').document(district_id)
        district_snap = district_ref.get()
        
        if not district_snap.exists:
            return jsonify({'error': f'District {district_id} not found'}), 404
        
        district_data = district_snap.to_dict()

        # Read chart-level metadata from Firestore (written by compose_job.py)
        chart_data = district_data.get('chartData', {})
        chart_completeness = chart_data.get('completeness', 1.0)
        chart_md5 = chart_data.get('md5Checksum', None)

        # Prepare metadata
        download_packs = []
        total_size = 0

        # Unified chart pack (single file with all scales, deduplicated)
        prefix = get_district_prefix(district_id)
        charts_path = f'{district_id}/charts/{prefix}_charts.mbtiles.zip'
        charts_size = get_file_size(bucket, charts_path)
        if charts_size > 0:
            download_packs.append({
                'id': 'charts',
                'type': 'charts',
                'name': 'Navigation Charts',
                'description': 'All chart scales (Overview through Berthing)',
                'storagePath': charts_path,
                'sizeBytes': charts_size,
                'sizeMB': round(charts_size / 1024 / 1024, 1),
                'required': True,
                'checksum': chart_md5,
                'checksumAlgorithm': 'md5' if chart_md5 else None,
            })
            total_size += charts_size

        # Points pack (soundings, nav aids, hazards — separate from charts)
        points_path = f'{district_id}/charts/points.mbtiles.zip'
        points_size = get_file_size(bucket, points_path)
        if points_size > 0:
            points_md5 = get_blob_md5(bucket, points_path)
            download_packs.append({
                'id': 'points',
                'type': 'charts',
                'name': 'Navigation Points',
                'description': 'Soundings, lights, buoys, and hazards',
                'storagePath': points_path,
                'sizeBytes': points_size,
                'sizeMB': round(points_size / 1024 / 1024, 1),
                'required': True,
                'checksum': points_md5,
                'checksumAlgorithm': 'md5' if points_md5 else None,
            })
            total_size += points_size

        # GNIS place names — check per-district first, then fall back to global
        gnis_filename = REGION_GNIS_FILES.get(district_id, 'gnis_names.mbtiles')
        gnis_path = f'{district_id}/gnis/{gnis_filename}.zip'
        gnis_size = get_file_size(bucket, gnis_path)
        if gnis_size == 0:
            # Fall back to a global/shared GNIS file
            gnis_path = 'global/gnis/gnis_names.mbtiles.zip'
            gnis_size = get_file_size(bucket, gnis_path)
        if gnis_size > 0:
            gnis_md5 = get_blob_md5(bucket, gnis_path)
            download_packs.append({
                'id': 'gnis',
                'type': 'gnis',
                'name': 'Place Names (GNIS)',
                'description': 'Geographic place names overlay',
                'storagePath': gnis_path,
                'sizeBytes': gnis_size,
                'sizeMB': round(gnis_size / 1024 / 1024, 1),
                'required': True,
                'checksum': gnis_md5,
                'checksumAlgorithm': 'md5' if gnis_md5 else None,
            })
            total_size += gnis_size
        
        # Per-zoom levels used by basemap, ocean, terrain generators
        imagery_zoom_levels = [
            ('z0-5', 'Overview', 'Zoom levels 0-5'),
            ('z6', 'Zoom 6', 'Zoom level 6'),
            ('z7', 'Zoom 7', 'Zoom level 7'),
            ('z8', 'Region', 'Zoom level 8'),
            ('z9', 'Area', 'Zoom level 9'),
            ('z10', 'City', 'Zoom level 10'),
            ('z11', 'Town', 'Zoom level 11'),
            ('z12', 'Neighborhood', 'Zoom level 12'),
            ('z13', 'Street', 'Zoom level 13'),
            ('z14', 'Detail', 'Zoom level 14'),
        ]

        # Basemap
        basemap_name = BASEMAP_FILENAMES.get(district_id, 'basemap')
        basemap_path = f'{district_id}/basemaps/{basemap_name}.mbtiles.zip'
        basemap_size = get_file_size(bucket, basemap_path)
        if basemap_size > 0:
            basemap_md5 = get_blob_md5(bucket, basemap_path)
            download_packs.append({
                'id': 'basemap',
                'type': 'basemap',
                'name': 'Land Basemap',
                'description': 'Terrain and land features',
                'storagePath': basemap_path,
                'sizeBytes': basemap_size,
                'sizeMB': round(basemap_size / 1024 / 1024, 1),
                'required': False,
                'checksum': basemap_md5,
                'checksumAlgorithm': 'md5' if basemap_md5 else None,
            })
            total_size += basemap_size
        else:
            # Per-zoom fallback
            for zoom_id, zoom_name, zoom_desc in imagery_zoom_levels:
                bm_path = f'{district_id}/basemaps/{basemap_name}_{zoom_id}.mbtiles.zip'
                bm_size = get_file_size(bucket, bm_path)
                if bm_size > 0:
                    bm_md5 = get_blob_md5(bucket, bm_path)
                    download_packs.append({
                        'id': f'basemap-{zoom_id}',
                        'type': 'basemap',
                        'name': f'Land Basemap ({zoom_name})',
                        'description': zoom_desc,
                        'storagePath': bm_path,
                        'sizeBytes': bm_size,
                        'sizeMB': round(bm_size / 1024 / 1024, 1),
                        'required': False,
                        'checksum': bm_md5,
                        'checksumAlgorithm': 'md5' if bm_md5 else None,
                    })
                    total_size += bm_size

        # Ocean basemap
        ocean_path = f'{district_id}/ocean/{prefix}_ocean.mbtiles.zip'
        ocean_size = get_file_size(bucket, ocean_path)
        if ocean_size > 0:
            ocean_md5 = get_blob_md5(bucket, ocean_path)
            download_packs.append({
                'id': 'ocean',
                'type': 'ocean',
                'name': 'Ocean Map',
                'description': 'ESRI Ocean Basemap',
                'storagePath': ocean_path,
                'sizeBytes': ocean_size,
                'sizeMB': round(ocean_size / 1024 / 1024, 1),
                'required': False,
                'checksum': ocean_md5,
                'checksumAlgorithm': 'md5' if ocean_md5 else None,
            })
            total_size += ocean_size
        else:
            # Per-zoom fallback
            for zoom_id, zoom_name, zoom_desc in imagery_zoom_levels:
                oc_path = f'{district_id}/ocean/{prefix}_ocean_{zoom_id}.mbtiles.zip'
                oc_size = get_file_size(bucket, oc_path)
                if oc_size > 0:
                    oc_md5 = get_blob_md5(bucket, oc_path)
                    download_packs.append({
                        'id': f'ocean-{zoom_id}',
                        'type': 'ocean',
                        'name': f'Ocean Map ({zoom_name})',
                        'description': zoom_desc,
                        'storagePath': oc_path,
                        'sizeBytes': oc_size,
                        'sizeMB': round(oc_size / 1024 / 1024, 1),
                        'required': False,
                        'checksum': oc_md5,
                        'checksumAlgorithm': 'md5' if oc_md5 else None,
                    })
                    total_size += oc_size

        # Terrain map
        terrain_path = f'{district_id}/terrain/{prefix}_terrain.mbtiles.zip'
        terrain_size = get_file_size(bucket, terrain_path)
        if terrain_size > 0:
            terrain_md5 = get_blob_md5(bucket, terrain_path)
            download_packs.append({
                'id': 'terrain',
                'type': 'terrain',
                'name': 'Terrain Map',
                'description': 'OpenTopoMap terrain',
                'storagePath': terrain_path,
                'sizeBytes': terrain_size,
                'sizeMB': round(terrain_size / 1024 / 1024, 1),
                'required': False,
                'checksum': terrain_md5,
                'checksumAlgorithm': 'md5' if terrain_md5 else None,
            })
            total_size += terrain_size
        else:
            # Per-zoom fallback
            for zoom_id, zoom_name, zoom_desc in imagery_zoom_levels:
                tr_path = f'{district_id}/terrain/{prefix}_terrain_{zoom_id}.mbtiles.zip'
                tr_size = get_file_size(bucket, tr_path)
                if tr_size > 0:
                    tr_md5 = get_blob_md5(bucket, tr_path)
                    download_packs.append({
                        'id': f'terrain-{zoom_id}',
                        'type': 'terrain',
                        'name': f'Terrain Map ({zoom_name})',
                        'description': zoom_desc,
                        'storagePath': tr_path,
                        'sizeBytes': tr_size,
                        'sizeMB': round(tr_size / 1024 / 1024, 1),
                        'required': False,
                        'checksum': tr_md5,
                        'checksumAlgorithm': 'md5' if tr_md5 else None,
                    })
                    total_size += tr_size
        
        # Satellite imagery — prefer per-zoom packs (the download panel's resolution
        # selector needs per-zoom IDs like satellite-z0-5 to filter by zoom).
        # Fall back to the combined zip only if no per-zoom files exist.
        satellite_zoom_levels = [
            ('z0-5', 'Overview', 'Zoom levels 0-5 - Global to regional view'),
            ('z6-7', 'State', 'Zoom levels 6-7 - State-wide view'),
            ('z8', 'Region', 'Zoom level 8 - Regional view'),
            ('z9', 'Area', 'Zoom level 9 - Area view'),
            ('z10', 'City', 'Zoom level 10 - City-scale view'),
            ('z11', 'Town', 'Zoom level 11 - Town-scale view'),
            ('z12', 'Neighborhood', 'Zoom level 12 - Neighborhood view'),
            ('z13', 'Street', 'Zoom level 13 - Street-level view'),
            ('z14', 'Detail', 'Zoom level 14 - High detail view'),
        ]

        satellite_per_zoom_found = False
        for zoom_id, zoom_name, zoom_desc in satellite_zoom_levels:
            sat_path = f'{district_id}/satellite/{prefix}_satellite_{zoom_id}.mbtiles.zip'
            sat_size = get_file_size(bucket, sat_path)
            if sat_size > 0:
                satellite_per_zoom_found = True
                sat_md5 = get_blob_md5(bucket, sat_path)
                download_packs.append({
                    'id': f'satellite-{zoom_id}',
                    'type': 'satellite',
                    'name': f'Satellite ({zoom_name})',
                    'description': zoom_desc,
                    'storagePath': sat_path,
                    'sizeBytes': sat_size,
                    'sizeMB': round(sat_size / 1024 / 1024, 1),
                    'required': False,
                    'checksum': sat_md5,
                    'checksumAlgorithm': 'md5' if sat_md5 else None,
                })
                total_size += sat_size

        if not satellite_per_zoom_found:
            # Fall back to combined satellite zip
            satellite_path = f'{district_id}/satellite/{prefix}_satellite.mbtiles.zip'
            satellite_size = get_file_size(bucket, satellite_path)
            if satellite_size > 0:
                satellite_md5 = get_blob_md5(bucket, satellite_path)
                download_packs.append({
                    'id': 'satellite',
                    'type': 'satellite',
                    'name': 'Satellite Imagery',
                    'description': 'Satellite imagery tiles',
                    'storagePath': satellite_path,
                    'sizeBytes': satellite_size,
                    'sizeMB': round(satellite_size / 1024 / 1024, 1),
                    'required': False,
                    'checksum': satellite_md5,
                    'checksumAlgorithm': 'md5' if satellite_md5 else None,
                })
                total_size += satellite_size
        
        # Charts are required — if no charts file exists, return an error
        has_charts = any(p['type'] == 'charts' for p in download_packs)
        if not has_charts:
            logger.error(f'No charts file found for district {district_id} at {charts_path}')
            return jsonify({
                'error': f'No charts file found for district {district_id}',
                'detail': f'Expected charts at: {charts_path}',
            }), 404

        # Get metadata counts
        buoy_count = get_buoy_count(db, district_id)
        marine_zone_count = get_marine_zone_count(db, district_id)
        prediction_sizes = get_prediction_sizes(bucket, district_id)
        
        # Build metadata object
        metadata = {
            'districtId': district_id,
            'name': district_data.get('name', district_id),
            'code': district_data.get('code', ''),
            'completeness': chart_completeness,
            'downloadPacks': download_packs,
            'metadata': {
                'buoyCount': buoy_count,
                'marineZoneCount': marine_zone_count,
                'predictionSizes': prediction_sizes,
                'predictionSizeMB': {
                    k: round(v / 1024 / 1024, 1)
                    for k, v in prediction_sizes.items()
                },
            },
            'totalSizeBytes': total_size,
            'totalSizeMB': round(total_size / 1024 / 1024, 1),
            'totalSizeGB': round(total_size / 1024 / 1024 / 1024, 2),
            'generatedAt': datetime.now(timezone.utc).isoformat(),
        }
        
        # Save to Storage
        metadata_path = f'{district_id}/download-metadata.json'
        metadata_blob = bucket.blob(metadata_path)
        metadata_blob.cache_control = 'public, max-age=3600'
        metadata_blob.upload_from_string(
            json.dumps(metadata, indent=2),
            content_type='application/json'
        )
        
        logger.info(f'Generated metadata for {district_id}: {len(download_packs)} packs, '
                   f'{metadata["totalSizeGB"]} GB total')
        logger.info(f'Saved to Storage: {metadata_path}')
        
        # Also update Firestore district document with downloadPacks and conversion status
        district_ref.set({
            'downloadPacks': download_packs,
            'totalDownloadSizeBytes': total_size,
            'metadataPath': metadata_path,
            'metadataGeneratedAt': firestore.SERVER_TIMESTAMP,
            'conversionStatus': {
                'state': 'completed',
                'message': 'All data generated and metadata published',
            },
        }, merge=True)
        
        return jsonify({
            'status': 'success',
            'districtId': district_id,
            'metadataPath': metadata_path,
            'packCount': len(download_packs),
            'totalSizeGB': metadata['totalSizeGB'],
        }), 200
        
    except Exception as e:
        logger.error(f'Error generating district metadata: {e}', exc_info=True)
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
