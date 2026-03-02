# Tide & Current Icon Prototype

Interactive HTML prototype for hybrid tide and current dial icons. Open `tide-current-icons.html` in a browser to view.

## Overview

Two circular dial icons display tidal and current cycle data at a glance:

- **Tide Dial** -- shows tide height with a fill-animated up/down arrow inside a clock-position ring
- **Current Dial** -- shows current speed and direction with a fill-animated left/right arrow inside a clock-position ring

## Anatomy of a Dial

```
         Low
      0.3 ft · 12:00 AM
           ●
      ╭────┼────╮        ← Ring (progress arc traces clockwise)
      │    ↑    │        ← Arrow (fill level = magnitude)
      │  3.2 ft │        ← Center readout (live value)
      ╰────┼────╯
           ●
         High
      5.8 ft · 6:12 AM
```

### Ring
- Thin circular track with a colored progress arc that sweeps clockwise as time advances
- A dot travels along the ring showing the current position in the cycle
- White semi-transparent fill inside the ring (opacity adjustable 0-100%)

### Arrow
- Points up/down (tide) or left/right (current) based on direction
- Interior fill grows from base to tip proportional to magnitude (0% at slack/low, 100% at max)
- White halo outline for visibility on any background

### Event Markers
- Positioned around the ring at their actual clock-time positions (e.g., if slack is at 4:39 PM, the marker sits at the 4:39 position on the clock face)
- Each marker shows: event name (e.g., "Max Flood"), value/speed, and time with AM/PM
- The next upcoming event renders at full opacity; past/future events are dimmed to 45%
- Right-side labels are left-aligned, left-side labels are right-aligned

### Center Readout
- **Tide**: current height in feet (e.g., "3.2 ft")
- **Current**: direction and speed (e.g., "Flood 1.4 kt"), or "Slack" when near zero

## Physics Simulation

The demo simulates a 12-hour tidal cycle using sine/cosine:

| Property | Formula | Range |
|----------|---------|-------|
| Tide level | `0.5 - 0.5 * cos(2π * p)` | 0 (low) to 1 (high) |
| Current velocity | `sin(2π * p)` | -1 (max ebb) to +1 (max flood) |
| Current magnitude | `abs(currentVel)` | 0 to 1 |
| Tide fill | Resets each half-cycle (rising: 0→1, falling: 0→1) | 0 to 1 |

Progress `p` goes from 0 to 1 over one full cycle. The values are mapped to realistic ranges for display (e.g., tide 0.3-5.8 ft, current 0-2.1 kt).

## Marker Data (Demo Values)

### Tide
| Event | Value | Time | Clock Position |
|-------|-------|------|----------------|
| Low | 0.3 ft | 12:00 AM | 12 o'clock |
| High | 5.8 ft | 6:12 AM | ~6 o'clock |

### Current
| Event | Value | Time | Clock Position |
|-------|-------|------|----------------|
| Slack | -- | 10:51 AM | ~11 o'clock |
| Max Flood | 2.1 kt | 1:33 PM | ~1:30 |
| Slack | -- | 4:39 PM | ~4:40 |
| Max Ebb | 1.8 kt | 7:45 PM | ~7:45 |

## Key Implementation Details

### SVG Structure
Each dial is a single `<svg>` with viewBox `0 0 300 300`, containing:
1. Background fill circle (white, adjustable opacity)
2. Ring track + progress arc (stroke-dasharray animation)
3. Arrow group (scaled ~1.3x, centered via transform)
4. Clip-path rectangle for fill animation
5. Event marker labels (haloText for visibility)
6. Traveling dot with halo
7. Center readout text

### Text Rendering (haloText)
All text uses a two-layer approach for visibility on any background:
- Bottom layer: white text with black stroke (`stroke-width: 4`, `paint-order: stroke fill`)
- Top layer: white text (clean foreground)

### Clock-Time Positioning (Current Dial)
The current dial maps cycle progress to clock positions:
- `START_CLOCK = 10.85 / 12` (first slack at 10:51)
- Ring position: `(START_CLOCK + progress) % 1`
- Arc rotation offset: `-90 + START_CLOCK * 360` degrees

### Customization Points
| What | Where | Values |
|------|-------|--------|
| Circle interior opacity | Background fill circle `opacity` | 0 (transparent) to 1 (opaque) |
| Page background | CSS `body { background }` | Any color |
| Ring radius | `RING_R` constant | Default: 72 |
| Arrow scale | `sc` constant | Tide: 1.38, Current: 1.32 |
| Label distance from ring | `pad` param in `addRingLabel()` | Tide: 20, Current: 16 |
| Marker event data | `markers` array in each create function | name, val, at, ring |
| Tide color | `#3498db` | Blue |
| Current color | `#e67e22` | Orange |

## Controls (Demo Only)
- **Play/Pause** -- animate through the full cycle
- **Speed** -- 0.5x, 1x, 2x, 4x playback
- **Scrubber** -- drag to any point in the cycle
- **Readout bar** -- shows tide %, current %, direction, and trend
