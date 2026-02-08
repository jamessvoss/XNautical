import Foundation
import React
import CoreLocation

/**
 * Native GNSS satellite tracking module for iOS.
 * 
 * IMPORTANT LIMITATION: iOS does not expose individual satellite data (PRN, C/N0, azimuth, elevation)
 * through public APIs. CLLocationManager only provides:
 * - Satellite count (iOS 15+): Not directly exposed, must be inferred
 * - Horizontal/vertical accuracy: Already available via expo-location
 * 
 * This module provides minimal satellite information compared to Android:
 * - Estimated satellite count based on accuracy
 * - Location tracking status
 * 
 * For full satellite bar chart and sky plot, Android is required.
 * On iOS, the app will continue using the estimation approach.
 */
@objc(GnssSatelliteTracker)
class GnssSatelliteTracker: RCTEventEmitter, CLLocationManagerDelegate {
    
    private var locationManager: CLLocationManager?
    private var isTracking = false
    
    override init() {
        super.init()
        self.locationManager = CLLocationManager()
        self.locationManager?.delegate = self
    }
    
    /**
     * Start tracking location (iOS has no direct satellite tracking API)
     */
    @objc
    func startTracking(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let locationManager = locationManager else {
            reject("NO_LOCATION_MANAGER", "Location manager not available", nil)
            return
        }
        
        // Check authorization
        let status = locationManager.authorizationStatus
        if status == .denied || status == .restricted {
            reject("PERMISSION", "Location permission not granted", nil)
            return
        }
        
        if status == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        }
        
        if isTracking {
            resolve("Already tracking")
            return
        }
        
        // Start location updates (best accuracy for GPS)
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.startUpdatingLocation()
        
        isTracking = true
        resolve("Tracking started (iOS limited data)")
    }
    
    /**
     * Stop tracking
     */
    @objc
    func stopTracking(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let locationManager = locationManager else {
            reject("NO_LOCATION_MANAGER", "Location manager not available", nil)
            return
        }
        
        if !isTracking {
            resolve("Not tracking")
            return
        }
        
        locationManager.stopUpdatingLocation()
        isTracking = false
        resolve("Tracking stopped")
    }
    
    /**
     * Check if tracking
     */
    @objc
    func isTracking(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(isTracking)
    }
    
    // MARK: - CLLocationManagerDelegate
    
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        
        // Estimate satellite count from accuracy (iOS limitation)
        let estimatedSatCount = estimateSatelliteCount(from: location.horizontalAccuracy)
        
        // Emit minimal satellite data
        let data: [String: Any] = [
            "satellites": [], // Empty array - iOS doesn't expose individual satellites
            "timestamp": Date().timeIntervalSince1970 * 1000,
            "satelliteCount": estimatedSatCount,
            "accuracy": location.horizontalAccuracy,
            "isLimitedData": true // Flag to indicate iOS limitations
        ]
        
        sendEvent(withName: "onSatelliteUpdate", body: data)
    }
    
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[GnssSatellite] Location error: \(error.localizedDescription)")
    }
    
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        print("[GnssSatellite] Authorization status: \(status.rawValue)")
    }
    
    // MARK: - Helper Methods
    
    /**
     * Estimate satellite count from horizontal accuracy
     * (Rough approximation, no official iOS API)
     */
    private func estimateSatelliteCount(from accuracy: Double) -> Int {
        if accuracy < 0 { return 0 }
        if accuracy <= 5 { return 12 }   // Excellent: ~12 satellites
        if accuracy <= 10 { return 10 }  // Good: ~10 satellites
        if accuracy <= 20 { return 8 }   // Fair: ~8 satellites
        if accuracy <= 50 { return 6 }   // Poor: ~6 satellites
        return 4                         // Weak: ~4 satellites
    }
    
    // MARK: - RCTEventEmitter
    
    override func supportedEvents() -> [String]! {
        return ["onSatelliteUpdate"]
    }
    
    override static func requiresMainQueueSetup() -> Bool {
        return true
    }
}
