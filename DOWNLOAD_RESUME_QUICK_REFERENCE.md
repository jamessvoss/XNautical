# Download Resume Feature - Quick Reference

## 🚀 How It Works

### For Users:
1. **Start download** → Screen stays awake automatically
2. **Switch tabs** → Downloads continue in background
3. **Press home button** → Downloads pause, state saved
4. **Return to app** → "Resume Downloads?" dialog appears
5. **Resume** → Continues from where it left off

---

## 🔑 Key Components

### DownloadManager (`src/services/downloadManager.ts`)
Central service managing all downloads:
- Tracks all active downloads globally
- Handles pause/resume automatically
- Manages keep-awake state
- Persists state to AsyncStorage

### App.tsx
App-level integration:
- AppState listener (line ~300)
- Resume dialog modal (line ~375)
- State restoration on launch (line ~300)

### DownloadPanel.tsx
UI for downloads:
- Incomplete downloads banner (line ~1012)
- Resume button handler (line ~127)
- Checks for incomplete on load (line ~106)

### chartPackService.ts
Chart downloads:
- Uses DownloadManager (line ~417)
- Progress via subscriptions (line ~454)

### stationService.ts
Prediction downloads:
- Uses DownloadManager (line ~446)
- Fetches actual file sizes (line ~464)

---

## 📱 User-Facing Features

### 1. Keep Screen Awake
- Prevents phone from sleeping during downloads
- Auto-activates when first download starts
- Auto-deactivates when all complete

### 2. Pause on Background
- Automatically pauses when home button pressed
- Saves progress every 5 seconds
- Battery-friendly

### 3. Resume Options
**A. Global Dialog** (when returning from background)
- Shows: "You have X paused downloads"
- Buttons: "Resume All" or "Later"

**B. Download Panel Banner** (when incomplete exist)
- Shows: "Incomplete Downloads - You have paused downloads"
- Button: "Resume"

### 4. Tab Navigation
- Switch tabs freely
- Downloads continue automatically
- No user action needed

### 5. State Persistence
- Survives app restart
- Restores incomplete downloads
- Clears completed automatically

---

## 🧪 Testing Quick Commands

```bash
# Build and run on device
npx expo run:ios
# or
npx expo run:android

# Test scenario:
# 1. Start download
# 2. Press home button
# 3. Wait 10 seconds
# 4. Reopen app
# 5. Should see resume dialog
```

---

## 🐛 Troubleshooting

### Issue: Downloads don't resume
**Check:**
- Is `expo-keep-awake` installed? (`npm list expo-keep-awake`)
- Are there console logs from DownloadManager?
- Check AsyncStorage: `@XNautical:downloadManager`

### Issue: Screen still sleeps
**Check:**
- Is keep-awake activating? (check console logs)
- Try calling `activateKeepAwakeAsync()` manually in a test

### Issue: Downloads restart from 0%
**Check:**
- Is state saving? (check console every 5 seconds)
- Is AsyncStorage persisting?
- Check for errors in `loadState()`

### Issue: Resume dialog doesn't appear
**Check:**
- Is AppState listener registered? (check console on app launch)
- Background and return - check console for "Paused all downloads"
- Check if `getPausedDownloads()` returns any items

---

## 📊 State Management

### AsyncStorage Key:
`@XNautical:downloadManager`

### Stored Data:
```json
[
  {
    "id": "17cgd_chart_charts-US4",
    "type": "chart",
    "districtId": "17cgd",
    "packId": "charts-US4",
    "url": "https://...",
    "destination": "/path/to/file.zip",
    "progress": 42,
    "status": "paused",
    "bytesDownloaded": 1234567,
    "totalBytes": 2934567,
    "startTime": 1707591234567,
    "resumeData": "..." 
  }
]
```

---

## 🎯 What's Different from Before

### Before:
- Downloads stopped if user switched tabs or backgrounded app
- No way to resume interrupted downloads
- Screen could sleep, interrupting downloads
- Downloads tied to component lifecycle
- No persistence across restarts

### After:
- ✅ Downloads survive tab switches
- ✅ Pause/resume on background
- ✅ Screen stays awake
- ✅ Downloads at app level
- ✅ Persist across restarts
- ✅ Multiple resume options
- ✅ Battery-friendly

---

## 📝 Console Log Markers

Look for these in console during testing:

```
[DownloadManager] Loading X persisted downloads
[DownloadManager] Starting download: {id}
[DownloadManager] Activating keep-awake
[App] Paused all downloads - app backgrounded
[App] Found X paused downloads
[DownloadManager] Resuming download: {id}
[DownloadManager] Download completed: {id}
[DownloadManager] Deactivating keep-awake
[DownloadManager] Saved state for X downloads
```

---

## 🔐 Safety Features

1. **No Duplicate Downloads:** Manager checks if download already active
2. **Cleanup on Failure:** Partial files deleted automatically
3. **State Validation:** Corrupted state handled gracefully
4. **Keep-Awake Cleanup:** Always deactivates when done
5. **Memory Management:** Completed downloads removed from memory

---

## 💡 Pro Tips

1. **Test on physical device** - Simulators don't accurately simulate sleep behavior
2. **Monitor console logs** - All key events are logged
3. **Check AsyncStorage** - Verify state is persisting (React Native Debugger)
4. **Test with airplane mode** - Verify network error handling
5. **Force quit during extraction** - Verify extraction phase behavior

---

**Ready to test!** See `DOWNLOAD_RESUME_TESTING.md` for full test scenarios.
