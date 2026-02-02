#!/bin/bash
# Push file via adb with progress indicator
# Usage: ./adb_push_progress.sh <local_file> <remote_path>

set -e

LOCAL_FILE="$1"
REMOTE_PATH="$2"
CHUNK_SIZE=$((100 * 1024 * 1024))  # 100MB chunks

if [ -z "$LOCAL_FILE" ] || [ -z "$REMOTE_PATH" ]; then
    echo "Usage: $0 <local_file> <remote_path>"
    echo "Example: $0 alaska_full.mbtiles /sdcard/alaska_full.mbtiles"
    exit 1
fi

if [ ! -f "$LOCAL_FILE" ]; then
    echo "Error: File not found: $LOCAL_FILE"
    exit 1
fi

FILE_SIZE=$(stat -f%z "$LOCAL_FILE" 2>/dev/null || stat -c%s "$LOCAL_FILE" 2>/dev/null)
FILE_NAME=$(basename "$LOCAL_FILE")
TOTAL_MB=$((FILE_SIZE / 1024 / 1024))

echo "Pushing $FILE_NAME ($TOTAL_MB MB) to $REMOTE_PATH"
echo "Progress: "

# Use dd to read chunks and show progress
BYTES_SENT=0
CHUNK_NUM=0

# Start background push and monitor
adb push "$LOCAL_FILE" "$REMOTE_PATH" 2>&1 &
ADB_PID=$!

# Monitor progress by checking remote file size
while kill -0 $ADB_PID 2>/dev/null; do
    REMOTE_SIZE=$(adb shell "stat -c%s '$REMOTE_PATH' 2>/dev/null || echo 0" | tr -d '\r')
    if [ -n "$REMOTE_SIZE" ] && [ "$REMOTE_SIZE" -gt 0 ]; then
        MB_SENT=$((REMOTE_SIZE / 1024 / 1024))
        PCT=$((REMOTE_SIZE * 100 / FILE_SIZE))
        printf "\r  %d MB / %d MB (%d%%)" "$MB_SENT" "$TOTAL_MB" "$PCT"
        
        # Print hash every 100MB
        NEW_CHUNK=$((REMOTE_SIZE / CHUNK_SIZE))
        while [ "$CHUNK_NUM" -lt "$NEW_CHUNK" ]; do
            CHUNK_NUM=$((CHUNK_NUM + 1))
            printf " #"
        done
    fi
    sleep 2
done

wait $ADB_PID
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo "Done! Pushed $TOTAL_MB MB"
else
    echo "Error: adb push failed with code $EXIT_CODE"
fi

exit $EXIT_CODE
