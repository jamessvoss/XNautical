#!/usr/bin/env python3
"""
Create white halo versions of beacon symbols for improved visibility.
This script takes the existing beacon PNG files and creates white versions
that can be used as halos beneath the original symbols.
"""

from PIL import Image, ImageFilter, ImageOps
import os
from pathlib import Path

# Paths
SYMBOLS_DIR = Path(__file__).parent.parent / "assets" / "symbols" / "png"
OUTPUT_DIR = SYMBOLS_DIR  # Output to same directory

# Beacon symbol base names
BEACON_TYPES = [
    'beacon-stake',
    'beacon-tower',
    'beacon-generic',
    'beacon-lattice',
    'beacon-withy',
    'beacon-cairn',
    'lighted-beacon'
]

# Resolution suffixes
RESOLUTIONS = ['', '@2x', '@3x']

def create_white_halo(input_path: Path, output_path: Path, expand_pixels: int = 2):
    """
    Create a white halo version of a beacon symbol.
    
    Args:
        input_path: Path to the original beacon PNG
        output_path: Path to save the white halo version
        expand_pixels: How many pixels to expand the white halo (creates thickness)
    """
    # Open the image
    img = Image.open(input_path).convert('RGBA')
    
    # Extract the alpha channel (transparency)
    alpha = img.split()[3]
    
    # Create a white version - take the alpha channel and make all non-transparent pixels white
    white_img = Image.new('RGBA', img.size, (255, 255, 255, 0))
    
    # Copy the alpha channel to create a mask of where the symbol is
    # Any pixel with alpha > 0 becomes white
    pixels = img.load()
    white_pixels = white_img.load()
    
    for y in range(img.size[1]):
        for x in range(img.size[0]):
            r, g, b, a = pixels[x, y]
            if a > 0:  # If pixel has any opacity
                white_pixels[x, y] = (255, 255, 255, a)  # Make it white with same alpha
    
    # Optionally expand the white halo by applying dilation
    if expand_pixels > 0:
        # Extract alpha, expand it, then apply back to white image
        alpha_expanded = alpha
        for _ in range(expand_pixels):
            alpha_expanded = alpha_expanded.filter(ImageFilter.MaxFilter(3))
        
        # Create new white image with expanded alpha
        white_expanded = Image.new('RGBA', img.size, (255, 255, 255, 0))
        white_expanded.putalpha(alpha_expanded)
        
        # Fill with white where we have alpha
        white_pixels_exp = white_expanded.load()
        alpha_pixels = alpha_expanded.load()
        for y in range(img.size[1]):
            for x in range(img.size[0]):
                a = alpha_pixels[x, y]
                if a > 0:
                    white_pixels_exp[x, y] = (255, 255, 255, a)
        
        white_img = white_expanded
    
    # Save the result
    white_img.save(output_path, 'PNG')
    print(f"Created: {output_path.name}")

def main():
    print("Creating white halo versions of beacon symbols...")
    print(f"Input directory: {SYMBOLS_DIR}")
    
    created_count = 0
    
    for beacon_type in BEACON_TYPES:
        for resolution in RESOLUTIONS:
            filename = f"{beacon_type}{resolution}.png"
            output_filename = f"{beacon_type}-halo{resolution}.png"
            
            input_path = SYMBOLS_DIR / filename
            output_path = SYMBOLS_DIR / output_filename
            
            if input_path.exists():
                try:
                    # Adjust expansion based on resolution
                    if resolution == '@3x':
                        expand = 3
                    elif resolution == '@2x':
                        expand = 2
                    else:
                        expand = 1
                    
                    create_white_halo(input_path, output_path, expand_pixels=expand)
                    created_count += 1
                except Exception as e:
                    print(f"Error processing {filename}: {e}")
            else:
                print(f"Skipping {filename} (not found)")
    
    print(f"\nCompleted! Created {created_count} white halo beacon symbols.")
    print(f"Output files are named with '-halo' suffix (e.g., beacon-lattice-halo.png)")

if __name__ == "__main__":
    main()
