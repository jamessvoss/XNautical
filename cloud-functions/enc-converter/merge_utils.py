#!/usr/bin/env python3
"""
Shared utilities for MBTiles merging operations.

Used by both server.py (Cloud Run Service) and merge_job.py (Cloud Run Job)
to ensure consistent behavior for tile-join merging, checksum computation,
and safety checks.
"""

import hashlib
import logging
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

logger = logging.getLogger(__name__)


def compute_md5(file_path: Path) -> str:
    """Compute MD5 checksum of a file."""
    hash_md5 = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def check_for_skipped_tiles(stderr: str, context: str = "") -> None:
    """Check tile-join output for skipped tiles and FAIL LOUDLY if any are found.

    This is a safety-critical check. If tile-join drops any tiles, it means
    navigation features are missing from the output, which is unacceptable.

    Raises:
        RuntimeError: If any tiles were skipped.
    """
    skipped_lines = [line for line in stderr.split('\n') if 'Skipping this tile' in line]
    if skipped_lines:
        logger.error(f"tile-join DROPPED {len(skipped_lines)} TILES! Context: {context}")
        for line in skipped_lines[:10]:
            logger.error(f"  {line.strip()}")
        raise RuntimeError(
            f"tile-join dropped {len(skipped_lines)} tiles in {context}! "
            f"The --no-tile-size-limit flag should be set."
        )


def _run_tile_join(inputs: list, output: Path, context: str,
                   name: str = None, description: str = None,
                   no_compression: bool = False) -> str:
    """Run a single tile-join command. Returns error string or None."""
    input_size_mb = sum(f.stat().st_size for f in inputs if f.exists()) / 1024 / 1024
    logger.info(f'    tile-join [{context}]: {len(inputs)} inputs, '
               f'{input_size_mb:.1f} MB total input'
               f'{" (no compression)" if no_compression else ""}')

    cmd = [
        'tile-join',
        '-o', str(output),
        '--force',
        '--no-tile-size-limit',
    ]
    if no_compression:
        cmd += ['--no-tile-compression']
    if name:
        cmd += ['-n', name]
    if description:
        cmd += ['-N', description]
    cmd += [str(f) for f in inputs]

    t0 = time.time()
    result = subprocess.run(cmd, capture_output=True, text=True)
    elapsed = time.time() - t0

    check_for_skipped_tiles(result.stderr, context)

    if result.returncode != 0:
        logger.error(f'    tile-join [{context}]: FAILED after {elapsed:.1f}s - '
                    f'{result.stderr[:200]}')
        return result.stderr[:200]
    if not output.exists():
        logger.error(f'    tile-join [{context}]: output file not created')
        return 'File not created'

    output_size_mb = output.stat().st_size / 1024 / 1024
    logger.info(f'    tile-join [{context}]: done in {elapsed:.1f}s -> '
               f'{output_size_mb:.1f} MB output')
    return None


def merge_mbtiles(input_files: list, output_path: Path, name: str,
                  description: str) -> tuple:
    """Merge MBTiles files using tile-join with a cascading tree merge.

    To keep memory bounded, merges are done in groups of CHUNK_SIZE.
    If chunking produces more than CHUNK_SIZE intermediates, the process
    repeats (tree merge) until a single file remains. Per-chart inputs
    are deleted after each chunk to free disk space.

    Args:
        input_files: List of Path objects to merge.
        output_path: Output MBTiles file path.
        name: Name metadata for the output.
        description: Description metadata for the output.

    Returns:
        (num_input_files, size_mb, error_string_or_None)
    """
    # Level 0: merge many small per-chart files in groups of 50
    # Level 1+: merge dense intermediates in small groups to keep memory bounded
    INITIAL_CHUNK_SIZE = 50
    DENSE_CHUNK_SIZE = 3  # triples for dense intermediates (fewer levels than pairwise)
    num_input = len(input_files)

    if not input_files:
        return (0, 0, 'No input files')

    total_input_mb = sum(f.stat().st_size for f in input_files if f.exists()) / 1024 / 1024
    work_dir = output_path.parent
    merge_start = time.time()

    def _log_disk():
        try:
            usage = shutil.disk_usage(work_dir)
            used_gb = (usage.total - usage.free) / 1024 / 1024 / 1024
            free_gb = usage.free / 1024 / 1024 / 1024
            logger.info(f'    Disk: {used_gb:.1f} GB used, {free_gb:.1f} GB free')
        except Exception:
            pass

    logger.info(f'  Merge start: {num_input} files, {total_input_mb:.1f} MB total input')
    _log_disk()

    # Small batch: merge directly (only if few small files)
    if num_input <= DENSE_CHUNK_SIZE:
        logger.info(f'  Merging {num_input} files directly into {name}...')
        error = _run_tile_join(sorted(input_files), output_path,
                               f"merge {name}", name, description)
        if error:
            return (num_input, 0, error)
        size_mb = output_path.stat().st_size / 1024 / 1024
        elapsed = time.time() - merge_start
        logger.info(f'  Merge complete: {size_mb:.1f} MB in {elapsed:.1f}s')
        return (num_input, size_mb, None)

    # Cascading tree merge
    temp_dir = output_path.parent / 'temp_merge'
    temp_dir.mkdir(parents=True, exist_ok=True)

    current_level = sorted(input_files)
    level_num = 0

    # Parallel workers: scale to available CPUs, capped per-level by chunk count
    cpu_count = os.cpu_count() or 4
    level0_workers = max(2, cpu_count)
    dense_workers = max(2, cpu_count)
    logger.info(f'  Parallel workers: up to {level0_workers} (L0), up to {dense_workers} (dense)')

    # Use large chunks for level 0 (small sparse per-chart files),
    # then triples for level 1+ (dense intermediates).
    # Intermediate merges skip tile compression to avoid redundant
    # decompress/recompress cycles — only the final merge compresses.
    while len(current_level) > DENSE_CHUNK_SIZE:
        chunk_size = INITIAL_CHUNK_SIZE if level_num == 0 else DENSE_CHUNK_SIZE
        is_intermediate = True  # skip compression for intermediate outputs
        total_chunks = (len(current_level) + chunk_size - 1) // chunk_size
        # Cap workers at actual chunk count — no idle threads
        workers = min(total_chunks, level0_workers if level_num == 0 else dense_workers)
        level_start = time.time()
        logger.info(f'  === Merge level {level_num}: {len(current_level)} files -> '
                    f'{total_chunks} chunks of up to {chunk_size} '
                    f'({workers} workers, no compression) ===')

        # Build chunk list
        chunks = []
        for i in range(0, len(current_level), chunk_size):
            chunk = current_level[i:i + chunk_size]
            chunk_num = i // chunk_size
            temp_output = temp_dir / f'{name}_L{level_num}_C{chunk_num}.mbtiles'
            chunks.append((chunk_num, chunk, temp_output))

        # Run chunks in parallel
        next_level = [None] * len(chunks)
        first_error = None

        def _merge_chunk(args):
            cnum, files, out_path = args
            logger.info(f'  Chunk {cnum + 1}/{total_chunks} ({len(files)} files)...')
            err = _run_tile_join(files, out_path,
                                f"L{level_num} chunk {cnum} of {name}",
                                no_compression=is_intermediate)
            if not err:
                # Delete inputs to free disk
                for f in files:
                    f.unlink(missing_ok=True)
            return cnum, out_path, err

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_merge_chunk, c): c for c in chunks}
            for future in as_completed(futures):
                cnum, out_path, error = future.result()
                if error and not first_error:
                    first_error = f'L{level_num} chunk {cnum} failed: {error[:100]}'
                next_level[cnum] = out_path

        if first_error:
            for tf in next_level:
                if tf:
                    tf.unlink(missing_ok=True)
            return (num_input, 0, first_error)

        _log_disk()

        level_elapsed = time.time() - level_start
        level_size_mb = sum(f.stat().st_size for f in next_level if f and f.exists()) / 1024 / 1024
        logger.info(f'  === Level {level_num} complete: {len(next_level)} files, '
                    f'{level_size_mb:.1f} MB in {level_elapsed:.1f}s ===')

        current_level = next_level
        level_num += 1

    # Final merge of remaining files (<=DENSE_CHUNK_SIZE, i.e. 2-3 files)
    logger.info(f'  Final merge ({len(current_level)} files, with compression)...')

    error = _run_tile_join(current_level, output_path,
                           f"final merge for {name}", name, description)

    # Clean up intermediates
    for tf in current_level:
        tf.unlink(missing_ok=True)
    try:
        temp_dir.rmdir()
    except Exception:
        pass

    if error:
        return (num_input, 0, error)
    size_mb = output_path.stat().st_size / 1024 / 1024
    total_elapsed = time.time() - merge_start
    logger.info(f'  Merge complete: {num_input} charts -> {size_mb:.1f} MB '
               f'in {total_elapsed:.1f}s')
    _log_disk()
    return (num_input, size_mb, None)
