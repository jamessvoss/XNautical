#!/bin/bash
# Push GNIS place names MBTiles to the connected iOS/Android device
# 
# Usage:
#   ./scripts/push-gnis-to-device.sh [ios|android]
#
# This copies the GNIS MBTiles file to the device's mbtiles directory
# where the app's tile server will find and serve it.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Check multiple locations for the GNIS file
GNIS_LOCATIONS=(
    "$PROJECT_DIR/charts/US Domestic Names/Alaska/gnis_names_ak.mbtiles"
    "$PROJECT_DIR/assets/Maps/gnis_names_ak.mbtiles"
)

GNIS_FILE=""
for loc in "${GNIS_LOCATIONS[@]}"; do
    if [ -f "$loc" ]; then
        GNIS_FILE="$loc"
        break
    fi
done

# Check if file exists
if [ -z "$GNIS_FILE" ]; then
    echo "Error: GNIS file not found. Checked:"
    for loc in "${GNIS_LOCATIONS[@]}"; do
        echo "  - $loc"
    done
    echo ""
    echo "Run the conversion script first:"
    echo "  python scripts/convert_gnis_names.py 'charts/US Domestic Names/Alaska/DomesticNames_AK.txt'"
    exit 1
fi

FILE_SIZE=$(du -h "$GNIS_FILE" | cut -f1)
echo "GNIS file: $GNIS_FILE ($FILE_SIZE)"

PLATFORM="${1:-ios}"

if [ "$PLATFORM" = "ios" ]; then
    echo "Pushing to iOS device..."
    
    # Get the app's documents directory on the simulator/device
    # This uses xcrun to find the app container
    BUNDLE_ID="com.xnautical.app"
    
    # For simulator - find the app container
    if xcrun simctl list devices | grep -q "Booted"; then
        echo "Found booted iOS Simulator"
        
        # Get the booted device UDID
        DEVICE_UDID=$(xcrun simctl list devices | grep "Booted" | head -1 | grep -oE "[A-F0-9-]{36}")
        echo "Device UDID: $DEVICE_UDID"
        
        # Get the app container path
        APP_CONTAINER=$(xcrun simctl get_app_container "$DEVICE_UDID" "$BUNDLE_ID" data 2>/dev/null || echo "")
        
        if [ -z "$APP_CONTAINER" ]; then
            echo "Error: App not installed on simulator. Run the app first, then try again."
            exit 1
        fi
        
        MBTILES_DIR="$APP_CONTAINER/Documents/mbtiles"
        echo "App container: $APP_CONTAINER"
        echo "MBTiles directory: $MBTILES_DIR"
        
        # Create directory if needed
        mkdir -p "$MBTILES_DIR"
        
        # Copy the file
        cp "$GNIS_FILE" "$MBTILES_DIR/"
        
        echo "✓ Copied gnis_names_ak.mbtiles to iOS Simulator"
        echo ""
        echo "Restart the app to load the new data."
    else
        echo "No iOS Simulator is booted."
        echo "For physical devices, use Xcode or Apple Configurator to copy files."
        exit 1
    fi
    
elif [ "$PLATFORM" = "android" ]; then
    echo "Pushing to Android device..."
    
    # Check for connected device
    if ! adb devices | grep -q "device$"; then
        echo "Error: No Android device connected."
        echo "Connect a device or start an emulator first."
        exit 1
    fi
    
    # The mbtiles directory on Android (external app storage - accessible via adb)
    ANDROID_PATH="/storage/emulated/0/Android/data/com.xnautical.app/files/mbtiles"
    
    # Create directory
    adb shell "mkdir -p '$ANDROID_PATH'" 2>/dev/null || true
    
    # Push file
    adb push "$GNIS_FILE" "$ANDROID_PATH/gnis_names_ak.mbtiles"
    
    # Fix permissions
    adb shell "chmod 775 '$ANDROID_PATH/gnis_names_ak.mbtiles'" 2>/dev/null || true
    
    echo "✓ Copied gnis_names_ak.mbtiles to Android device"
    echo ""
    echo "Restart the app to load the new data."
    
else
    echo "Usage: $0 [ios|android]"
    exit 1
fi

echo ""
echo "Done!"
