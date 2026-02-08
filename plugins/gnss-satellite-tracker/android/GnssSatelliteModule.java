package com.xnautical.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/**
 * Native GNSS satellite tracking module for Android.
 * 
 * Exposes real satellite data from Android GnssStatus API:
 * - C/N0 (Carrier-to-Noise density) in dB-Hz
 * - PRN/SVID (Pseudo-Random Noise code / Space Vehicle ID)
 * - Constellation type (GPS, GLONASS, Galileo, BeiDou, QZSS, SBAS)
 * - Azimuth and Elevation for sky plot
 * - Used in fix flag
 * - Almanac and Ephemeris status
 * 
 * Requires Android 7.0 (API 24) or higher.
 * Requires ACCESS_FINE_LOCATION permission.
 */
public class GnssSatelliteModule extends ReactContextBaseJavaModule {
    private static final String TAG = "GnssSatellite";
    private static final String MODULE_NAME = "GnssSatelliteTracker";
    
    private final ReactApplicationContext reactContext;
    private LocationManager locationManager;
    private GnssStatus.Callback gnssCallback;
    private LocationListener locationListener;
    private Handler mainHandler;
    private boolean isTracking = false;
    
    public GnssSatelliteModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
        this.mainHandler = new Handler(Looper.getMainLooper());
    }
    
    @Override
    public String getName() {
        return MODULE_NAME;
    }
    
    /**
     * Start tracking GNSS satellites
     */
    @ReactMethod
    public void startTracking(Promise promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            promise.reject("API_LEVEL", "GnssStatus requires Android 7.0 (API 24) or higher");
            return;
        }
        
        if (isTracking) {
            promise.resolve("Already tracking");
            return;
        }
        
        // Check permissions
        if (!hasLocationPermission()) {
            promise.reject("PERMISSION", "ACCESS_FINE_LOCATION permission not granted");
            return;
        }
        
        try {
            locationManager = (LocationManager) reactContext.getSystemService(Context.LOCATION_SERVICE);
            
            if (locationManager == null) {
                promise.reject("NO_LOCATION_MANAGER", "LocationManager not available");
                return;
            }
            
            // Create GNSS status callback
            gnssCallback = new GnssStatus.Callback() {
                @Override
                public void onSatelliteStatusChanged(GnssStatus status) {
                    emitSatelliteUpdate(status);
                }
                
                @Override
                public void onStarted() {
                    Log.d(TAG, "GNSS tracking started");
                }
                
                @Override
                public void onStopped() {
                    Log.d(TAG, "GNSS tracking stopped");
                }
            };
            
            // Register callback on main thread (required by Android)
            mainHandler.post(() -> {
                try {
                    if (ActivityCompat.checkSelfPermission(reactContext, Manifest.permission.ACCESS_FINE_LOCATION) 
                        != PackageManager.PERMISSION_GRANTED) {
                        return;
                    }
                    locationManager.registerGnssStatusCallback(gnssCallback, mainHandler);
                    
                    // Also request location updates to trigger GNSS (minimal frequency)
                    locationListener = new LocationListener() {
                        @Override
                        public void onLocationChanged(Location location) {
                            // No-op, just to keep GNSS active
                        }
                    };
                    locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, 
                        1000, // 1 second
                        0,    // 0 meters
                        locationListener,
                        mainHandler.getLooper()
                    );
                    
                    Log.d(TAG, "GnssStatus callback registered");
                } catch (Exception e) {
                    Log.e(TAG, "Failed to register GNSS callback", e);
                }
            });
            
            isTracking = true;
            promise.resolve("Tracking started");
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to start tracking", e);
            promise.reject("START_ERROR", e.getMessage(), e);
        }
    }
    
    /**
     * Stop tracking GNSS satellites
     */
    @ReactMethod
    public void stopTracking(Promise promise) {
        if (!isTracking) {
            promise.resolve("Not tracking");
            return;
        }
        
        try {
            mainHandler.post(() -> {
                if (locationManager != null) {
                    if (gnssCallback != null) {
                        locationManager.unregisterGnssStatusCallback(gnssCallback);
                        gnssCallback = null;
                    }
                    if (locationListener != null) {
                        locationManager.removeUpdates(locationListener);
                        locationListener = null;
                    }
                }
                Log.d(TAG, "GNSS tracking stopped");
            });
            
            isTracking = false;
            promise.resolve("Tracking stopped");
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop tracking", e);
            promise.reject("STOP_ERROR", e.getMessage(), e);
        }
    }
    
    /**
     * Check if currently tracking
     */
    @ReactMethod
    public void isTracking(Promise promise) {
        promise.resolve(isTracking);
    }
    
    /**
     * Emit satellite data to React Native
     */
    private void emitSatelliteUpdate(GnssStatus status) {
        try {
            WritableArray satellites = Arguments.createArray();
            int satelliteCount = status.getSatelliteCount();
            
            for (int i = 0; i < satelliteCount; i++) {
                WritableMap sat = Arguments.createMap();
                
                sat.putInt("svid", status.getSvid(i));
                sat.putDouble("cn0DbHz", status.getCn0DbHz(i));
                sat.putInt("constellationType", status.getConstellationType(i));
                sat.putString("constellation", getConstellationName(status.getConstellationType(i)));
                sat.putDouble("azimuth", status.getAzimuthDegrees(i));
                sat.putDouble("elevation", status.getElevationDegrees(i));
                sat.putBoolean("usedInFix", status.usedInFix(i));
                sat.putBoolean("hasAlmanac", status.hasAlmanacData(i));
                sat.putBoolean("hasEphemeris", status.hasEphemerisData(i));
                
                satellites.pushMap(sat);
            }
            
            WritableMap data = Arguments.createMap();
            data.putArray("satellites", satellites);
            data.putDouble("timestamp", System.currentTimeMillis());
            
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit("onSatelliteUpdate", data);
                
        } catch (Exception e) {
            Log.e(TAG, "Failed to emit satellite update", e);
        }
    }
    
    /**
     * Convert constellation type integer to human-readable name
     */
    private String getConstellationName(int type) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            switch (type) {
                case GnssStatus.CONSTELLATION_GPS:
                    return "GPS";
                case GnssStatus.CONSTELLATION_GLONASS:
                    return "GLONASS";
                case GnssStatus.CONSTELLATION_GALILEO:
                    return "Galileo";
                case GnssStatus.CONSTELLATION_BEIDOU:
                    return "BeiDou";
                case GnssStatus.CONSTELLATION_QZSS:
                    return "QZSS";
                case GnssStatus.CONSTELLATION_SBAS:
                    return "SBAS";
                default:
                    return "Unknown";
            }
        }
        return "Unknown";
    }
    
    /**
     * Check if app has location permission
     */
    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(reactContext, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }
}
