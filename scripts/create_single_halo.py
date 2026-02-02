#!/usr/bin/env python3
"""
Create white halo version for a single symbol file.
Usage: python create_single_halo.py <symbol-name>
Example: python create_single_halo.py beacon-withy

Can be run from any directory - will find the symbols automatically.
"""

from PIL import Image
import sys
import os
from pathlib import Path

def find_symbols_dir():
    """Find the symbols directory by checking common locations."""
    # If we're already in the png directory
    if Path.cwd().name == 'png' and (Path.cwd() / 'beacon-tower.png').exists():
        return Path.cwd()
    
    # If we're in the XNautical root
    symbols_dir = Path.cwd() / "assets" / "symbols" / "png"
    if symbols_dir.exists():
        return symbols_dir
    
    # If we're in the scripts directory
    symbols_dir = Path.cwd().parent / "assets" / "symbols" / "png"
    if symbols_dir.exists():
        return symbols_dir
    
    # Try to find it relative to the script location
    script_dir = Path(__file__).parent
    symbols_dir = script_dir.parent / "assets" / "symbols" / "png"
    if symbols_dir.exists():
        return symbols_dir
    
    return None

# Base directory
SYMBOLS_DIR = find_symbols_dir()

# Resolution suffixes
RESOLUTIONS = ['', '@2x', '@3x']

def create_white_halo(input_path: Path, output_path: Path):
    """
    Create a white halo version of a symbol.
    Converts all non-transparent pixels to pure white (255,255,255).
    Preserves the alpha channel exactly.
    """
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
    print(f"✅ Created: {output_path.name}")

def main():
    if SYMBOLS_DIR is None:
        print("❌ Error: Could not find symbols directory!")
        print(f"Current directory: {Path.cwd()}")
        print("\nPlease run this script from one of these locations:")
        print("  - /Users/jvoss/Documents/XNautical/assets/symbols/png")
        print("  - /Users/jvoss/Documents/XNautical")
        print("  - /Users/jvoss/Documents/XNautical/scripts")
        sys.exit(1)
    
    if len(sys.argv) < 2:
        print("Usage: python create_single_halo.py <symbol-name>")
        print("Example: python create_single_halo.py beacon-withy")
        print("\nThis will create:")
        print("  - beacon-withy-halo.png")
        print("  - beacon-withy-halo@2x.png")
        print("  - beacon-withy-halo@3x.png")
        sys.exit(1)
    
    symbol_base = sys.argv[1]
    
    print(f"\n📦 Processing: {symbol_base}")
    print(f"Working directory: {SYMBOLS_DIR}\n")
    
    created_count = 0
    
    for resolution in RESOLUTIONS:
        filename = f"{symbol_base}{resolution}.png"
        output_filename = f"{symbol_base}-halo{resolution}.png"
        
        input_path = SYMBOLS_DIR / filename
        output_path = SYMBOLS_DIR / output_filename
        
        if not input_path.exists():
            print(f"⚠️  Source not found: {filename}")
            continue
        
        if output_path.exists():
            print(f"⏭️  Skipping {output_filename} (already exists)")
            continue
        
        try:
            create_white_halo(input_path, output_path)
            created_count += 1
        except Exception as e:
            print(f"❌ Error processing {filename}: {e}")
    
    print(f"\n✨ Done! Created {created_count} halo files.")

if __name__ == "__main__":
    main()
