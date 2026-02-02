#!/usr/bin/env python3
"""
Automatically create white halo versions for all beacon, buoy, and other symbols.
Converts all non-transparent pixels to white while preserving alpha channel.
"""

from PIL import Image
import os
from pathlib import Path

# Base directory
SYMBOLS_DIR = Path(__file__).parent.parent / "assets" / "symbols" / "png"

# Symbol types to process (base names without resolution suffixes)
SYMBOLS_TO_PROCESS = [
    # Beacons (some already done)
    'beacon-stake',
    'beacon-tower', 
    'beacon-generic',
    'beacon-lattice',
    'beacon-withy',
    'beacon-cairn',
    
    # Buoys (some already done)
    'buoy-pillar',
    'buoy-spherical',
    'buoy-super',
    'buoy-conical',
    'buoy-can',
    'buoy-spar',
    'buoy-barrel',
    
    # Landmarks
    'landmark-tower',
    'landmark-chimney',
    'landmark-monument',
    'landmark-flagpole',
    'landmark-mast',
    'landmark-windmill',
    'landmark-radio-tower',
    'landmark-church',
    
    # Hazards/Other
    'riptide',
]

# Resolution suffixes
RESOLUTIONS = ['', '@2x', '@3x']

def create_white_halo(input_path: Path, output_path: Path, skip_if_exists: bool = True):
    """
    Create a white halo version of a symbol.
    Converts all non-transparent pixels to pure white (255,255,255).
    Preserves the alpha channel exactly.
    
    Args:
        input_path: Path to the original symbol PNG
        output_path: Path to save the white halo version
        skip_if_exists: If True, skip files that already exist
    """
    # Skip if output already exists
    if skip_if_exists and output_path.exists():
        print(f"  ⏭️  Skipping {output_path.name} (already exists)")
        return False
    
    # Open the image
    img = Image.open(input_path).convert('RGBA')
    
    # Create a new white image with same dimensions
    white_img = Image.new('RGBA', img.size, (255, 255, 255, 0))
    
    # Get pixel data
    pixels = img.load()
    white_pixels = white_img.load()
    
    # Convert all non-transparent pixels to white
    for y in range(img.size[1]):
        for x in range(img.size[0]):
            r, g, b, a = pixels[x, y]
            if a > 0:  # If pixel has any opacity
                white_pixels[x, y] = (255, 255, 255, a)  # Make it white with same alpha
    
    # Save the result
    white_img.save(output_path, 'PNG')
    print(f"  ✅ Created: {output_path.name}")
    return True

def main():
    print("=" * 70)
    print("Creating white halo versions for all symbols")
    print("=" * 70)
    print(f"Working directory: {SYMBOLS_DIR}\n")
    
    created_count = 0
    skipped_count = 0
    error_count = 0
    
    for symbol_base in SYMBOLS_TO_PROCESS:
        print(f"\n📦 Processing: {symbol_base}")
        
        for resolution in RESOLUTIONS:
            filename = f"{symbol_base}{resolution}.png"
            output_filename = f"{symbol_base}-halo{resolution}.png"
            
            input_path = SYMBOLS_DIR / filename
            output_path = SYMBOLS_DIR / output_filename
            
            if not input_path.exists():
                print(f"  ⚠️  Source not found: {filename}")
                continue
            
            try:
                created = create_white_halo(input_path, output_path, skip_if_exists=True)
                if created:
                    created_count += 1
                else:
                    skipped_count += 1
            except Exception as e:
                print(f"  ❌ Error processing {filename}: {e}")
                error_count += 1
    
    print("\n" + "=" * 70)
    print("Summary:")
    print(f"  ✅ Created: {created_count} files")
    print(f"  ⏭️  Skipped: {skipped_count} files (already exist)")
    if error_count > 0:
        print(f"  ❌ Errors: {error_count} files")
    print("=" * 70)
    print("\nDone! All halo files have been created.")
    print("Note: Files that already existed were skipped.")

if __name__ == "__main__":
    main()
