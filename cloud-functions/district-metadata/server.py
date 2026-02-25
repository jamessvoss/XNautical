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
import os
import logging
from datetime import datetime, timezone

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Firebase configuration
BUCKET_NAME = os.environ.get('BUCKET_NAME', 'xnautical-8a296.firebasestorage.app')
PROJECT_ID = os.environ.get('GCP_PROJECT', 'xnautical-8a296')

# Must match app's DISTRICT_PREFIXES
DISTRICT_PREFIXES = {
    '01cgd': 'd01', '05cgd': 'd05', '07cgd': 'd07', '08cgd': 'd08',
    '09cgd': 'd09', '11cgd': 'd11', '13cgd': 'd13', '14cgd': 'd14',
    '17cgd': 'd17', '17cgd-test': '17-test',
}

# Must match app's BASEMAP_FILENAMES
BASEMAP_FILENAMES = {
    '01cgd': 'd01_basemap', '05cgd': 'd05_basemap', '07cgd': 'd07_basemap',
    '08cgd': 'd08_basemap', '09cgd': 'd09_basemap', '11cgd': 'd11_basemap',
    '13cgd': 'd13_basemap', '14cgd': 'd14_basemap', '17cgd': 'd17_basemap',
    '17cgd-test': '17-test_basemap',
}


def get_district_prefix(district_id: str) -> str:
    return DISTRICT_PREFIXES.get(district_id, district_id.replace('cgd', ''))


def get_file_size(bucket, storage_path):
    """Get size of a file in Firebase Storage"""
    try:
        blob = bucket.blob(storage_path)
        blob.reload()  # Fetch metadata
        return blob.size
    except Exception as e:
        logger.warning(f'Could not get size for {storage_path}: {e}')
        return 0


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
            })
            total_size += charts_size
        
        # GNIS place names — check per-district first, then fall back to global
        gnis_path = f'{district_id}/gnis/gnis_names.mbtiles.zip'
        gnis_size = get_file_size(bucket, gnis_path)
        if gnis_size == 0:
            # Fall back to a global/shared GNIS file
            gnis_path = 'global/gnis/gnis_names.mbtiles.zip'
            gnis_size = get_file_size(bucket, gnis_path)
        if gnis_size > 0:
            download_packs.append({
                'id': 'gnis',
                'type': 'gnis',
                'name': 'Place Names (GNIS)',
                'description': 'Geographic place names overlay',
                'storagePath': gnis_path,
                'sizeBytes': gnis_size,
                'sizeMB': round(gnis_size / 1024 / 1024, 1),
                'required': True,
            })
            total_size += gnis_size
        
        # Basemap
        basemap_name = BASEMAP_FILENAMES.get(district_id, 'basemap')
        basemap_path = f'{district_id}/basemaps/{basemap_name}.mbtiles.zip'
        basemap_size = get_file_size(bucket, basemap_path)
        if basemap_size > 0:
            download_packs.append({
                'id': 'basemap',
                'type': 'basemap',
                'name': 'Land Basemap',
                'description': 'Terrain and land features',
                'storagePath': basemap_path,
                'sizeBytes': basemap_size,
                'sizeMB': round(basemap_size / 1024 / 1024, 1),
                'required': False,
            })
            total_size += basemap_size
        
        # Ocean basemap
        ocean_path = f'{district_id}/ocean/{prefix}_ocean.mbtiles.zip'
        ocean_size = get_file_size(bucket, ocean_path)
        if ocean_size > 0:
            download_packs.append({
                'id': 'ocean',
                'type': 'ocean',
                'name': 'Ocean Map',
                'description': 'ESRI Ocean Basemap',
                'storagePath': ocean_path,
                'sizeBytes': ocean_size,
                'sizeMB': round(ocean_size / 1024 / 1024, 1),
                'required': False,
            })
            total_size += ocean_size
        
        # Terrain map
        terrain_path = f'{district_id}/terrain/{prefix}_terrain.mbtiles.zip'
        terrain_size = get_file_size(bucket, terrain_path)
        if terrain_size > 0:
            download_packs.append({
                'id': 'terrain',
                'type': 'terrain',
                'name': 'Terrain Map',
                'description': 'OpenTopoMap terrain',
                'storagePath': terrain_path,
                'sizeBytes': terrain_size,
                'sizeMB': round(terrain_size / 1024 / 1024, 1),
                'required': False,
            })
            total_size += terrain_size
        
        # Satellite imagery (check for single file or zoom-level files)
        satellite_path = f'{district_id}/satellite/{prefix}_satellite.mbtiles.zip'
        satellite_size = get_file_size(bucket, satellite_path)
        
        if satellite_size > 0:
            # Single satellite file
            download_packs.append({
                'id': 'satellite',
                'type': 'satellite',
                'name': 'Satellite Imagery',
                'description': 'Satellite imagery tiles',
                'storagePath': satellite_path,
                'sizeBytes': satellite_size,
                'sizeMB': round(satellite_size / 1024 / 1024, 1),
                'required': False,
            })
            total_size += satellite_size
        else:
            # Check for zoom-level files
            zoom_levels = [
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
            
            for zoom_id, zoom_name, zoom_desc in zoom_levels:
                sat_path = f'{district_id}/satellite/{prefix}_satellite_{zoom_id}.mbtiles.zip'
                sat_size = get_file_size(bucket, sat_path)
                if sat_size > 0:
                    download_packs.append({
                        'id': f'satellite-{zoom_id}',
                        'type': 'satellite',
                        'name': f'Satellite ({zoom_name})',
                        'description': zoom_desc,
                        'storagePath': sat_path,
                        'sizeBytes': sat_size,
                        'sizeMB': round(sat_size / 1024 / 1024, 1),
                        'required': False,
                    })
                    total_size += sat_size
        
        # Get metadata counts
        buoy_count = get_buoy_count(db, district_id)
        marine_zone_count = get_marine_zone_count(db, district_id)
        prediction_sizes = get_prediction_sizes(bucket, district_id)
        
        # Build metadata object
        metadata = {
            'districtId': district_id,
            'name': district_data.get('name', district_id),
            'code': district_data.get('code', ''),
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
        import json
        metadata_path = f'{district_id}/download-metadata.json'
        metadata_blob = bucket.blob(metadata_path)
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
            'conversionStatus': 'completed',  # Mark district as fully converted
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


def get_scale_name(scale):
    """Get human-readable name for chart scale"""
    names = {
        'US1': 'Overview Charts',
        'US2': 'General Charts',
        'US3': 'Coastal Charts',
        'US4': 'Approach Charts',
        'US5': 'Harbor Charts',
        'US6': 'Berthing Charts',
    }
    return names.get(scale, scale)


def get_scale_description(scale):
    """Get description for chart scale"""
    descriptions = {
        'US1': 'Scales 1:1,500,001 and smaller - Ocean planning',
        'US2': 'Scales 1:600,001 to 1:1,500,000 - Offshore navigation',
        'US3': 'Scales 1:150,001 to 1:600,000 - Coastal approach',
        'US4': 'Scales 1:50,001 to 1:150,000 - Harbor approach',
        'US5': 'Scales 1:12,001 to 1:50,000 - Harbors and anchorages',
        'US6': 'Scales 1:12,000 and larger - Detailed berthing',
    }
    return descriptions.get(scale, '')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
