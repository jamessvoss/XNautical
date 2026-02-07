#!/usr/bin/env python3
"""
ENC Downloader Cloud Run Service

Provides two endpoints:
  POST /download        - Download NOAA ENC data for a USCG Coast Guard District
  POST /check-updates   - Check for ENC updates against stored metadata
"""

import os
import time
import shutil
import zipfile
import logging
import tempfile
from datetime import datetime, timezone

import requests
from flask import Flask, request, jsonify
from google.cloud import storage, firestore

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Valid USCG Coast Guard Districts
VALID_DISTRICTS = {'01', '05', '07', '08', '09', '11', '13', '14', '17'}

# Firebase Storage bucket (default bucket for the project)
BUCKET_NAME = os.environ.get('STORAGE_BUCKET', 'xnautical-8a296.firebasestorage.app')

# Scale mapping from chart ID prefix
SCALE_MAP = {
    'US1': 'overview',
    'US2': 'general',
    'US3': 'coastal',
    'US4': 'approach',
    'US5': 'harbor',
    'US6': 'berthing',
}

# File extensions to keep from the ZIP
KEEP_EXTENSIONS = {'.000', '.txt', '.TXT'}
KEEP_PREFIXES = {'CATALOG'}


def get_scale(chart_id: str) -> str:
    """Get scale prefix from chart ID (e.g., US4AK4PH -> US4)."""
    for prefix in SCALE_MAP:
        if chart_id.upper().startswith(prefix):
            return prefix
    return 'unknown'


def should_keep_file(filename: str) -> bool:
    """Check if an extracted file should be uploaded to storage."""
    basename = os.path.basename(filename)
    _, ext = os.path.splitext(basename)
    
    # Keep S-57 data files (.000)
    if ext.lower() == '.000':
        return True
    
    # Keep text files
    if ext.lower() == '.txt':
        return True
    
    # Keep CATALOG files (any extension)
    if basename.upper().startswith('CATALOG'):
        return True
    
    return False


def get_chart_dir_from_path(zip_entry_path: str) -> tuple:
    """
    Extract chart directory and filename from a ZIP entry path.
    
    ZIP structure is typically:
      ENC_ROOT/US4AK4PH/US4AK4PH.000
      ENC_ROOT/US4AK4PH/CATALOG.031
    
    Returns: (chart_dir, filename) or (None, None) if not a chart file.
    """
    parts = zip_entry_path.replace('\\', '/').split('/')
    
    # Skip directory-only entries
    if zip_entry_path.endswith('/'):
        return None, None
    
    # Find the chart directory (starts with US)
    for i, part in enumerate(parts):
        if part.upper().startswith('US') and len(part) >= 6:
            filename = parts[-1]
            return part, filename
    
    return None, None


# ============================================================================
# Endpoint 1: Download district ENCs
# ============================================================================

@app.route('/download', methods=['POST'])
def download_district():
    """
    Download NOAA ENC data for a USCG Coast Guard District.
    
    Request body: { "districtId": "11" }
    
    Downloads the full district ZIP from NOAA, extracts S-57 data files,
    and uploads them to Firebase Storage at {dd}cgd/enc-source/{chart}/{file}.
    Records metadata in Firestore.
    """
    data = request.get_json(silent=True) or {}
    district_id = str(data.get('districtId', '')).zfill(2)
    
    if district_id not in VALID_DISTRICTS:
        return jsonify({
            'error': f'Invalid district ID: {district_id}',
            'valid': sorted(VALID_DISTRICTS),
        }), 400
    
    start_time = time.time()
    district_label = f'{district_id}cgd'
    
    logger.info(f'Starting download for district {district_label}')
    
    # NOAA URL for the full district ZIP
    noaa_url = f'https://charts.noaa.gov/ENCs/{district_id}CGD_ENCs.zip'
    
    # Use a temp directory for the download
    work_dir = tempfile.mkdtemp(prefix=f'enc_{district_id}_')
    zip_path = os.path.join(work_dir, f'{district_id}CGD_ENCs.zip')
    extract_dir = os.path.join(work_dir, 'extracted')
    
    try:
        # Step 1: Download the ZIP file
        logger.info(f'Downloading {noaa_url}')
        download_start = time.time()
        
        resp = requests.get(noaa_url, stream=True, timeout=600)
        resp.raise_for_status()
        
        total_bytes = 0
        with open(zip_path, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):  # 1MB chunks
                f.write(chunk)
                total_bytes += len(chunk)
        
        download_duration = time.time() - download_start
        download_mb = total_bytes / (1024 * 1024)
        logger.info(f'Downloaded {download_mb:.1f} MB in {download_duration:.1f}s '
                     f'({download_mb / download_duration:.1f} MB/s)')
        
        # Step 2: Extract the ZIP
        logger.info('Extracting ZIP...')
        extract_start = time.time()
        os.makedirs(extract_dir, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(extract_dir)
        
        extract_duration = time.time() - extract_start
        logger.info(f'Extracted in {extract_duration:.1f}s')
        
        # Remove the ZIP to free disk space
        os.remove(zip_path)
        
        # Step 3: Walk extracted files and upload to Firebase Storage
        logger.info('Uploading to Firebase Storage...')
        upload_start = time.time()
        
        storage_client = storage.Client()
        bucket = storage_client.bucket(BUCKET_NAME)
        
        charts_metadata = {}
        upload_count = 0
        upload_bytes = 0
        
        for root, dirs, files in os.walk(extract_dir):
            for filename in files:
                local_path = os.path.join(root, filename)
                rel_path = os.path.relpath(local_path, extract_dir)
                
                chart_dir, fname = get_chart_dir_from_path(rel_path)
                
                if chart_dir is None or not should_keep_file(fname):
                    continue
                
                # Upload to: {dd}cgd/enc-source/{CHART_DIR}/{filename}
                storage_path = f'{district_label}/enc-source/{chart_dir}/{fname}'
                
                blob = bucket.blob(storage_path)
                blob.upload_from_filename(local_path)
                
                file_size = os.path.getsize(local_path)
                upload_count += 1
                upload_bytes += file_size
                
                # Track chart metadata (from .000 files only)
                if fname.lower().endswith('.000'):
                    scale = get_scale(chart_dir)
                    charts_metadata[chart_dir] = {
                        'scale': scale,
                        'storagePath': storage_path,
                        'sizeBytes': file_size,
                        'cancelled': False,
                    }
                
                if upload_count % 50 == 0:
                    logger.info(f'  Uploaded {upload_count} files...')
        
        upload_duration = time.time() - upload_start
        upload_mb = upload_bytes / (1024 * 1024)
        logger.info(f'Uploaded {upload_count} files ({upload_mb:.1f} MB) in {upload_duration:.1f}s')
        
        # Step 4: Store metadata in Firestore
        logger.info('Writing metadata to Firestore...')
        db = firestore.Client()
        
        doc_ref = db.collection('districts').document(district_label)
        doc_ref.set({
            'encMetadata': {
                'lastDownloaded': firestore.SERVER_TIMESTAMP,
                'totalCharts': len(charts_metadata),
                'totalSizeBytes': upload_bytes,
                'downloadSizeBytes': total_bytes,
                'charts': charts_metadata,
            }
        }, merge=True)
        
        total_duration = time.time() - start_time
        
        summary = {
            'status': 'success',
            'district': district_label,
            'totalCharts': len(charts_metadata),
            'totalFiles': upload_count,
            'downloadSizeMB': round(download_mb, 1),
            'uploadSizeMB': round(upload_mb, 1),
            'durationSeconds': round(total_duration, 1),
            'downloadSeconds': round(download_duration, 1),
            'uploadSeconds': round(upload_duration, 1),
            'scales': {},
        }
        
        # Count by scale
        for chart_id, meta in charts_metadata.items():
            s = meta['scale']
            summary['scales'][s] = summary['scales'].get(s, 0) + 1
        
        logger.info(f'Complete: {len(charts_metadata)} charts, {upload_mb:.1f} MB, '
                     f'{total_duration:.1f}s total')
        
        return jsonify(summary), 200
    
    except requests.exceptions.HTTPError as e:
        logger.error(f'NOAA download failed: {e}')
        return jsonify({
            'status': 'error',
            'error': f'Failed to download from NOAA: {e}',
            'district': district_label,
        }), 502
    
    except Exception as e:
        logger.error(f'Error processing district {district_label}: {e}', exc_info=True)
        return jsonify({
            'status': 'error',
            'error': str(e),
            'district': district_label,
        }), 500
    
    finally:
        # Cleanup temp directory
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir, ignore_errors=True)


# ============================================================================
# Endpoint 2: Check for updates
# ============================================================================

@app.route('/check-updates', methods=['POST'])
def check_updates():
    """
    Check for ENC updates for a USCG Coast Guard District.
    
    Request body: { "districtId": "11" }
    
    Fetches the individual ENCs listing from NOAA, parses the HTML table,
    and compares against stored Firestore metadata.
    """
    data = request.get_json(silent=True) or {}
    district_id = str(data.get('districtId', '')).zfill(2)
    
    if district_id not in VALID_DISTRICTS:
        return jsonify({
            'error': f'Invalid district ID: {district_id}',
            'valid': sorted(VALID_DISTRICTS),
        }), 400
    
    district_label = f'{district_id}cgd'
    logger.info(f'Checking updates for district {district_label}')
    
    try:
        from bs4 import BeautifulSoup
        
        # Step 1: Fetch the individual ENCs page
        resp = requests.get('https://charts.noaa.gov/ENCs/ENCsIndv.shtml', timeout=60)
        resp.raise_for_status()
        
        # Step 2: Parse HTML table
        soup = BeautifulSoup(resp.text, 'lxml')
        
        # The NOAA page has a wrapper table and the actual data table nested inside.
        # find_all('table') returns both; the LAST one is the data table with
        # proper rows of 9 cells each (# | ENC Name | XML | Edition | ... | CGDs).
        tables = soup.find_all('table')
        table = tables[-1] if tables else None
        
        if not table:
            return jsonify({
                'status': 'error',
                'error': 'Could not find chart table on NOAA page',
            }), 502
        
        rows = table.find_all('tr')
        logger.info(f'Found table with {len(rows)} rows')
        
        # Find the actual header row (has 8+ direct child cells with "ENC Name" and "CGDs")
        headers = []
        header_row_idx = 0
        for idx, row in enumerate(rows):
            # Use recursive=False to only get direct child cells, not nested table cells
            cells = row.find_all(['th', 'td'], recursive=False)
            if len(cells) >= 8:
                row_text = ' '.join(c.get_text(strip=True).lower() for c in cells)
                if 'enc name' in row_text and 'cgd' in row_text:
                    header_row_idx = idx
                    for c in cells:
                        # Normalize non-breaking spaces to regular spaces
                        h = c.get_text(strip=True).lower().replace('\xa0', ' ')
                        headers.append(h)
                    break
        
        logger.info(f'Table headers: {headers}')
        
        # Find column indices by exact match first, then partial
        def find_col(keyword, exact_keywords=None):
            """Find column by keyword. exact_keywords checked first for exact match."""
            if exact_keywords:
                for kw in exact_keywords:
                    for i, h in enumerate(headers):
                        if h == kw:
                            return i
            for i, h in enumerate(headers):
                if keyword in h:
                    return i
            return -1
        
        enc_col = find_col('enc', ['enc name'])
        if enc_col < 0:
            enc_col = 1  # Second column is typically the ENC name (first is #)
        
        cgd_col = find_col('cgd', ['cgds'])
        if cgd_col < 0:
            cgd_col = find_col('district')
        
        edition_col = find_col('edition', ['edition'])
        # Headers (normalized): 'update application date' and 'update'
        update_app_col = find_col('update application', ['update application date'])
        # 'update' substring appears in both columns; use exact match first
        update_col = find_col('update', ['update'])
        # If update_col still matched the application date column, use position
        if update_col == update_app_col and update_col >= 0:
            for i, h in enumerate(headers):
                if h == 'update' or (h.startswith('update') and 'application' not in h):
                    if i != update_app_col:
                        update_col = i
                        break
            else:
                if edition_col >= 0:
                    update_col = edition_col + 2
        
        issue_col = find_col('issue', ['issue date', 'issuedate'])
        zipdate_col = find_col('zip')
        
        logger.info(f'Column indices: enc={enc_col}, cgd={cgd_col}, edition={edition_col}, '
                     f'update_app={update_app_col}, update={update_col}, '
                     f'issue={issue_col}, zip={zipdate_col}')
        
        # Parse chart data (skip everything up to and including the header row)
        noaa_charts = {}
        for row in rows[header_row_idx + 1:]:
            cells = row.find_all('td', recursive=False)
            if len(cells) <= max(enc_col, 1):
                continue
            
            enc_name = cells[enc_col].get_text(strip=True) if enc_col >= 0 else ''
            if not enc_name or not enc_name.upper().startswith('US'):
                continue
            
            # Check CGD column
            cgd_text = cells[cgd_col].get_text(strip=True) if cgd_col >= 0 and cgd_col < len(cells) else ''
            
            # Filter by district
            if district_id not in cgd_text:
                continue
            
            # Extract metadata
            chart_info = {
                'encName': enc_name,
            }
            
            if edition_col >= 0 and edition_col < len(cells):
                try:
                    chart_info['edition'] = int(cells[edition_col].get_text(strip=True))
                except (ValueError, IndexError):
                    chart_info['edition'] = 0
            
            if update_app_col >= 0 and update_app_col < len(cells):
                chart_info['updateApplicationDate'] = cells[update_app_col].get_text(strip=True)
            
            if update_col >= 0 and update_col < len(cells):
                try:
                    chart_info['updateCount'] = int(cells[update_col].get_text(strip=True))
                except (ValueError, IndexError):
                    chart_info['updateCount'] = 0
            
            if issue_col >= 0 and issue_col < len(cells):
                chart_info['issueDate'] = cells[issue_col].get_text(strip=True)
            
            if zipdate_col >= 0 and zipdate_col < len(cells):
                chart_info['zipFileDateTime'] = cells[zipdate_col].get_text(strip=True)
            
            # Check for cancelled charts - "cxl" appears in the # column (first column)
            first_col = cells[0].get_text(strip=True).lower() if cells else ''
            chart_info['cancelled'] = (first_col == 'cxl')
            
            noaa_charts[enc_name.upper()] = chart_info
        
        logger.info(f'Found {len(noaa_charts)} charts on NOAA for district {district_id}')
        
        # Step 3: Load stored metadata from Firestore
        db = firestore.Client()
        doc_ref = db.collection('districts').document(district_label)
        doc = doc_ref.get()
        
        stored_charts = {}
        if doc.exists:
            enc_metadata = doc.to_dict().get('encMetadata', {})
            stored_charts = enc_metadata.get('charts', {})
        
        # Step 4: Compare
        new_charts = []
        updated_charts = []
        cancelled_charts = []
        
        for enc_name, noaa_info in noaa_charts.items():
            if noaa_info.get('cancelled'):
                cancelled_charts.append(noaa_info)
                continue
            
            if enc_name not in stored_charts:
                new_charts.append(noaa_info)
            else:
                stored = stored_charts[enc_name]
                # Check if edition or update count changed
                noaa_edition = noaa_info.get('edition', 0)
                stored_edition = stored.get('edition', 0)
                noaa_updates = noaa_info.get('updateCount', 0)
                stored_updates = stored.get('updateCount', 0)
                
                if noaa_edition > stored_edition or noaa_updates > stored_updates:
                    noaa_info['previousEdition'] = stored_edition
                    noaa_info['previousUpdateCount'] = stored_updates
                    updated_charts.append(noaa_info)
        
        # Update lastUpdateCheck timestamp
        doc_ref.set({
            'encMetadata': {
                'lastUpdateCheck': firestore.SERVER_TIMESTAMP,
            }
        }, merge=True)
        
        total_changes = len(new_charts) + len(updated_charts) + len(cancelled_charts)
        
        result = {
            'status': 'success',
            'district': district_label,
            'noaaChartCount': len(noaa_charts),
            'storedChartCount': len(stored_charts),
            'totalChanges': total_changes,
            'newCharts': new_charts,
            'updatedCharts': updated_charts,
            'cancelledCharts': cancelled_charts,
        }
        
        logger.info(f'Update check complete: {total_changes} changes '
                     f'({len(new_charts)} new, {len(updated_charts)} updated, '
                     f'{len(cancelled_charts)} cancelled)')
        
        return jsonify(result), 200
    
    except Exception as e:
        logger.error(f'Error checking updates for {district_label}: {e}', exc_info=True)
        return jsonify({
            'status': 'error',
            'error': str(e),
            'district': district_label,
        }), 500


# ============================================================================
# Health check
# ============================================================================

@app.route('/', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({
        'service': 'enc-downloader',
        'status': 'healthy',
        'validDistricts': sorted(VALID_DISTRICTS),
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
