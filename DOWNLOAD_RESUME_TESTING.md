# Download Resume Feature - Testing Checklist

## Overview
This document provides comprehensive testing scenarios for the new download pause/resume feature with keep-awake support.

---

## ✅ Test 1: Keep Awake During Downloads

**Objective:** Verify screen stays awake during active downloads

**Steps:**
1. Start app and navigate to RegionSelector
2. Select a district and start "Download All"
3. Let the device sit idle (don't touch screen)
4. Wait for screen dim timeout (usually 30 seconds)
5. Observe for 2-3 minutes

**Expected Results:**
- ✅ Screen stays lit and doesn't sleep
- ✅ Downloads continue at full speed
- ✅ Progress updates continue displaying
- ✅ Device doesn't auto-lock

**Pass Criteria:**
- Screen remains on for entire duration
- No interruption to download

---

## ✅ Test 2: Tab Navigation During Downloads

**Objective:** Verify downloads continue when switching tabs

**Steps:**
1. Start "Download All" in RegionSelector
2. Wait for first item to reach ~25% progress
3. Navigate to "Weather" tab
4. Wait 30 seconds
5. Navigate to "Waypoints" tab
6. Wait 30 seconds
7. Navigate back to "Context" tab → "Downloads" button
8. Open RegionSelector to view progress

**Expected Results:**
- ✅ Downloads continue running in background
- ✅ Progress continues even when not viewing downloads
- ✅ When returning to downloads screen, progress has advanced
- ✅ No errors or crashes

**Pass Criteria:**
- Progress at step 8 should be significantly higher than step 2
- Downloads complete successfully

---

## ✅ Test 3: App Backgrounding (Home Button)

**Objective:** Verify downloads pause gracefully and can resume

**Steps:**
1. Start "Download All" 
2. Wait for first item to reach ~40% progress
3. Press home button (background the app)
4. Wait 10 seconds
5. Return to app (tap app icon)

**Expected Results:**
- ✅ Downloads pause automatically when app backgrounds
- ✅ Resume dialog appears when returning: "You have X paused downloads"
- ✅ Tap "Resume All" button
- ✅ Downloads continue from where they left off (~40%)
- ✅ Keep-awake reactivates
- ✅ Downloads complete successfully

**Pass Criteria:**
- Resume prompt shows correct count
- Downloads resume from previous progress (not starting over)
- No data corruption or errors

---

## ✅ Test 4: Dismiss Resume Dialog

**Objective:** Verify user can defer resuming downloads

**Steps:**
1. Start "Download All"
2. Wait for ~25% progress
3. Background app
4. Return to app
5. Tap "Later" on resume dialog
6. Navigate to RegionSelector
7. Open district download panel

**Expected Results:**
- ✅ Resume dialog dismisses
- ✅ Downloads remain paused
- ✅ Download panel shows "Incomplete Downloads" banner
- ✅ Tap "Resume" button in banner
- ✅ Downloads resume from previous progress

**Pass Criteria:**
- User has full control over when to resume
- Banner persists until user resumes or cancels
- Resume works from either location (global dialog or panel banner)

---

## ✅ Test 5: App Force Quit and Restart

**Objective:** Verify downloads persist across app restarts

**Steps:**
1. Start "Download All"
2. Wait for ~60% progress (multiple items downloaded)
3. Force quit app (swipe up from task switcher)
4. Wait 5 seconds
5. Reopen app

**Expected Results:**
- ✅ App launches normally
- ✅ Resume dialog does NOT appear immediately (downloads stay paused)
- ✅ Navigate to RegionSelector → District
- ✅ "Incomplete Downloads" banner appears in download panel
- ✅ Tap "Resume" button
- ✅ Downloads continue from ~60% progress
- ✅ Only downloads remaining items (already completed items stay completed)

**Pass Criteria:**
- State persists across app restart
- Already downloaded files are not re-downloaded
- Downloads complete successfully

---

## ✅ Test 6: Multiple Downloads in Parallel

**Objective:** Verify multiple simultaneous downloads can pause/resume

**Steps:**
1. Start "Download All" for a district with many items
2. Wait until 2-3 items are actively downloading in parallel
3. Background app
4. Return and resume

**Expected Results:**
- ✅ All active downloads pause
- ✅ Resume count shows correct number
- ✅ All downloads resume correctly
- ✅ Parallel downloads continue as expected

**Pass Criteria:**
- No race conditions
- All downloads complete successfully
- State management handles concurrent downloads

---

## ✅ Test 7: Network Loss During Download

**Objective:** Verify graceful handling of network interruptions

**Steps:**
1. Start a large download (e.g., charts or satellite)
2. Wait for ~30% progress
3. Enable Airplane Mode
4. Wait 5 seconds
5. Disable Airplane Mode
6. Check download status

**Expected Results:**
- ✅ Download fails with clear error message
- ✅ Partial file is cleaned up
- ✅ User can retry download
- ✅ Retry starts fresh download

**Pass Criteria:**
- No corrupt files left behind
- Error message is user-friendly
- Retry works correctly

---

## ✅ Test 8: Low Storage During Download

**Objective:** Verify behavior when device runs out of space

**Steps:**
1. Fill device storage to near capacity (leave ~500MB free)
2. Start download of larger pack (>500MB)
3. Monitor as storage fills

**Expected Results:**
- ✅ Download fails with storage error
- ✅ Partial files are cleaned up
- ✅ Error message indicates storage issue
- ✅ App doesn't crash

**Pass Criteria:**
- Graceful error handling
- No corrupt files
- User gets actionable error message

---

## ✅ Test 9: Multiple Resume Attempts

**Objective:** Verify duplicate download prevention

**Steps:**
1. Start download
2. Pause by backgrounding
3. Return to app
4. Tap "Resume All" in dialog
5. Immediately background again
6. Return to app
7. Tap "Resume All" again

**Expected Results:**
- ✅ No duplicate downloads started
- ✅ Second resume recognizes downloads already active
- ✅ Downloads continue smoothly
- ✅ No errors or warnings

**Pass Criteria:**
- Download manager prevents duplicates
- State management is robust

---

## ✅ Test 10: Complete Download Lifecycle

**Objective:** End-to-end test of full download flow

**Steps:**
1. Fresh app install (or clear all data)
2. Select Alaska district
3. Start "Download All" with Medium satellite
4. After 5 minutes, background app
5. Wait 1 minute
6. Return and resume
7. Switch to Weather tab
8. Wait 2 minutes
9. Switch back to Downloads
10. Let downloads complete

**Expected Results:**
- ✅ Screen stays awake during active downloading
- ✅ Pause on background works
- ✅ Resume dialog appears and works
- ✅ Tab switches don't interrupt
- ✅ All items download successfully
- ✅ Keep-awake deactivates when complete
- ✅ "All data installed" banner appears
- ✅ Charts load correctly in map

**Pass Criteria:**
- Complete success with no manual intervention needed after initial resume
- All data functional after download

---

## 🧪 Edge Cases

### Edge Case 1: Resume with Corrupted State
**Scenario:** AsyncStorage has invalid resume data
**Expected:** Falls back to fresh download, clears bad state

### Edge Case 2: Modal Close During Download
**Scenario:** User closes RegionSelector modal while downloading
**Expected:** Downloads continue (managed at app level, not component level)

### Edge Case 3: Multiple Districts
**Scenario:** Start downloads for District A, pause, switch to District B
**Expected:** District B shows clean state, District A shows incomplete banner

### Edge Case 4: Extraction Phase Background
**Scenario:** User backgrounds during extraction (not download)
**Expected:** Extraction continues (doesn't pause), completes when app returns

---

## 📝 Testing Notes

**Device Requirements:**
- Test on both iOS and Android
- Test on physical devices (simulators may not accurately reflect sleep behavior)

**Network Conditions:**
- Test on WiFi (fast downloads)
- Test on cellular (slower, more realistic for interruptions)
- Test with varying network quality

**Storage Conditions:**
- Test with plenty of free space (> 20GB)
- Test with limited space (< 2GB)

**Timing:**
- Test quick backgrounds (< 5 seconds)
- Test extended backgrounds (> 1 minute)
- Test overnight backgrounds

---

## 🐛 Known Limitations

1. **iOS Background Time Limit:**
   - Downloads don't continue in true background on iOS
   - They pause immediately on background
   - This is expected behavior and matches App Store/Play Store

2. **Extraction Cannot Pause:**
   - Unzipping process cannot be paused mid-stream
   - If user backgrounds during extraction, it continues
   - This is acceptable as extraction is typically fast (< 30 seconds)

3. **Network Change:**
   - If network changes during download (WiFi to Cellular), download may fail
   - User must retry after network stabilizes
   - This is standard behavior for mobile apps

---

## ✅ Success Criteria

**All tests pass if:**
- Downloads complete successfully after resume
- No data corruption
- Keep-awake works as expected
- UI accurately reflects download state
- No crashes or errors
- State persists across app restarts
- User experience is smooth and predictable

---

**Testing completed on:** _____________
**Tested by:** _____________
**Device(s):** _____________
**Results:** _____________
