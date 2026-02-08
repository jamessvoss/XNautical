# GNSS Satellite Tracker

Native module for accessing real-time GNSS satellite data in React Native.

## Platform Support

### Android (Full Support)
- ✅ Individual satellite data (PRN, C/N0, constellation)
- ✅ Azimuth and elevation for sky plot
- ✅ Used-in-fix status
- ✅ Almanac/ephemeris status
- **Requirements**: Android 7.0+ (API 24)

### iOS (Limited Support)
- ⚠️ Estimated satellite count only
- ⚠️ No per-satellite data (iOS API limitation)
- Falls back to estimation algorithm

## What is C/N0?

**C/N0 (Carrier-to-Noise density)** is the proper GNSS metric for signal strength, measured in **dB-Hz**.

- **15-25 dB-Hz**: Weak signal (red)
- **25-35 dB-Hz**: Fair signal (amber)
- **35-50 dB-Hz**: Strong signal (green)

Unlike arbitrary "bars" or "SNR", C/N0 is the **industry-standard** measurement used by professional GNSS receivers.

## Implementation

This plugin uses:
- **Android**: `GnssStatus.Callback` API
- **iOS**: `CLLocationManager` (limited data)

## Data Structure

```typescript
interface GnssSatellite {
  svid: number;            // Satellite Vehicle ID (PRN)
  cn0DbHz: number;         // C/N0 signal strength in dB-Hz
  constellation: string;   // "GPS", "GLONASS", "Galileo", "BeiDou", "QZSS", "SBAS"
  azimuth: number;         // 0-360°
  elevation: number;       // 0-90°
  usedInFix: boolean;      // True if used in most recent fix
  hasAlmanac: boolean;
  hasEphemeris: boolean;
}
```

## Usage

```tsx
import { useGnssSatellites } from '../hooks/useGnssSatellites';

function SatelliteView() {
  const { data, startTracking, stopTracking } = useGnssSatellites();
  
  useEffect(() => {
    startTracking();
    return () => stopTracking();
  }, []);
  
  if (data?.satellites) {
    // Android: Real satellite data
    data.satellites.forEach(sat => {
      console.log(`${sat.constellation} ${sat.svid}: ${sat.cn0DbHz} dB-Hz`);
    });
  }
}
```

## Build Steps

1. Add plugin to `app.json`:
```json
"plugins": [
  "./plugins/gnss-satellite-tracker/withGnssSatellite.js"
]
```

2. Rebuild native projects:
```bash
npx expo prebuild --clean
```

3. Run on device (GPS doesn't work in simulator):
```bash
npx expo run:android
# or
npx expo run:ios
```

## Permissions

The plugin automatically adds required permissions:

**Android**: `ACCESS_FINE_LOCATION`  
**iOS**: `NSLocationWhenInUseUsageDescription`

## Future Enhancements

- [ ] Sky plot (polar view with azimuth/elevation)
- [ ] Signal strength history
- [ ] GNSS measurement API (pseudoranges, carrier phase)
- [ ] Antenna info for RTK/PPK
