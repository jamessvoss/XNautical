# 🗺️ Route Planning Quick Start Guide

## How to Create Your First Route

### Step 1: Start a New Route
1. Open the **Maps** tab (bottom navigation)
2. Look at the **top menu bar** (dark bar with icons)
3. Tap the **"+" icon** (orange plus circle) on the right side
4. A new route is created with today's date/time as the name

### Step 2: Add Waypoints
1. **Long-press** on the map where you want your first waypoint
2. You'll see **"P1"** appear in a blue bubble in the route editor at the bottom
3. A numbered marker appears on the map
4. **Long-press** again to add more points (P2, P3, etc.)
5. An orange line connects your points automatically

### Step 3: Customize Your Route

**Edit the Route Name:**
- Tap on the route name at the top of the route editor
- Type your custom name (e.g., "Fishing Trip", "Island Run")
- Tap "Save"

**Set Performance (for ETE & Fuel calculations):**
- **Boat**: Tap to select boat profile (coming soon - shows "Default")
- **RPM**: Tap to set engine RPM (future feature)
- **Speed**: Shows cruising speed in knots (tap to change)

**Edit Individual Points:**
1. Tap any point bubble (P1, P2, etc.)
2. You'll see a menu with options:
   - **Edit Name** - Change from "P1" to something like "Marina", "Reef"
   - **Edit GPS** - Manually adjust latitude/longitude
   - **Delete** - Remove this point from the route

### Step 4: Check Your Route Stats

The stats row shows:
- **Dist** - Total distance in nautical miles
- **ETE** - Estimated Time Enroute (based on speed)
- **ETA** - Estimated Time of Arrival (clock time)
- **Fuel** - Estimated fuel consumption in gallons

### Step 5: Save Your Route
- Tap **"Save"** button at the bottom right
- Your route is saved to the cloud (Firestore)
- You can now load it anytime!

## Tips & Tricks

### Quick Actions
- **Long-press while creating**: Adds next point in sequence
- **Tap point bubble**: Opens edit menu with Lat/Lon shown
- **Tap route name**: Edit the route name
- **Tap Speed box**: Change cruising speed (updates ETE/ETA/Fuel)

### Point Names
- Default: **P1, P2, P3...** (clean, numbered)
- Custom: Tap point → "Edit Name" → Type anything
- Examples: "Marina", "Reef #5", "Fuel Dock", "Fishing Hole"

### What the Colors Mean
- **Blue bubbles** = Regular route points
- **Green bubbles** = Points linked to saved waypoints
- **Orange line** = Your active route on the map

### Viewing Coordinates
- Coordinates are hidden by default (cleaner UI)
- Tap any point bubble to see full Lat/Lon in the menu
- Format: `47.123456°, -122.654321°`

## Managing Saved Routes

### View All Routes
1. Tap the **map icon** 🗺️ in the top menu (next to the + button)
2. Browse all your saved routes
3. Search by name, sort by date/distance

### Load a Route
1. Open Routes Modal (map icon)
2. Tap any route card
3. Select **"Edit Route"** to modify it
4. Or select **"Start Navigation"** to follow it

### Navigate a Route
1. Load a route from Routes Modal
2. Tap **"Start Navigation"**
3. The **ActiveNavigation overlay** appears at top showing:
   - Distance to next waypoint
   - Bearing (with compass icon)
   - Your speed and ETA
   - Cross-track error (XTE)
4. You'll get alerts when approaching each waypoint

## Visual Layout (Foreflight-Inspired)

```
┌─────────────────────────────────────┐
│ Route: Morning Fishing Run     [✏️] │
├─────────────────────────────────────┤
│ [Boat: Default] [RPM: --] [8 kts]  │
├─────────────────────────────────────┤
│ [P1] → [P2] → [P3] → [P4]          │ ← Horizontal scroll
├─────────────────────────────────────┤
│ Dist    ETE      ETA(CDT)    Fuel  │
│ 5.2nm   39m      2:41pm      1.6g  │
├─────────────────────────────────────┤
│  🌐    🏠    ⭐    📤              │
├─────────────────────────────────────┤
│     Edit      │      Save           │
└─────────────────────────────────────┘
```

## Example Route

**"Puget Sound Day Trip"**
- P1: Shilshole Marina
- P2: Alki Point  
- P3: Blake Island
- P4: Eagle Harbor
- P5: Return to Shilshole

Total: 24.3 nm | ETE: 3h 2m | ETA: 4:15 PM | Fuel: 7.6 gal

---

**That's it!** Just tap the + button and start long-pressing the map. Your route planning journey begins! 🚢⚓
