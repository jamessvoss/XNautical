#!/usr/bin/env python3
"""
Process tide and current arrow icons.

Takes the source arrow PNGs and creates:
- Recolored versions with blue (tide) and magenta (current) gradients
- 5 fill levels (20%, 40%, 60%, 80%, 100%) with grey unfilled portions
- Multiple sizes (32, 64, 96 pixels)
- Chevron markers at fill level boundaries
"""

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import numpy as np
import os

# Output directory
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets', 'symbols', 'png')

# App colors
TIDE_COLOR = (0, 102, 204)      # #0066CC - blue
CURRENT_COLOR = (204, 0, 102)   # #CC0066 - magenta
GREY_UNFILLED = (0, 0, 0)       # Pure black for unfilled
UNFILLED_ALPHA = 179            # 30% translucent / 70% opaque (0-255)

# Fill levels
FILL_LEVELS = [20, 40, 60, 80, 100]

# Output sizes (height - width calculated from aspect ratio)
SIZES = {
    '': 48,      # base height
    '@2x': 96,   # 2x height
    '@3x': 144,  # 3x height
}


def analyze_image(img):
    """Analyze the image to find the colored interior region."""
    # Convert to numpy for analysis
    arr = np.array(img)
    
    # Find non-transparent pixels
    if arr.shape[2] == 4:  # RGBA
        alpha = arr[:, :, 3]
        visible = alpha > 50
    else:
        visible = np.ones((arr.shape[0], arr.shape[1]), dtype=bool)
    
    # Find the bounding box of the visible region
    rows = np.any(visible, axis=1)
    cols = np.any(visible, axis=0)
    ymin, ymax = np.where(rows)[0][[0, -1]]
    xmin, xmax = np.where(cols)[0][[0, -1]]
    
    return {
        'bbox': (xmin, ymin, xmax, ymax),
        'width': img.width,
        'height': img.height,
    }


def is_colored_pixel(r, g, b, a):
    """Check if a pixel is part of the colored interior (not border/shadow)."""
    if a < 100:
        return False
    
    # Check for saturation - colored pixels have distinct RGB values
    max_rgb = max(r, g, b)
    min_rgb = min(r, g, b)
    saturation = (max_rgb - min_rgb) / max(max_rgb, 1)
    
    # Also check it's not too grey (border is metallic grey)
    grey_diff = abs(r - g) + abs(g - b) + abs(r - b)
    
    return saturation > 0.15 or grey_diff > 30


def colorize_pixel(r, g, b, a, base_color, is_filled):
    """
    Colorize a pixel while preserving its luminosity/texture.
    This keeps the chevron patterns and shading from the original.
    """
    if a < 50:
        return (r, g, b, a)
    
    # Calculate luminosity of original pixel
    luminosity = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    
    if not is_filled:
        # Pure black at 50% transparency for unfilled portions
        new_r = 0
        new_g = 0
        new_b = 0
        new_a = UNFILLED_ALPHA  # 50% translucent (128)
    else:
        # Colorize with base color while preserving luminosity
        br, bg, bb = base_color
        # Blend the base color with luminosity to preserve texture
        new_r = int(br * (0.4 + luminosity * 0.6))
        new_g = int(bg * (0.4 + luminosity * 0.6))
        new_b = int(bb * (0.4 + luminosity * 0.6))
        new_a = a  # Keep original alpha for filled portions
    
    return (min(255, new_r), min(255, new_g), min(255, new_b), new_a)


def recolor_arrow(img, base_color, fill_percent):
    """
    Recolor the arrow interior with gradient and fill level.
    Preserves the original texture/chevrons by using colorization.
    
    Args:
        img: Source PIL Image
        base_color: RGB tuple for the main color
        fill_percent: 0-100, how much of the arrow is filled
    """
    # Work with a copy
    img = img.copy().convert('RGBA')
    pixels = img.load()
    width, height = img.size
    
    # Find the vertical extent of the arrow for fill calculation
    # The arrow points up, so fill starts from bottom
    arr = np.array(img)
    alpha = arr[:, :, 3]
    visible_rows = np.any(alpha > 50, axis=1)
    
    if not np.any(visible_rows):
        return img
        
    top_row = np.where(visible_rows)[0][0]
    bottom_row = np.where(visible_rows)[0][-1]
    arrow_height = bottom_row - top_row
    
    # Calculate fill threshold (from bottom up)
    fill_row = bottom_row - int(arrow_height * fill_percent / 100)
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            
            if is_colored_pixel(r, g, b, a):
                # Determine if this pixel should be filled or grey
                is_filled = y >= fill_row
                
                # Colorize while preserving texture
                new_color = colorize_pixel(r, g, b, a, base_color, is_filled)
                pixels[x, y] = new_color
    
    return img


def add_chevron_markers(img, fill_percent, base_color):
    """Add subtle chevron markers at fill level boundaries."""
    # This is optional - the original images already have chevrons
    # We could enhance them at the fill boundaries
    return img


def create_white_halo(img):
    """
    Create a white silhouette version of the arrow for use as a halo/stroke layer.
    This converts all visible pixels to solid white.
    
    Args:
        img: Source PIL Image (RGBA)
    
    Returns:
        PIL Image with white silhouette
    """
    img = img.copy().convert('RGBA')
    pixels = img.load()
    width, height = img.size
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            
            # Convert any visible pixel to white
            if a > 50:
                pixels[x, y] = (255, 255, 255, a)
    
    return img


def process_halo(source_path, icon_type):
    """
    Process a source arrow image into white halo versions.
    
    Args:
        source_path: Path to source PNG
        icon_type: 'tide' or 'current'
    """
    print(f"\nProcessing {icon_type} halo from {source_path}")
    
    # Load source image
    img = Image.open(source_path).convert('RGBA')
    print(f"  Source size: {img.width}x{img.height}")
    
    # Create white halo version
    halo = create_white_halo(img)
    
    # Generate each size (preserve aspect ratio)
    for suffix, target_height in SIZES.items():
        # Calculate width to preserve aspect ratio
        aspect_ratio = halo.width / halo.height
        target_width = int(target_height * aspect_ratio)
        
        # Resize with high-quality resampling
        resized = halo.resize((target_width, target_height), Image.Resampling.LANCZOS)
        
        # Generate filename
        filename = f"{icon_type}-halo{suffix}.png"
        filepath = os.path.join(OUTPUT_DIR, filename)
        
        # Save
        resized.save(filepath, 'PNG')
        print(f"  Saved: {filename} ({target_width}x{target_height})")


def process_arrow(source_path, icon_type, base_color):
    """
    Process a source arrow image into all required variants.
    
    Args:
        source_path: Path to source PNG
        icon_type: 'tide' or 'current'
        base_color: RGB tuple
    """
    print(f"\nProcessing {icon_type} arrow from {source_path}")
    
    # Load source image
    img = Image.open(source_path).convert('RGBA')
    print(f"  Source size: {img.width}x{img.height}")
    
    # Generate each fill level
    for fill in FILL_LEVELS:
        print(f"  Creating {fill}% fill...")
        
        # Recolor with gradient and fill level
        recolored = recolor_arrow(img, base_color, fill)
        
        # Generate each size (preserve aspect ratio)
        for suffix, target_height in SIZES.items():
            # Calculate width to preserve aspect ratio
            aspect_ratio = recolored.width / recolored.height
            target_width = int(target_height * aspect_ratio)
            
            # Resize with high-quality resampling
            resized = recolored.resize((target_width, target_height), Image.Resampling.LANCZOS)
            
            # Generate filename
            filename = f"{icon_type}-{fill}{suffix}.png"
            filepath = os.path.join(OUTPUT_DIR, filename)
            
            # Save
            resized.save(filepath, 'PNG')
            print(f"    Saved: {filename} ({target_width}x{target_height})")


def main():
    """Main entry point."""
    print("Processing station icons...")
    
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Source files
    tide_source = "/Users/jvoss/Downloads/Tides Arrow.png"
    current_source = "/Users/jvoss/Downloads/Currents Arrow.png"
    
    # Check if source files exist
    if not os.path.exists(tide_source):
        print(f"ERROR: Tide source not found: {tide_source}")
        return
    if not os.path.exists(current_source):
        print(f"ERROR: Current source not found: {current_source}")
        return
    
    # Process tide arrow (blue)
    process_arrow(tide_source, 'tide', TIDE_COLOR)
    
    # Process current arrow (magenta)
    process_arrow(current_source, 'current', CURRENT_COLOR)
    
    # Process white halo versions (for stroke/outline effect)
    process_halo(tide_source, 'tide')
    process_halo(current_source, 'current')
    
    print("\n" + "="*50)
    print("Done! Generated icons:")
    print(f"  Tide: 5 fill levels × 3 sizes = 15 files")
    print(f"  Current: 5 fill levels × 3 sizes = 15 files")
    print(f"  Tide halo: 1 × 3 sizes = 3 files")
    print(f"  Current halo: 1 × 3 sizes = 3 files")
    print(f"  Total: 36 PNG files")


if __name__ == '__main__':
    main()
