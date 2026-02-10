package com.xnautical.app;

import android.content.Context;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Base64;
import android.util.Log;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import fi.iki.elonen.NanoHTTPD;

/**
 * Native HTTP tile server that serves MBTiles vector and raster tiles.
 * 
 * This module runs a local HTTP server on the device that:
 * 1. Listens on a configurable port (default 8765)
 * 2. Handles GET requests for /tiles/{chartId}/{z}/{x}/{y}.pbf (vector tiles)
 * 3. Handles GET requests for /tiles/{chartId}/{z}/{x}/{y}.png (raster tiles)
 * 4. Reads tile data directly from MBTiles SQLite databases
 * 5. Returns binary protobuf or PNG responses with proper headers
 */
public class LocalTileServerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "LocalTileServer";
    private static final int DEFAULT_PORT = 8765;
    
    private final ReactApplicationContext reactContext;
    private TileServer server;
    private int port = DEFAULT_PORT;
    private String mbtilesDir;
    
    // Cache of open database connections
    private final ConcurrentHashMap<String, SQLiteDatabase> databases = new ConcurrentHashMap<>();
    
    // Chart index for composite tile serving (legacy)
    private final ConcurrentHashMap<String, ChartInfo> chartIndex = new ConcurrentHashMap<>();
    private boolean chartIndexLoaded = false;
    
    // Regional pack index for tiered loading
    private final ConcurrentHashMap<String, RegionInfo> regionIndex = new ConcurrentHashMap<>();
    private boolean regionIndexLoaded = false;
    private static final String OVERVIEW_REGION = "alaska_overview";
    
    // Zoom thresholds for tiered loading (base values for "low" detail)
    private static final int OVERVIEW_ONLY_MAX_ZOOM = 7;      // z0-7: only overview
    private static final int OVERVIEW_TRANSITION_MAX_ZOOM = 10; // z8-10: overview + regional
    // z11+: only regional packs
    
    // Global detail offset setting (0=low, 2=medium, 4=high)
    // Updated via setDetailLevel() from React Native
    private volatile int currentDetailOffset = 2; // Default to medium
    
    /**
     * Get effective overview-only max zoom based on detail level.
     * Higher detail = lower threshold = regional charts appear earlier.
     * 
     * @param detailOffset 0 (low), 2 (medium), or 4 (high)
     * @return Adjusted max zoom for overview-only tier
     */
    private int getEffectiveOverviewMaxZoom(int detailOffset) {
        return Math.max(0, OVERVIEW_ONLY_MAX_ZOOM - detailOffset);
    }
    
    /**
     * Get effective transition max zoom based on detail level.
     * Higher detail = lower threshold = regional charts appear earlier.
     * 
     * @param detailOffset 0 (low), 2 (medium), or 4 (high)
     * @return Adjusted max zoom for transition tier
     */
    private int getEffectiveTransitionMaxZoom(int detailOffset) {
        return Math.max(0, OVERVIEW_TRANSITION_MAX_ZOOM - detailOffset);
    }
    
    // Track chart changes for logging
    private volatile String lastSelectedChart = null;
    private volatile int lastZoom = -1;
    private volatile long tileRequestCount = 0;
    private volatile long chartSwitchCount = 0;
    
    /**
     * Chart metadata for quilting decisions
     */
    private static class ChartInfo {
        String chartId;
        double west, south, east, north;  // Bounds
        int level;                         // US1=1, US2=2, etc.
        int minZoom, maxZoom;              // Zoom range
        
        ChartInfo(String chartId) {
            this.chartId = chartId;
            this.west = -180;
            this.south = -90;
            this.east = 180;
            this.north = 90;
            this.level = 1;
            this.minZoom = 0;
            this.maxZoom = 22;
        }
        
        boolean containsPoint(double lon, double lat) {
            return lon >= west && lon <= east && lat >= south && lat <= north;
        }
        
        boolean intersectsTileBounds(double tileWest, double tileSouth, double tileEast, double tileNorth) {
            // Check if chart bounds overlap with tile bounds
            return !(east < tileWest || west > tileEast || north < tileSouth || south > tileNorth);
        }
        
        boolean isVisibleAtZoom(int zoom) {
            return zoom >= minZoom && zoom <= maxZoom;
        }
    }
    
    /**
     * Regional pack metadata for tiered loading
     */
    private static class RegionInfo {
        String regionId;
        String filename;
        double west, south, east, north;  // Bounds
        int minZoom, maxZoom;              // Zoom range
        long sizeBytes;
        boolean isOverview;                // Is this the overview pack?
        
        RegionInfo(String regionId) {
            this.regionId = regionId;
            this.filename = regionId + ".mbtiles";
            this.west = -180;
            this.south = -90;
            this.east = 180;
            this.north = 90;
            this.minZoom = 0;
            this.maxZoom = 22;
            this.sizeBytes = 0;
            this.isOverview = false;
        }
        
        boolean intersectsTileBounds(double tileWest, double tileSouth, double tileEast, double tileNorth) {
            // Handle antimeridian crossing (bounds that span 180/-180)
            if (west > east) {
                // Region crosses antimeridian - check both sides
                return (tileEast >= west || tileWest <= east) && 
                       !(north < tileSouth || south > tileNorth);
            }
            // Normal case
            return !(east < tileWest || west > tileEast || north < tileSouth || south > tileNorth);
        }
        
        boolean isVisibleAtZoom(int zoom) {
            return zoom >= minZoom && zoom <= maxZoom;
        }
        
        /**
         * Get the mbtiles filename without path
         */
        String getMbtilesFilename() {
            return filename;
        }
    }
    
    public LocalTileServerModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "LocalTileServer";
    }

    /**
     * Start the tile server
     * @param options Configuration options
     * @param promise Resolves with server URL on success
     */
    @ReactMethod
    public void start(ReadableMap options, Promise promise) {
        try {
            if (server != null && server.isAlive()) {
                promise.resolve("http://127.0.0.1:" + port);
                return;
            }
            
            port = options.hasKey("port") ? options.getInt("port") : DEFAULT_PORT;
            mbtilesDir = options.hasKey("mbtilesDir") ? options.getString("mbtilesDir") : null;
            
            if (mbtilesDir == null) {
                // Default to documents directory
                mbtilesDir = reactContext.getFilesDir().getAbsolutePath() + "/mbtiles";
            } else {
                // Strip file:// prefix if present (expo-file-system adds this)
                if (mbtilesDir.startsWith("file://")) {
                    mbtilesDir = mbtilesDir.substring(7);
                }
            }
            
            // Ensure directory exists
            File dir = new File(mbtilesDir);
            if (!dir.exists()) {
                dir.mkdirs();
            }
            
            // Load chart index for composite tile serving (legacy)
            loadChartIndex();
            
            // Load regional pack index for tiered loading (preferred)
            loadRegionsIndex();
            
            server = new TileServer(port);
            server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
            
            String url = "http://127.0.0.1:" + port;
            Log.i(TAG, "════════════════════════════════════════════════════════════");
            Log.i(TAG, "           TILE SERVER STARTUP                              ");
            Log.i(TAG, "════════════════════════════════════════════════════════════");
            Log.i(TAG, "  URL: " + url);
            Log.i(TAG, "  Port: " + port);
            Log.i(TAG, "  MBTiles dir: " + mbtilesDir);
            
            // Count and categorize MBTiles files
            int us1Count = 0, us2Count = 0, us3Count = 0, us4Count = 0, us5Count = 0, us6Count = 0, otherCount = 0;
            long totalSize = 0;
            
            if (dir.exists() && dir.isDirectory()) {
                String[] files = dir.list();
                if (files != null && files.length > 0) {
                    Log.i(TAG, "────────────────────────────────────────────────────────────");
                    Log.i(TAG, "  MBTILES FILES ON DEVICE:");
                    for (String f : files) {
                        if (f.endsWith(".mbtiles")) {
                            File mbt = new File(dir, f);
                            long sizeKB = mbt.length() / 1024;
                            totalSize += sizeKB;
                            
                            // Categorize by scale
                            if (f.startsWith("US1")) us1Count++;
                            else if (f.startsWith("US2")) us2Count++;
                            else if (f.startsWith("US3")) us3Count++;
                            else if (f.startsWith("US4")) us4Count++;
                            else if (f.startsWith("US5")) us5Count++;
                            else if (f.startsWith("US6")) us6Count++;
                            else otherCount++;
                            
                            Log.i(TAG, "    " + f + " (" + sizeKB + " KB)");
                        }
                    }
                    Log.i(TAG, "────────────────────────────────────────────────────────────");
                    Log.i(TAG, "  SUMMARY:");
                    Log.i(TAG, "    US1 (Overview):  " + us1Count + " charts");
                    Log.i(TAG, "    US2 (General):   " + us2Count + " charts");
                    Log.i(TAG, "    US3 (Coastal):   " + us3Count + " charts");
                    Log.i(TAG, "    US4 (Approach):  " + us4Count + " charts");
                    Log.i(TAG, "    US5 (Harbor):    " + us5Count + " charts");
                    Log.i(TAG, "    US6 (Berthing):  " + us6Count + " charts");
                    if (otherCount > 0) Log.i(TAG, "    Other:           " + otherCount + " files");
                    Log.i(TAG, "    TOTAL:           " + (us1Count + us2Count + us3Count + us4Count + us5Count + us6Count + otherCount) + " files");
                    Log.i(TAG, "    Total size:      " + (totalSize / 1024) + " MB");
                } else {
                    Log.w(TAG, "  ⚠ No MBTiles files found in directory!");
                }
            } else {
                Log.w(TAG, "  ⚠ MBTiles directory does not exist or is not a directory!");
            }
            
            // Log manifest/pack status (preferred mode)
            Log.i(TAG, "────────────────────────────────────────────────────────────");
            Log.i(TAG, "  MANIFEST PACK STATUS (from manifest.json):");
            Log.i(TAG, "    Loaded: " + (regionIndexLoaded ? "YES ✓ (TIERED LOADING ACTIVE)" : "NO ✗"));
            Log.i(TAG, "    Packs found: " + regionIndex.size());
            if (regionIndexLoaded && !regionIndex.isEmpty()) {
                long regionTotalSize = 0;
                boolean hasOverview = false;
                for (RegionInfo info : regionIndex.values()) {
                    regionTotalSize += info.sizeBytes;
                    String type = info.isOverview ? "OVERVIEW ★" : "REGIONAL";
                    if (info.isOverview) hasOverview = true;
                    Log.i(TAG, "      " + info.regionId + " (" + type + "): " + 
                        (info.sizeBytes / 1024 / 1024) + " MB, z" + info.minZoom + "-" + info.maxZoom);
                }
                Log.i(TAG, "    Total pack size: " + (regionTotalSize / 1024 / 1024) + " MB");
                Log.i(TAG, "    Has overview pack: " + (hasOverview ? "YES ✓" : "NO ⚠️"));
                Log.i(TAG, "    Tiered strategy:");
                Log.i(TAG, "      z0-" + OVERVIEW_ONLY_MAX_ZOOM + ": Overview only");
                Log.i(TAG, "      z" + (OVERVIEW_ONLY_MAX_ZOOM + 1) + "-" + OVERVIEW_TRANSITION_MAX_ZOOM + ": Overview + Regional");
                Log.i(TAG, "      z" + (OVERVIEW_TRANSITION_MAX_ZOOM + 1) + "+: Regional only");
                if (!hasOverview) {
                    Log.e(TAG, "    ⚠️ WARNING: No overview pack found! Low zoom (z0-" + OVERVIEW_ONLY_MAX_ZOOM + ") won't work!");
                }
            }
            
            // Log chart index status (legacy mode fallback)
            Log.i(TAG, "────────────────────────────────────────────────────────────");
            Log.i(TAG, "  CHART INDEX STATUS (legacy fallback):");
            Log.i(TAG, "    Loaded: " + (chartIndexLoaded ? "YES ✓" : "NO ✗"));
            Log.i(TAG, "    Charts in index: " + chartIndex.size());
            if (chartIndexLoaded && !chartIndex.isEmpty() && !regionIndexLoaded) {
                // Count by level (only show if legacy mode is active)
                int l1 = 0, l2 = 0, l3 = 0, l4 = 0, l5 = 0, l6 = 0;
                for (ChartInfo info : chartIndex.values()) {
                    switch (info.level) {
                        case 1: l1++; break;
                        case 2: l2++; break;
                        case 3: l3++; break;
                        case 4: l4++; break;
                        case 5: l5++; break;
                        case 6: l6++; break;
                    }
                }
                Log.i(TAG, "    By level: L1=" + l1 + " L2=" + l2 + " L3=" + l3 + " L4=" + l4 + " L5=" + l5 + " L6=" + l6);
            }
            Log.i(TAG, "════════════════════════════════════════════════════════════");
            
            promise.resolve(url);
        } catch (IOException e) {
            Log.e(TAG, "Failed to start tile server", e);
            promise.reject("START_ERROR", "Failed to start tile server: " + e.getMessage());
        }
    }

    /**
     * Stop the tile server
     */
    @ReactMethod
    public void stop(Promise promise) {
        try {
            if (server != null) {
                server.stop();
                server = null;
            }
            
            // Close all database connections
            for (SQLiteDatabase db : databases.values()) {
                try {
                    db.close();
                } catch (Exception e) {
                    Log.w(TAG, "Error closing database", e);
                }
            }
            databases.clear();
            
            Log.i(TAG, "Tile server stopped");
            promise.resolve(null);
        } catch (Exception e) {
            Log.e(TAG, "Error stopping tile server", e);
            promise.reject("STOP_ERROR", e.getMessage());
        }
    }

    /**
     * Check if server is running
     */
    @ReactMethod
    public void isRunning(Promise promise) {
        promise.resolve(server != null && server.isAlive());
    }

    /**
     * Get the server URL
     */
    @ReactMethod
    public void getServerUrl(Promise promise) {
        if (server != null && server.isAlive()) {
            promise.resolve("http://127.0.0.1:" + port);
        } else {
            promise.resolve(null);
        }
    }

    /**
     * Get the vector tile URL template for a chart
     */
    @ReactMethod
    public void getTileUrlTemplate(String chartId, Promise promise) {
        promise.resolve("http://127.0.0.1:" + port + "/tiles/" + chartId + "/{z}/{x}/{y}.pbf");
    }

    /**
     * Get the raster tile URL template for a chart (PNG format)
     */
    @ReactMethod
    public void getRasterTileUrlTemplate(String chartId, Promise promise) {
        promise.resolve("http://127.0.0.1:" + port + "/tiles/" + chartId + "/{z}/{x}/{y}.png");
    }

    /**
     * Clear cached database connections
     * This forces the server to re-open databases on next request,
     * picking up any changes to MBTiles files.
     */
    @ReactMethod
    public void clearCache(Promise promise) {
        try {
            int closedCount = 0;
            for (Map.Entry<String, SQLiteDatabase> entry : databases.entrySet()) {
                try {
                    SQLiteDatabase db = entry.getValue();
                    if (db != null && db.isOpen()) {
                        db.close();
                        closedCount++;
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Error closing database: " + entry.getKey(), e);
                }
            }
            databases.clear();
            
            Log.i(TAG, "Cache cleared - closed " + closedCount + " database connections");
            promise.resolve(closedCount);
        } catch (Exception e) {
            Log.e(TAG, "Error clearing cache", e);
            promise.reject("CLEAR_CACHE_ERROR", e.getMessage());
        }
    }

    /**
     * Get the composite tile URL template (no chartId - server does quilting)
     */
    @ReactMethod
    public void getCompositeTileUrl(Promise promise) {
        promise.resolve("http://127.0.0.1:" + port + "/tiles/{z}/{x}/{y}.pbf");
    }
    
    /**
     * Set the detail level for tile serving
     * @param detailOffset 0 (low), 2 (medium), or 4 (high)
     */
    @ReactMethod
    public void setDetailLevel(int detailOffset, Promise promise) {
        int oldOffset = currentDetailOffset;
        currentDetailOffset = Math.max(0, Math.min(4, detailOffset));
        int threshold = 16 - currentDetailOffset;
        Log.i(TAG, "[DETAIL] Level changed: " + oldOffset + " → " + currentDetailOffset + 
            " (US5+US6 threshold now z" + threshold + "+)");
        promise.resolve(true);
    }

    /**
     * Load the chart index from chart_index.json
     */
    private void loadChartIndex() {
        Log.i(TAG, "[INDEX] Loading chart index...");
        chartIndex.clear();
        chartIndexLoaded = false;
        
        String indexPath = mbtilesDir + "/chart_index.json";
        File indexFile = new File(indexPath);
        
        if (!indexFile.exists()) {
            Log.w(TAG, "[INDEX] ⚠ Chart index NOT FOUND: " + indexPath);
            Log.w(TAG, "[INDEX] Composite tile mode will NOT work without chart_index.json!");
            return;
        }
        
        Log.i(TAG, "[INDEX] Found chart_index.json (" + (indexFile.length() / 1024) + " KB)");
        
        try {
            // Read file
            StringBuilder content = new StringBuilder();
            BufferedReader reader = new BufferedReader(new FileReader(indexFile));
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line);
            }
            reader.close();
            
            // Parse JSON
            JSONObject root = new JSONObject(content.toString());
            JSONObject charts = root.optJSONObject("charts");
            
            if (charts == null) {
                Log.w(TAG, "[INDEX] ⚠ No 'charts' object in index file!");
                return;
            }
            
            int totalInIndex = 0;
            int loadedCount = 0;
            int missingCount = 0;
            
            // Iterate through charts
            java.util.Iterator<String> keys = charts.keys();
            while (keys.hasNext()) {
                totalInIndex++;
                String chartId = keys.next();
                JSONObject chartJson = charts.optJSONObject(chartId);
                if (chartJson == null) continue;
                
                ChartInfo info = new ChartInfo(chartId);
                
                // Parse bounds [west, south, east, north]
                JSONArray bounds = chartJson.optJSONArray("bounds");
                if (bounds != null && bounds.length() == 4) {
                    info.west = bounds.getDouble(0);
                    info.south = bounds.getDouble(1);
                    info.east = bounds.getDouble(2);
                    info.north = bounds.getDouble(3);
                }
                
                // Parse level
                info.level = chartJson.optInt("level", 1);
                
                // Parse zoom range
                info.minZoom = chartJson.optInt("minZoom", 0);
                info.maxZoom = chartJson.optInt("maxZoom", 22);
                
                // Verify mbtiles file exists
                File mbtFile = new File(mbtilesDir + "/" + chartId + ".mbtiles");
                if (mbtFile.exists()) {
                    chartIndex.put(chartId, info);
                    loadedCount++;
                    Log.d(TAG, "[INDEX] ✓ " + chartId + " L" + info.level + 
                        " z" + info.minZoom + "-" + info.maxZoom +
                        " bounds=[" + String.format("%.2f,%.2f,%.2f,%.2f", info.west, info.south, info.east, info.north) + "]");
                } else {
                    missingCount++;
                    Log.w(TAG, "[INDEX] ✗ " + chartId + " - mbtiles file NOT FOUND");
                }
            }
            
            chartIndexLoaded = true;
            Log.i(TAG, "[INDEX] ════════════════════════════════════════════════════");
            Log.i(TAG, "[INDEX] Chart index loaded successfully!");
            Log.i(TAG, "[INDEX]   Total in index: " + totalInIndex);
            Log.i(TAG, "[INDEX]   Loaded (have mbtiles): " + loadedCount);
            Log.i(TAG, "[INDEX]   Missing (no mbtiles): " + missingCount);
            Log.i(TAG, "[INDEX] ════════════════════════════════════════════════════");
            
        } catch (Exception e) {
            Log.e(TAG, "[INDEX] ✗ FAILED to load chart index!", e);
        }
    }

    /**
     * Load the regional pack index from manifest.json
     * This enables tiered loading where overview packs serve low zoom
     * and regional packs serve high zoom based on viewport.
     */
    private void loadRegionsIndex() {
        Log.i(TAG, "[MANIFEST] Loading regional pack index from manifest.json...");
        regionIndex.clear();
        regionIndexLoaded = false;
        
        String indexPath = mbtilesDir + "/manifest.json";
        File indexFile = new File(indexPath);
        
        if (!indexFile.exists()) {
            Log.w(TAG, "[MANIFEST] ⚠ manifest.json NOT FOUND: " + indexPath);
            Log.w(TAG, "[MANIFEST] Falling back to chart_index.json mode");
            return;
        }
        
        Log.i(TAG, "[MANIFEST] Found manifest.json (" + (indexFile.length() / 1024) + " KB)");
        
        try {
            // Read file
            StringBuilder content = new StringBuilder();
            BufferedReader reader = new BufferedReader(new FileReader(indexFile));
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line);
            }
            reader.close();
            
            // Parse JSON - manifest.json has "packs" array, not "regions" object
            JSONObject root = new JSONObject(content.toString());
            JSONArray packs = root.optJSONArray("packs");
            
            if (packs == null) {
                Log.w(TAG, "[MANIFEST] ⚠ No 'packs' array in manifest.json!");
                return;
            }
            
            int totalInIndex = 0;
            int loadedCount = 0;
            int missingCount = 0;
            
            // Iterate through packs array
            for (int i = 0; i < packs.length(); i++) {
                JSONObject packJson = packs.optJSONObject(i);
                if (packJson == null) continue;
                
                totalInIndex++;
                String packId = packJson.optString("id", "");
                if (packId.isEmpty()) continue;
                
                RegionInfo info = new RegionInfo(packId);
                
                // Filename is id + .mbtiles
                info.filename = packId + ".mbtiles";
                
                // Parse bounds object {south, west, north, east}
                JSONObject bounds = packJson.optJSONObject("bounds");
                if (bounds != null) {
                    info.west = bounds.optDouble("west", -180);
                    info.south = bounds.optDouble("south", -90);
                    info.east = bounds.optDouble("east", 180);
                    info.north = bounds.optDouble("north", 90);
                }
                
                // Parse zoom range
                info.minZoom = packJson.optInt("minZoom", 0);
                info.maxZoom = packJson.optInt("maxZoom", 22);
                
                // Parse size
                info.sizeBytes = packJson.optLong("fileSize", 0);
                
                // Determine if this is the overview pack
                info.isOverview = packId.contains("overview") || packId.equals(OVERVIEW_REGION);
                
                // Verify mbtiles file exists
                File mbtFile = new File(mbtilesDir + "/" + info.filename);
                if (mbtFile.exists()) {
                    regionIndex.put(packId, info);
                    loadedCount++;
                    // Use INFO level for overview pack so it's always visible
                    if (info.isOverview) {
                        Log.i(TAG, "[MANIFEST] ★★★ OVERVIEW PACK FOUND ★★★");
                        Log.i(TAG, "[MANIFEST] ✓ " + packId + " (OVERVIEW)" +
                            " z" + info.minZoom + "-" + info.maxZoom +
                            " bounds=[" + String.format("%.2f,%.2f,%.2f,%.2f", info.west, info.south, info.east, info.north) + "]" +
                            " (" + (info.sizeBytes / 1024 / 1024) + " MB)");
                        Log.i(TAG, "[MANIFEST] This pack will serve z0-" + OVERVIEW_ONLY_MAX_ZOOM + " tiles");
                    } else {
                        Log.i(TAG, "[MANIFEST] ✓ " + packId +
                            " z" + info.minZoom + "-" + info.maxZoom +
                            " bounds=[" + String.format("%.2f,%.2f,%.2f,%.2f", info.west, info.south, info.east, info.north) + "]" +
                            " (" + (info.sizeBytes / 1024 / 1024) + " MB)");
                    }
                } else {
                    missingCount++;
                    if (info.isOverview) {
                        Log.e(TAG, "[MANIFEST] ⚠️⚠️⚠️ CRITICAL: OVERVIEW PACK MISSING! ⚠️⚠️⚠️");
                        Log.e(TAG, "[MANIFEST] ✗ " + packId + " - mbtiles file NOT FOUND: " + info.filename);
                        Log.e(TAG, "[MANIFEST] Low zoom tiles (z0-" + OVERVIEW_ONLY_MAX_ZOOM + ") will NOT work!");
                        Log.e(TAG, "[MANIFEST] Expected file: " + mbtilesDir + "/" + info.filename);
                    } else {
                        Log.w(TAG, "[MANIFEST] ✗ " + packId + " - mbtiles file NOT FOUND: " + info.filename);
                    }
                }
            }
            
            regionIndexLoaded = true;
            Log.i(TAG, "[MANIFEST] ════════════════════════════════════════════════════");
            Log.i(TAG, "[MANIFEST] Pack manifest loaded successfully!");
            Log.i(TAG, "[MANIFEST]   Total packs in manifest: " + totalInIndex);
            Log.i(TAG, "[MANIFEST]   Loaded (have mbtiles): " + loadedCount);
            Log.i(TAG, "[MANIFEST]   Missing (no mbtiles): " + missingCount);
            Log.i(TAG, "[MANIFEST]   Tiered loading: z0-" + OVERVIEW_ONLY_MAX_ZOOM + " overview only, " +
                "z" + (OVERVIEW_ONLY_MAX_ZOOM + 1) + "-" + OVERVIEW_TRANSITION_MAX_ZOOM + " mixed, " +
                "z" + (OVERVIEW_TRANSITION_MAX_ZOOM + 1) + "+ regional only");
            Log.i(TAG, "[MANIFEST] ════════════════════════════════════════════════════");
            
        } catch (Exception e) {
            Log.e(TAG, "[MANIFEST] ✗ FAILED to load manifest!", e);
        }
    }

    /**
     * Convert tile coordinates to geographic bounds
     */
    private double[] tileToBounds(int z, int x, int y) {
        double n = Math.pow(2, z);
        double west = x / n * 360.0 - 180.0;
        double east = (x + 1) / n * 360.0 - 180.0;
        double north = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2.0 * y / n))));
        double south = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - 2.0 * (y + 1) / n))));
        return new double[]{west, south, east, north};
    }

    /**
     * Find all regional packs or charts that cover a tile, sorted by preference.
     * Returns a list of mbtiles filenames (without .mbtiles extension) to try.
     * 
     * TIERED LOADING STRATEGY (when regions.json is loaded):
     * - z0-7:   Only query overview pack (fast, covers all of Alaska)
     * - z8-10:  Query overview + regional packs that intersect tile (transition zone)
     * - z11+:   Only query regional packs that intersect tile (detailed)
     * 
     * LEGACY MODE (when only chart_index.json is loaded):
     * - Query all charts sorted by level descending
     */
    private List<String> findChartsForTile(int z, int x, int y, int detailOffset) {
        // DEBUG: Log index status on every request for low zoom to help diagnose issues
        int effectiveOverviewMax = getEffectiveOverviewMaxZoom(detailOffset);
        if (z <= effectiveOverviewMax + 1) {
            Log.i(TAG, "[TILE-DEBUG] z" + z + "/" + x + "/" + y + 
                " detailOffset=" + detailOffset +
                " effectiveOverviewMax=" + effectiveOverviewMax +
                " regionIndexLoaded=" + regionIndexLoaded + 
                " regionCount=" + regionIndex.size() +
                " chartIndexLoaded=" + chartIndexLoaded +
                " chartCount=" + chartIndex.size());
        }
        
        // Use regional tiered loading if available
        if (regionIndexLoaded && !regionIndex.isEmpty()) {
            return findRegionsForTile(z, x, y, detailOffset);
        }
        
        // Fall back to legacy chart index (does not support detail offset)
        if (!chartIndexLoaded || chartIndex.isEmpty()) {
            Log.w(TAG, "[QUILT] ⚠️ NO INDEX LOADED! Neither manifest.json nor chart_index.json found!");
            Log.w(TAG, "[QUILT] ⚠️ MBTiles directory: " + mbtilesDir);
            Log.w(TAG, "[QUILT] ⚠️ Check that manifest.json exists in the mbtiles directory on device");
            return Collections.emptyList();
        }
        
        return findChartsForTileLegacy(z, x, y);
    }
    
    /**
     * Find regional packs for a tile.
     * 
     * Supports two architectures:
     * 1. Per-scale packs (alaska_US1, alaska_US2, etc.) - NEW preferred architecture
     *    Each scale has its own pack, server selects ONE scale per zoom level.
     * 
     * 2. Legacy tiered packs (alaska_overview, alaska_coastal, alaska_detail)
     *    Falls back to this if per-scale packs not found.
     * 
     * @param z Zoom level
     * @param x Tile X coordinate
     * @param y Tile Y coordinate
     * @param detailOffset Detail level offset (0=low, 2=medium, 4=high)
     */
    private List<String> findRegionsForTile(int z, int x, int y, int detailOffset) {
        double[] bounds = tileToBounds(z, x, y);
        double west = bounds[0], south = bounds[1], east = bounds[2], north = bounds[3];
        
        List<String> packIds = new ArrayList<>();
        
        // Check if we have per-scale packs (new architecture)
        boolean hasPerScalePacks = regionIndex.containsKey("alaska_US1") || 
                                   regionIndex.containsKey("alaska_US2") ||
                                   regionIndex.containsKey("alaska_US3");
        
        if (hasPerScalePacks) {
            // NEW ARCHITECTURE: Per-scale packs
            // At z14+, combine US5 and US6 for maximum detail
            // US5 (harbor) provides broader coverage, US6 (berthing) adds fine detail
            if (z >= 14) {
                // Try to add both US5 and US6 (additive)
                // Note: We skip isVisibleAtZoom() here because we're explicitly overriding
                // the pack's minZoom metadata - we WANT to show these at lower zooms
                RegionInfo us5Pack = regionIndex.get("alaska_US5");
                RegionInfo us6Pack = regionIndex.get("alaska_US6");
                
                // Add US5 first (broader coverage, drawn first/below)
                // Only check bounds intersection, not zoom visibility
                if (us5Pack != null && us5Pack.intersectsTileBounds(west, south, east, north)) {
                    packIds.add("alaska_US5");
                }
                
                // Add US6 on top (finer detail)
                if (us6Pack != null && us6Pack.intersectsTileBounds(west, south, east, north)) {
                    packIds.add("alaska_US6");
                }
                
                if (!packIds.isEmpty()) {
                    Log.d(TAG, "[SCALE] z" + z + " → COMBINED US5+US6: " + packIds);
                    return packIds;
                }
                
                // Fallback to US4 if neither US5 nor US6 cover this tile location
                RegionInfo us4Pack = regionIndex.get("alaska_US4");
                if (us4Pack != null && us4Pack.intersectsTileBounds(west, south, east, north)) {
                    packIds.add("alaska_US4");
                    Log.d(TAG, "[SCALE] z" + z + " → fallback to US4 (no US5/US6 coverage)");
                    return packIds;
                }
            }
            
            // Standard single-scale selection for lower zoom levels
            String targetScale = getScaleForZoom(z, detailOffset);
            String targetPackId = "alaska_" + targetScale;
            
            // Check if target pack exists and covers this tile
            RegionInfo targetPack = regionIndex.get(targetPackId);
            if (targetPack != null && targetPack.isVisibleAtZoom(z) && 
                targetPack.intersectsTileBounds(west, south, east, north)) {
                packIds.add(targetPackId);
                Log.d(TAG, "[SCALE] z" + z + " (detail=" + detailOffset + ") → " + targetScale + " (" + targetPackId + ")");
            } else {
                // Fallback: try adjacent scales
                String[] fallbackScales = getFallbackScales(targetScale);
                for (String scale : fallbackScales) {
                    String packId = "alaska_" + scale;
                    RegionInfo pack = regionIndex.get(packId);
                    if (pack != null && pack.isVisibleAtZoom(z) && 
                        pack.intersectsTileBounds(west, south, east, north)) {
                        packIds.add(packId);
                        Log.d(TAG, "[SCALE] z" + z + " → fallback to " + scale);
                        break;
                    }
                }
            }
            
            return packIds;
        }
        
        // LEGACY ARCHITECTURE: Tiered packs (alaska_overview, alaska_coastal, alaska_detail)
        // Fall back to original behavior
        return findRegionsForTileLegacy(z, x, y, detailOffset, bounds);
    }
    
    /**
     * Determine which chart scale to display at a given zoom level.
     * 
     * Fixed zoom to scale mapping (NOT affected by detail setting):
     *   z0-7:   US1 (overview)
     *   z8-9:   US2 (general)
     *   z10-11: US3 (coastal)
     *   z12+:   US4 (approach) - unless in US5+US6 combine range
     * 
     * The detail setting (L/M/H) ONLY affects when US5+US6 combine:
     *   Low    (detailOffset=0): US5+US6 combined at z16+
     *   Medium (detailOffset=2): US5+US6 combined at z14+
     *   High   (detailOffset=4): US5+US6 combined at z12+
     * 
     * This method is only called when NOT in the combine range,
     * so it returns US4 for any z12+ that reaches here.
     */
    private String getScaleForZoom(int z, int detailOffset) {
        // US1-US3 at fixed thresholds (detail setting does NOT affect these)
        if (z <= 7)  return "US1";
        if (z <= 9)  return "US2";
        if (z <= 11) return "US3";
        // z12+ returns US4 (US5+US6 handled by combine logic before this is called)
        return "US4";
    }
    
    /**
     * Get fallback scales to try if primary scale has no data
     */
    private String[] getFallbackScales(String primary) {
        switch (primary) {
            case "US1": return new String[]{"US2"};
            case "US2": return new String[]{"US1", "US3"};
            case "US3": return new String[]{"US2", "US4"};
            case "US4": return new String[]{"US3", "US5"};
            case "US5": return new String[]{"US4", "US6"};
            case "US6": return new String[]{"US5"};
            default: return new String[]{};
        }
    }
    
    /**
     * Legacy tiered loading for old-style packs (alaska_overview, alaska_coastal, alaska_detail)
     */
    private List<String> findRegionsForTileLegacy(int z, int x, int y, int detailOffset, double[] bounds) {
        double west = bounds[0], south = bounds[1], east = bounds[2], north = bounds[3];
        List<String> packIds = new ArrayList<>();
        
        int effectiveOverviewMax = getEffectiveOverviewMaxZoom(detailOffset);
        int effectiveTransitionMax = getEffectiveTransitionMaxZoom(detailOffset);
        
        if (z <= effectiveOverviewMax) {
            // LOW ZOOM: Only use overview pack
            for (RegionInfo region : regionIndex.values()) {
                if (region.isOverview && region.isVisibleAtZoom(z)) {
                    packIds.add(region.regionId);
                    Log.d(TAG, "[TIERED-LEGACY] z" + z + " → overview: " + region.regionId);
                    return packIds;
                }
            }
            return packIds;
            
        } else if (z <= effectiveTransitionMax) {
            // TRANSITION: Regional packs first, overview fallback
            List<RegionInfo> regionalCandidates = new ArrayList<>();
            RegionInfo overviewPack = null;
            
            for (RegionInfo region : regionIndex.values()) {
                if (!region.isVisibleAtZoom(z)) continue;
                if (region.isOverview) {
                    overviewPack = region;
                } else if (region.intersectsTileBounds(west, south, east, north)) {
                    regionalCandidates.add(region);
                }
            }
            
            // Sort by detail level
            Collections.sort(regionalCandidates, new Comparator<RegionInfo>() {
                @Override
                public int compare(RegionInfo a, RegionInfo b) {
                    int priorityA = a.regionId.contains("detail") ? 0 : (a.regionId.contains("coastal") ? 1 : 2);
                    int priorityB = b.regionId.contains("detail") ? 0 : (b.regionId.contains("coastal") ? 1 : 2);
                    return Integer.compare(priorityA, priorityB);
                }
            });
            
            for (RegionInfo r : regionalCandidates) {
                packIds.add(r.regionId);
            }
            if (overviewPack != null) {
                packIds.add(overviewPack.regionId);
            }
            
            Log.d(TAG, "[TIERED-LEGACY] z" + z + " → transition: " + packIds);
            return packIds;
            
        } else {
            // HIGH ZOOM: Regional packs only
            List<RegionInfo> candidates = new ArrayList<>();
            
            for (RegionInfo region : regionIndex.values()) {
                if (region.isOverview) continue;
                if (!region.isVisibleAtZoom(z)) continue;
                if (!region.intersectsTileBounds(west, south, east, north)) continue;
                candidates.add(region);
            }
            
            Collections.sort(candidates, new Comparator<RegionInfo>() {
                @Override
                public int compare(RegionInfo a, RegionInfo b) {
                    int priorityA = a.regionId.contains("detail") ? 0 : (a.regionId.contains("coastal") ? 1 : 2);
                    int priorityB = b.regionId.contains("detail") ? 0 : (b.regionId.contains("coastal") ? 1 : 2);
                    return Integer.compare(priorityA, priorityB);
                }
            });
            
            for (RegionInfo r : candidates) {
                packIds.add(r.regionId);
            }
            
            Log.d(TAG, "[TIERED-LEGACY] z" + z + " → regional: " + packIds);
            return packIds;
        }
    }
    
    /**
     * Legacy method: Find charts using chart_index.json (individual chart files)
     */
    private List<String> findChartsForTileLegacy(int z, int x, int y) {
        double[] bounds = tileToBounds(z, x, y);
        double west = bounds[0], south = bounds[1], east = bounds[2], north = bounds[3];
        double centerLon = (west + east) / 2;
        double centerLat = (south + north) / 2;
        
        // Find all charts that INTERSECT the tile bounds and are visible at this zoom
        List<ChartInfo> candidates = new ArrayList<>();
        for (ChartInfo chart : chartIndex.values()) {
            if (chart.intersectsTileBounds(west, south, east, north) && chart.isVisibleAtZoom(z)) {
                candidates.add(chart);
            }
        }
        
        if (candidates.isEmpty()) {
            Log.d(TAG, "[QUILT] No charts cover tile " + z + "/" + x + "/" + y + " at lon=" + 
                String.format("%.3f", centerLon) + ", lat=" + String.format("%.3f", centerLat));
            return Collections.emptyList();
        }
        
        // Sort by level descending (most detailed first), then by chartId alphabetically
        Collections.sort(candidates, new Comparator<ChartInfo>() {
            @Override
            public int compare(ChartInfo a, ChartInfo b) {
                int levelDiff = b.level - a.level;
                if (levelDiff != 0) return levelDiff;
                return a.chartId.compareTo(b.chartId);
            }
        });
        
        // Convert to list of chart IDs
        List<String> chartIds = new ArrayList<>();
        for (ChartInfo c : candidates) {
            chartIds.add(c.chartId);
        }
        
        // Log candidates for debugging
        StringBuilder candidateList = new StringBuilder();
        for (int i = 0; i < Math.min(candidates.size(), 5); i++) {
            ChartInfo c = candidates.get(i);
            if (i > 0) candidateList.append(", ");
            candidateList.append(c.chartId).append("(L").append(c.level).append(")");
        }
        if (candidates.size() > 5) candidateList.append("...");
        
        Log.d(TAG, "[QUILT] z" + z + " tile " + x + "/" + y + " → " + candidates.size() + 
            " candidates: " + candidateList);
        
        return chartIds;
    }
    
    /**
     * Find the best chart for a tile using quilting logic
     * Returns the most detailed chart that covers the tile and is visible at this zoom
     * 
     * @deprecated Use findChartsForTile() and try each chart until one has data
     */
    private String findBestChartForTile(int z, int x, int y) {
        List<String> charts = findChartsForTile(z, x, y, 0); // Default to low detail
        return charts.isEmpty() ? null : charts.get(0);
    }

    /**
     * Get the satellite MBTiles filename(s) for a given zoom level.
     * Returns a list of possible filenames to try (district-prefixed first, then legacy).
     * Supports multi-region: alaska_satellite_z8, d07_satellite_z8, satellite_z8.
     */
    private List<String> getSatelliteFilesForZoom(int z) {
        String zoomSuffix;
        if (z <= 5) {
            zoomSuffix = "z0-5";
        } else if (z <= 7) {
            zoomSuffix = "z6-7";
        } else if (z == 8) {
            zoomSuffix = "z8";
        } else {
            zoomSuffix = "z" + z;
        }
        
        List<String> candidates = new ArrayList<>();
        
        // Scan mbtiles directory for all district-prefixed satellite files matching this zoom
        if (mbtilesDir != null) {
            File dir = new File(mbtilesDir);
            if (dir.exists()) {
                String[] files = dir.list();
                if (files != null) {
                    String suffix = "_satellite_" + zoomSuffix + ".mbtiles";
                    for (String file : files) {
                        if (file.endsWith(suffix)) {
                            candidates.add(file.replace(".mbtiles", ""));
                        }
                    }
                }
            }
        }
        
        // Fallback: try legacy unprefixed name
        candidates.add("satellite_" + zoomSuffix);
        
        return candidates;
    }

    /**
     * Open a database connection for a chart or regional pack
     */
    private SQLiteDatabase openDatabase(String packId) {
        if (databases.containsKey(packId)) {
            SQLiteDatabase db = databases.get(packId);
            if (db != null && db.isOpen()) {
                Log.d(TAG, "Using cached DB connection for: " + packId);
                return db;
            }
        }
        
        // Determine the filename - check regional index first, then default to packId.mbtiles
        String filename;
        if (regionIndex.containsKey(packId)) {
            filename = regionIndex.get(packId).getMbtilesFilename();
        } else {
            filename = packId + ".mbtiles";
        }
        
        String dbPath = mbtilesDir + "/" + filename;
        File dbFile = new File(dbPath);
        
        Log.d(TAG, "Opening database: " + dbPath);
        Log.d(TAG, "  File exists: " + dbFile.exists());
        if (dbFile.exists()) {
            Log.d(TAG, "  File size: " + dbFile.length() + " bytes");
            Log.d(TAG, "  Can read: " + dbFile.canRead());
        }
        
        if (!dbFile.exists()) {
            Log.w(TAG, "MBTiles file not found: " + dbPath);
            // List files in directory for debugging
            File dir = new File(mbtilesDir);
            if (dir.exists() && dir.isDirectory()) {
                String[] files = dir.list();
                Log.d(TAG, "Files in " + mbtilesDir + ":");
                if (files != null) {
                    for (String f : files) {
                        Log.d(TAG, "  - " + f);
                    }
                }
            }
            return null;
        }
        
        try {
            SQLiteDatabase db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);
            databases.put(packId, db);
            Log.i(TAG, "✓ Opened database: " + packId + " (" + dbFile.length() / 1024 + " KB)");
            
            // Log some metadata
            try {
                Cursor metaCursor = db.rawQuery("SELECT name, value FROM metadata LIMIT 10", null);
                Log.d(TAG, "  Metadata:");
                while (metaCursor.moveToNext()) {
                    String name = metaCursor.getString(0);
                    String value = metaCursor.getString(1);
                    if (value != null && value.length() > 100) value = value.substring(0, 100) + "...";
                    Log.d(TAG, "    " + name + ": " + value);
                }
                metaCursor.close();
                
                // Count tiles - SKIP for large files (>500MB) to avoid 30+ second hang
                if (dbFile.length() < 500 * 1024 * 1024) {
                    Cursor countCursor = db.rawQuery("SELECT COUNT(*), MIN(zoom_level), MAX(zoom_level) FROM tiles", null);
                    if (countCursor.moveToFirst()) {
                        int count = countCursor.getInt(0);
                        int minZ = countCursor.getInt(1);
                        int maxZ = countCursor.getInt(2);
                        Log.i(TAG, "  Tiles: " + count + " (zoom " + minZ + "-" + maxZ + ")");
                    }
                    countCursor.close();
                } else {
                    Log.i(TAG, "  Tiles: (skipped count for large file - " + dbFile.length() / 1024 / 1024 + "MB)");
                }
            } catch (Exception e) {
                Log.w(TAG, "Could not read metadata: " + e.getMessage());
            }
            
            return db;
        } catch (Exception e) {
            Log.e(TAG, "Failed to open database: " + dbPath, e);
            return null;
        }
    }

    /**
     * Get a tile from the MBTiles database
     */
    private byte[] getTile(String chartId, int z, int x, int y) {
        SQLiteDatabase db = openDatabase(chartId);
        if (db == null) {
            return null;
        }
        
        // MBTiles uses TMS y-coordinate (flipped)
        int tmsY = (1 << z) - 1 - y;
        
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(
                "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                new String[]{String.valueOf(z), String.valueOf(x), String.valueOf(tmsY)}
            );
            
            if (cursor.moveToFirst()) {
                byte[] data = cursor.getBlob(0);
                Log.d(TAG, "Found tile " + chartId + "/" + z + "/" + x + "/" + y + " (" + (data != null ? data.length : 0) + " bytes)");
                return data;
            }
            
            Log.d(TAG, "Tile not found: " + chartId + "/" + z + "/" + x + "/" + y);
            return null;
        } catch (Exception e) {
            Log.e(TAG, "Error getting tile", e);
            return null;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
    }

    /**
     * Build TileJSON metadata for the composite tile source.
     * Mapbox needs this to know about the tile source configuration.
     */
    private String buildCompositeTileJson() {
        // Calculate bounds from manifest packs (regionIndex)
        double minLon = -180, minLat = -90, maxLon = 180, maxLat = 90;
        int minZoom = 0, maxZoom = 18;
        
        if (!regionIndex.isEmpty()) {
            minLon = 180; minLat = 90; maxLon = -180; maxLat = -90;
            for (RegionInfo region : regionIndex.values()) {
                minLon = Math.min(minLon, region.west);
                minLat = Math.min(minLat, region.south);
                maxLon = Math.max(maxLon, region.east);
                maxLat = Math.max(maxLat, region.north);
                minZoom = Math.min(minZoom, region.minZoom);
                maxZoom = Math.max(maxZoom, region.maxZoom);
            }
        }
        
        String tileUrl = "http://127.0.0.1:" + port + "/tiles/{z}/{x}/{y}.pbf";
        
        // TileJSON spec: https://github.com/mapbox/tilejson-spec
        StringBuilder json = new StringBuilder();
        json.append("{");
        json.append("\"tilejson\":\"3.0.0\",");
        json.append("\"name\":\"composite-charts\",");
        json.append("\"description\":\"Server-side quilted nautical charts\",");
        json.append("\"version\":\"1.0.0\",");
        json.append("\"scheme\":\"xyz\",");  // We convert TMS to XYZ in the server
        json.append("\"attribution\":\"NOAA\",");
        json.append("\"tiles\":[\"").append(tileUrl).append("\"],");
        json.append("\"minzoom\":").append(minZoom).append(",");
        json.append("\"maxzoom\":").append(maxZoom).append(",");
        json.append("\"bounds\":[").append(minLon).append(",").append(minLat).append(",").append(maxLon).append(",").append(maxLat).append("],");
        json.append("\"center\":[").append((minLon + maxLon) / 2).append(",").append((minLat + maxLat) / 2).append(",4],");
        // Vector layers - all features are in the "charts" layer
        json.append("\"vector_layers\":[{");
        json.append("\"id\":\"charts\",");
        json.append("\"description\":\"Nautical chart features\",");
        json.append("\"minzoom\":").append(minZoom).append(",");
        json.append("\"maxzoom\":").append(maxZoom).append(",");
        json.append("\"fields\":{\"_layer\":\"string\",\"DEPTH\":\"number\",\"DRVAL1\":\"number\",\"DRVAL2\":\"number\"}");
        json.append("}]");
        json.append("}");
        
        Log.i(TAG, "[TILEJSON] Built TileJSON with " + regionIndex.size() + " packs, bounds: " + 
            minLon + "," + minLat + " to " + maxLon + "," + maxLat + ", zoom: " + minZoom + "-" + maxZoom);
        
        return json.toString();
    }

    /**
     * NanoHTTPD server implementation for serving tiles
     */
    private class TileServer extends NanoHTTPD {
        public TileServer(int port) {
            super("127.0.0.1", port);
        }

        @Override
        public Response serve(IHTTPSession session) {
            String uri = session.getUri();
            Method method = session.getMethod();
            
            // Log ALL requests at INFO level so they're visible in logcat
            Log.i(TAG, "[REQUEST] " + method + " " + uri);
            
            // Extra prominent logging for low-zoom composite tile requests
            if (uri.startsWith("/tiles/") && uri.endsWith(".pbf")) {
                String path = uri.substring(7, uri.length() - 4);
                String[] parts = path.split("/");
                if (parts.length == 3) {
                    try {
                        int z = Integer.parseInt(parts[0]);
                        if (z <= 8) {
                            Log.i(TAG, "════════════════════════════════════════════════════════════");
                            Log.i(TAG, "[LOW-ZOOM REQUEST] z" + z + " tile requested: " + uri);
                            Log.i(TAG, "════════════════════════════════════════════════════════════");
                        }
                    } catch (NumberFormatException ignored) {}
                }
            }
            
            // Handle CORS preflight
            if (method == Method.OPTIONS) {
                Response response = newFixedLengthResponse(Response.Status.OK, "text/plain", "");
                addCorsHeaders(response);
                return response;
            }
            
            // Parse tile request: /tiles/{chartId}/{z}/{x}/{y}.pbf or /tiles/{z}/{x}/{y}.pbf (composite)
            // Also handles /tiles/v{N}/{z}/{x}/{y}.pbf (versioned composite for cache busting)
            if (uri.startsWith("/tiles/")) {
                if (uri.endsWith(".pbf")) {
                    // Check if this is a composite request (no chartId, just z/x/y)
                    String path = uri.substring(7, uri.length() - 4); // Remove "/tiles/" and ".pbf"
                    String[] parts = path.split("/");
                    
                    // Handle versioned composite: /tiles/v{N}/{z}/{x}/{y}.pbf (4 parts, first starts with 'v')
                    if (parts.length == 4 && parts[0].startsWith("v")) {
                        return handleCompositeTileRequest(uri);
                    } else if (parts.length == 3) {
                        // Composite request: /tiles/{z}/{x}/{y}.pbf
                        return handleCompositeTileRequest(uri);
                    } else {
                        // Per-chart request: /tiles/{chartId}/{z}/{x}/{y}.pbf
                        return handleVectorTileRequest(uri);
                    }
                } else if (uri.endsWith(".png") || uri.endsWith(".jpg") || uri.endsWith(".jpeg")) {
                    return handleRasterTileRequest(uri);
                }
            }
            
            // Font glyph endpoint: /fonts/{fontstack}/{range}.pbf
            if (uri.startsWith("/fonts/") && uri.endsWith(".pbf")) {
                return handleFontRequest(uri);
            }
            
            // Health check endpoint
            if (uri.equals("/health")) {
                Response response = newFixedLengthResponse(Response.Status.OK, "application/json", "{\"status\":\"ok\"}");
                addCorsHeaders(response);
                return response;
            }
            
            // TileJSON endpoint for composite tiles - Mapbox needs this metadata
            if (uri.equals("/tiles.json") || uri.equals("/tiles/composite.json")) {
                Log.i(TAG, "[TILEJSON] Serving TileJSON metadata");
                String tileJson = buildCompositeTileJson();
                Response response = newFixedLengthResponse(Response.Status.OK, "application/json", tileJson);
                addCorsHeaders(response);
                return response;
            }
            
            // 404 for unknown routes
            Response response = newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not Found");
            addCorsHeaders(response);
            return response;
        }

        private Response handleVectorTileRequest(String uri) {
            long startTime = System.currentTimeMillis();
            try {
                // Parse /tiles/{chartId}/{z}/{x}/{y}.pbf
                String path = uri.substring(7); // Remove "/tiles/"
                path = path.substring(0, path.length() - 4); // Remove ".pbf"
                
                String[] parts = path.split("/");
                if (parts.length < 4) {
                    Log.w(TAG, "Invalid tile path format: " + uri);
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile path");
                }
                
                // Handle chartId that may contain slashes (shouldn't happen, but be safe)
                String chartId = parts[0];
                int z = Integer.parseInt(parts[parts.length - 3]);
                int x = Integer.parseInt(parts[parts.length - 2]);
                int y = Integer.parseInt(parts[parts.length - 1]);
                
                // Get tile data
                byte[] tileData = getTile(chartId, z, x, y);
                long queryTime = System.currentTimeMillis() - startTime;
                
                if (tileData == null || tileData.length == 0) {
                    // Return 204 No Content for missing tiles
                    Log.d(TAG, "Tile miss: " + chartId + "/" + z + "/" + x + "/" + y + " (" + queryTime + "ms)");
                    Response response = newFixedLengthResponse(Response.Status.NO_CONTENT, "application/x-protobuf", "");
                    addCorsHeaders(response);
                    addVectorTileHeaders(response);
                    return response;
                }
                
                // Log tile hit with size and timing
                Log.d(TAG, "Tile hit: " + chartId + "/" + z + "/" + x + "/" + y + 
                    " size=" + tileData.length + " bytes, query=" + queryTime + "ms");
                
                // Return tile data
                Response response = newFixedLengthResponse(
                    Response.Status.OK,
                    "application/x-protobuf",
                    new ByteArrayInputStream(tileData),
                    tileData.length
                );
                addCorsHeaders(response);
                addVectorTileHeaders(response);
                response.addHeader("Content-Encoding", "gzip"); // MBTiles vector tiles are gzipped
                
                return response;
            } catch (NumberFormatException e) {
                Log.e(TAG, "Invalid tile coordinates in: " + uri, e);
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile coordinates");
            } catch (Exception e) {
                Log.e(TAG, "Error handling tile request: " + uri, e);
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Internal error");
            }
        }

        /**
         * Handle composite tile request - quilts tiles from multiple charts
         * URL format: /tiles/{z}/{x}/{y}.pbf
         * 
         * This method tries ALL candidate charts in order of preference until
         * finding one that has actual tile data. This solves the issue where
         * multiple charts overlap at low zoom but only the first one was tried.
         */
        private Response handleCompositeTileRequest(String uri) {
            long startTime = System.currentTimeMillis();
            try {
                // Parse /tiles/{z}/{x}/{y}.pbf or /tiles/v{N}/{z}/{x}/{y}.pbf
                String path = uri.substring(7); // Remove "/tiles/"
                
                // Remove any query string if present
                int queryIndex = path.indexOf('?');
                if (queryIndex != -1) {
                    path = path.substring(0, queryIndex);
                }
                
                path = path.substring(0, path.length() - 4); // Remove ".pbf"
                
                String[] parts = path.split("/");
                
                // Handle versioned path: v{N}/{z}/{x}/{y} -> strip version prefix
                int zIndex = 0;
                if (parts.length == 4 && parts[0].startsWith("v")) {
                    zIndex = 1; // Skip version prefix
                } else if (parts.length != 3) {
                    Log.w(TAG, "Invalid composite tile path format: " + uri);
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile path");
                }
                
                int z = Integer.parseInt(parts[zIndex]);
                int x = Integer.parseInt(parts[zIndex + 1]);
                int y = Integer.parseInt(parts[zIndex + 2]);
                
                // Find ALL charts that cover this tile, sorted by preference
                List<String> candidateCharts = findChartsForTile(z, x, y, 0);
                tileRequestCount++;
                
                if (candidateCharts.isEmpty()) {
                    // No chart covers this tile
                    Log.d(TAG, "Composite: No chart for " + z + "/" + x + "/" + y);
                    Response response = newFixedLengthResponse(Response.Status.NO_CONTENT, "application/x-protobuf", "");
                    addCorsHeaders(response);
                    addVectorTileHeaders(response);
                    return response;
                }
                
                // Try each candidate chart until we find one with actual tile data
                // This is important because at low zoom, multiple charts may intersect
                // the tile bounds but have actual feature data in different tiles
                byte[] tileData = null;
                String selectedChart = null;
                int chartsTriedCount = 0;
                
                for (String chartId : candidateCharts) {
                    chartsTriedCount++;
                    tileData = getTile(chartId, z, x, y);
                    if (tileData != null && tileData.length > 0) {
                        selectedChart = chartId;
                        break;
                    }
                }
                
                long queryTime = System.currentTimeMillis() - startTime;
                
                if (tileData == null || tileData.length == 0) {
                    // No chart had data at this tile location
                    Log.d(TAG, "Composite: No tile data from " + chartsTriedCount + " charts at " + 
                        z + "/" + x + "/" + y + " (" + queryTime + "ms)");
                    Response response = newFixedLengthResponse(Response.Status.NO_CONTENT, "application/x-protobuf", "");
                    addCorsHeaders(response);
                    addVectorTileHeaders(response);
                    return response;
                }
                
                // Track chart switches with prominent logging
                boolean chartChanged = !selectedChart.equals(lastSelectedChart);
                boolean zoomChanged = z != lastZoom;
                
                if (chartChanged) {
                    chartSwitchCount++;
                    Log.i(TAG, "════════════════════════════════════════════════════════════");
                    Log.i(TAG, "[CHART SWITCH] " + lastSelectedChart + " → " + selectedChart);
                    Log.i(TAG, "[CHART SWITCH] Zoom: z" + lastZoom + " → z" + z);
                    Log.i(TAG, "[CHART SWITCH] Tried " + chartsTriedCount + "/" + candidateCharts.size() + " candidates");
                    Log.i(TAG, "[CHART SWITCH] Total switches: " + chartSwitchCount + " / " + tileRequestCount + " requests");
                    Log.i(TAG, "════════════════════════════════════════════════════════════");
                    lastSelectedChart = selectedChart;
                } else if (zoomChanged) {
                    Log.i(TAG, "[ZOOM] z" + lastZoom + " → z" + z + " (still using " + selectedChart + ")");
                }
                lastZoom = z;
                
                // Log hit with details about fallback behavior
                if (chartsTriedCount > 1) {
                    Log.i(TAG, "Composite hit: " + z + "/" + x + "/" + y + " -> " + selectedChart + 
                        " (tried " + chartsTriedCount + " charts, " + tileData.length + " bytes, " + queryTime + "ms)");
                } else {
                    Log.d(TAG, "Composite hit: " + z + "/" + x + "/" + y + " -> " + selectedChart + 
                        " (" + tileData.length + " bytes, " + queryTime + "ms)");
                }
                
                // Return tile data
                Response response = newFixedLengthResponse(
                    Response.Status.OK,
                    "application/x-protobuf",
                    new ByteArrayInputStream(tileData),
                    tileData.length
                );
                addCorsHeaders(response);
                addVectorTileHeaders(response);
                response.addHeader("Content-Encoding", "gzip");
                response.addHeader("X-Chart-Source", selectedChart); // Debug header showing which chart was used
                response.addHeader("X-Charts-Tried", String.valueOf(chartsTriedCount)); // How many charts were tried
                
                return response;
            } catch (NumberFormatException e) {
                Log.e(TAG, "Invalid composite tile coordinates in: " + uri, e);
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile coordinates");
            } catch (Exception e) {
                Log.e(TAG, "Error handling composite tile request: " + uri, e);
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Internal error");
            }
        }

        /**
         * Handle font glyph requests: /fonts/{fontstack}/{range}.pbf
         * Serves pre-built PBF font files from assets for offline text rendering
         */
        private Response handleFontRequest(String uri) {
            try {
                // Parse /fonts/{fontstack}/{range}.pbf
                // Example: /fonts/Noto%20Sans%20Regular/0-255.pbf
                String path = uri.substring(7); // Remove "/fonts/"
                path = path.substring(0, path.length() - 4); // Remove ".pbf"
                
                // URL decode the fontstack (spaces are %20)
                String[] parts = path.split("/");
                if (parts.length != 2) {
                    Log.w(TAG, "[FONTS] Invalid font path format: " + uri);
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid font path");
                }
                
                String fontstack = java.net.URLDecoder.decode(parts[0], "UTF-8");
                String range = parts[1];
                
                // Build asset path: fonts/{fontstack}/{range}.pbf
                String assetPath = "fonts/" + fontstack + "/" + range + ".pbf";
                
                Log.d(TAG, "[FONTS] Serving: " + assetPath);
                
                // Read from assets
                AssetManager assetManager = reactContext.getAssets();
                java.io.InputStream is = assetManager.open(assetPath);
                java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                
                int nRead;
                byte[] data = new byte[16384];
                while ((nRead = is.read(data, 0, data.length)) != -1) {
                    buffer.write(data, 0, nRead);
                }
                is.close();
                
                byte[] fontData = buffer.toByteArray();
                
                Response response = newFixedLengthResponse(
                    Response.Status.OK,
                    "application/x-protobuf",
                    new java.io.ByteArrayInputStream(fontData),
                    fontData.length
                );
                addCorsHeaders(response);
                response.addHeader("Cache-Control", "public, max-age=31536000"); // Cache for 1 year
                return response;
                
            } catch (java.io.FileNotFoundException e) {
                Log.w(TAG, "[FONTS] Font not found: " + uri);
                return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Font not found");
            } catch (Exception e) {
                Log.e(TAG, "[FONTS] Error serving font: " + uri, e);
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Error loading font");
            }
        }

        private Response handleRasterTileRequest(String uri) {
            long startTime = System.currentTimeMillis();
            try {
                // Parse /tiles/{chartId}/{z}/{x}/{y}.{png|jpg|jpeg}
                String path = uri.substring(7); // Remove "/tiles/"
                
                // Determine content type and remove extension
                String contentType = "image/png";
                if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
                    contentType = "image/jpeg";
                    path = path.substring(0, path.lastIndexOf('.'));
                } else if (path.endsWith(".png")) {
                    path = path.substring(0, path.length() - 4);
                }
                
                String[] parts = path.split("/");
                if (parts.length < 4) {
                    Log.w(TAG, "Invalid raster tile path format: " + uri);
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile path");
                }
                
                String chartId = parts[0];
                int z = Integer.parseInt(parts[parts.length - 3]);
                int x = Integer.parseInt(parts[parts.length - 2]);
                int y = Integer.parseInt(parts[parts.length - 1]);
                
                // Handle satellite tile routing to per-zoom files (multi-district)
                byte[] tileData = null;
                if (chartId.equals("satellite") || chartId.equals("satellite_alaska")) {
                    List<String> satelliteCandidates = getSatelliteFilesForZoom(z);
                    Log.d(TAG, "Satellite tile z" + z + " trying " + satelliteCandidates.size() + " candidates");
                    for (String candidate : satelliteCandidates) {
                        tileData = getTile(candidate, z, x, y);
                        if (tileData != null && tileData.length > 0) {
                            Log.d(TAG, "Satellite tile z" + z + " served from: " + candidate);
                            break;
                        }
                    }
                } else {
                    // Direct tile request (e.g., alaska_satellite_z8, d07_ocean_z0-5)
                    tileData = getTile(chartId, z, x, y);
                }
                
                long queryTime = System.currentTimeMillis() - startTime;
                
                if (tileData == null || tileData.length == 0) {
                    // Return 204 No Content for missing tiles
                    Log.d(TAG, "Raster tile miss: " + chartId + "/" + z + "/" + x + "/" + y + " (" + queryTime + "ms)");
                    Response response = newFixedLengthResponse(Response.Status.NO_CONTENT, contentType, "");
                    addCorsHeaders(response);
                    addRasterTileHeaders(response);
                    return response;
                }
                
                // Log tile hit with size and timing
                Log.d(TAG, "Raster tile hit: " + chartId + "/" + z + "/" + x + "/" + y + 
                    " size=" + tileData.length + " bytes, query=" + queryTime + "ms");
                
                // Return tile data (not gzipped for raster tiles)
                Response response = newFixedLengthResponse(
                    Response.Status.OK,
                    contentType,
                    new ByteArrayInputStream(tileData),
                    tileData.length
                );
                addCorsHeaders(response);
                addRasterTileHeaders(response);
                
                return response;
            } catch (NumberFormatException e) {
                Log.e(TAG, "Invalid raster tile coordinates in: " + uri, e);
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile coordinates");
            } catch (Exception e) {
                Log.e(TAG, "Error handling raster tile request: " + uri, e);
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Internal error");
            }
        }

        private void addCorsHeaders(Response response) {
            response.addHeader("Access-Control-Allow-Origin", "*");
            response.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
            response.addHeader("Access-Control-Allow-Headers", "Content-Type");
        }

        private void addVectorTileHeaders(Response response) {
            response.addHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
            response.addHeader("Content-Type", "application/x-protobuf");
        }

        private void addRasterTileHeaders(Response response) {
            response.addHeader("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
            response.addHeader("Content-Type", "image/png");
        }
    }
}
