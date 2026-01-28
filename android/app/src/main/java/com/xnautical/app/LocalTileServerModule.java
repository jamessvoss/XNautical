package com.xnautical.app;

import android.content.Context;
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
    
    // Chart index for composite tile serving
    private final ConcurrentHashMap<String, ChartInfo> chartIndex = new ConcurrentHashMap<>();
    private boolean chartIndexLoaded = false;
    
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
            
            // Load chart index for composite tile serving
            loadChartIndex();
            
            server = new TileServer(port);
            server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
            
            String url = "http://127.0.0.1:" + port;
            Log.i(TAG, "======================================");
            Log.i(TAG, "Tile Server Started");
            Log.i(TAG, "  URL: " + url);
            Log.i(TAG, "  Port: " + port);
            Log.i(TAG, "  MBTiles dir: " + mbtilesDir);
            
            // List available MBTiles files (reuse dir variable from above)
            if (dir.exists() && dir.isDirectory()) {
                String[] files = dir.list();
                if (files != null && files.length > 0) {
                    Log.i(TAG, "  Available MBTiles files:");
                    for (String f : files) {
                        if (f.endsWith(".mbtiles")) {
                            File mbt = new File(dir, f);
                            Log.i(TAG, "    - " + f + " (" + mbt.length() / 1024 + " KB)");
                        }
                    }
                } else {
                    Log.w(TAG, "  No MBTiles files found in directory");
                }
            } else {
                Log.w(TAG, "  MBTiles directory does not exist or is not a directory");
            }
            Log.i(TAG, "======================================");
            
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
     * Load the chart index from chart_index.json
     */
    private void loadChartIndex() {
        chartIndex.clear();
        chartIndexLoaded = false;
        
        String indexPath = mbtilesDir + "/chart_index.json";
        File indexFile = new File(indexPath);
        
        if (!indexFile.exists()) {
            Log.w(TAG, "Chart index not found: " + indexPath);
            return;
        }
        
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
                Log.w(TAG, "No 'charts' object in index");
                return;
            }
            
            // Iterate through charts
            java.util.Iterator<String> keys = charts.keys();
            while (keys.hasNext()) {
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
                }
            }
            
            chartIndexLoaded = true;
            Log.i(TAG, "Chart index loaded: " + chartIndex.size() + " charts with mbtiles files");
            
        } catch (Exception e) {
            Log.e(TAG, "Failed to load chart index", e);
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
     * Find the best chart for a tile using quilting logic
     * Returns the most detailed chart that covers the tile and is visible at this zoom
     */
    private String findBestChartForTile(int z, int x, int y) {
        if (!chartIndexLoaded || chartIndex.isEmpty()) {
            return null;
        }
        
        double[] bounds = tileToBounds(z, x, y);
        double west = bounds[0], south = bounds[1], east = bounds[2], north = bounds[3];
        double centerLon = (west + east) / 2;
        double centerLat = (south + north) / 2;
        
        // Find all charts that contain the tile center and are visible at this zoom
        List<ChartInfo> candidates = new ArrayList<>();
        for (ChartInfo chart : chartIndex.values()) {
            if (chart.containsPoint(centerLon, centerLat) && chart.isVisibleAtZoom(z)) {
                candidates.add(chart);
            }
        }
        
        if (candidates.isEmpty()) {
            return null;
        }
        
        // Sort by level descending (most detailed first)
        Collections.sort(candidates, new Comparator<ChartInfo>() {
            @Override
            public int compare(ChartInfo a, ChartInfo b) {
                return b.level - a.level;
            }
        });
        
        // Return the most detailed chart
        return candidates.get(0).chartId;
    }

    /**
     * Open a database connection for a chart
     */
    private SQLiteDatabase openDatabase(String chartId) {
        if (databases.containsKey(chartId)) {
            SQLiteDatabase db = databases.get(chartId);
            if (db != null && db.isOpen()) {
                Log.d(TAG, "Using cached DB connection for: " + chartId);
                return db;
            }
        }
        
        String dbPath = mbtilesDir + "/" + chartId + ".mbtiles";
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
            databases.put(chartId, db);
            Log.i(TAG, "✓ Opened database: " + chartId + " (" + dbFile.length() / 1024 + " KB)");
            
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
                
                // Count tiles
                Cursor countCursor = db.rawQuery("SELECT COUNT(*), MIN(zoom_level), MAX(zoom_level) FROM tiles", null);
                if (countCursor.moveToFirst()) {
                    int count = countCursor.getInt(0);
                    int minZ = countCursor.getInt(1);
                    int maxZ = countCursor.getInt(2);
                    Log.i(TAG, "  Tiles: " + count + " (zoom " + minZ + "-" + maxZ + ")");
                }
                countCursor.close();
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
            
            Log.d(TAG, "Request: " + method + " " + uri);
            
            // Handle CORS preflight
            if (method == Method.OPTIONS) {
                Response response = newFixedLengthResponse(Response.Status.OK, "text/plain", "");
                addCorsHeaders(response);
                return response;
            }
            
            // Parse tile request: /tiles/{chartId}/{z}/{x}/{y}.pbf or /tiles/{z}/{x}/{y}.pbf (composite)
            if (uri.startsWith("/tiles/")) {
                if (uri.endsWith(".pbf")) {
                    // Check if this is a composite request (no chartId, just z/x/y)
                    String path = uri.substring(7, uri.length() - 4); // Remove "/tiles/" and ".pbf"
                    String[] parts = path.split("/");
                    if (parts.length == 3) {
                        // Composite request: /tiles/{z}/{x}/{y}.pbf
                        return handleCompositeTileRequest(uri);
                    } else {
                        // Per-chart request: /tiles/{chartId}/{z}/{x}/{y}.pbf
                        return handleVectorTileRequest(uri);
                    }
                } else if (uri.endsWith(".png")) {
                    return handleRasterTileRequest(uri);
                }
            }
            
            // Health check endpoint
            if (uri.equals("/health")) {
                Response response = newFixedLengthResponse(Response.Status.OK, "application/json", "{\"status\":\"ok\"}");
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
         */
        private Response handleCompositeTileRequest(String uri) {
            long startTime = System.currentTimeMillis();
            try {
                // Parse /tiles/{z}/{x}/{y}.pbf
                String path = uri.substring(7); // Remove "/tiles/"
                path = path.substring(0, path.length() - 4); // Remove ".pbf"
                
                String[] parts = path.split("/");
                if (parts.length != 3) {
                    Log.w(TAG, "Invalid composite tile path format: " + uri);
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile path");
                }
                
                int z = Integer.parseInt(parts[0]);
                int x = Integer.parseInt(parts[1]);
                int y = Integer.parseInt(parts[2]);
                
                // Find the best chart for this tile using quilting logic
                String bestChart = findBestChartForTile(z, x, y);
                
                if (bestChart == null) {
                    // No chart covers this tile
                    Log.d(TAG, "Composite: No chart for " + z + "/" + x + "/" + y);
                    Response response = newFixedLengthResponse(Response.Status.NO_CONTENT, "application/x-protobuf", "");
                    addCorsHeaders(response);
                    addVectorTileHeaders(response);
                    return response;
                }
                
                // Get tile from the best chart
                byte[] tileData = getTile(bestChart, z, x, y);
                long queryTime = System.currentTimeMillis() - startTime;
                
                if (tileData == null || tileData.length == 0) {
                    // Chart exists but no tile data at this location
                    Log.d(TAG, "Composite: No tile from " + bestChart + " at " + z + "/" + x + "/" + y + " (" + queryTime + "ms)");
                    Response response = newFixedLengthResponse(Response.Status.NO_CONTENT, "application/x-protobuf", "");
                    addCorsHeaders(response);
                    addVectorTileHeaders(response);
                    return response;
                }
                
                // Log hit with chart selection info
                Log.d(TAG, "Composite hit: " + z + "/" + x + "/" + y + " -> " + bestChart + 
                    " (" + tileData.length + " bytes, " + queryTime + "ms)");
                
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
                response.addHeader("X-Chart-Source", bestChart); // Debug header showing which chart was used
                
                return response;
            } catch (NumberFormatException e) {
                Log.e(TAG, "Invalid composite tile coordinates in: " + uri, e);
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile coordinates");
            } catch (Exception e) {
                Log.e(TAG, "Error handling composite tile request: " + uri, e);
                return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Internal error");
            }
        }

        private Response handleRasterTileRequest(String uri) {
            long startTime = System.currentTimeMillis();
            try {
                // Parse /tiles/{chartId}/{z}/{x}/{y}.png
                String path = uri.substring(7); // Remove "/tiles/"
                path = path.substring(0, path.length() - 4); // Remove ".png"
                
                String[] parts = path.split("/");
                if (parts.length < 4) {
                    Log.w(TAG, "Invalid raster tile path format: " + uri);
                    return newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", "Invalid tile path");
                }
                
                String chartId = parts[0];
                int z = Integer.parseInt(parts[parts.length - 3]);
                int x = Integer.parseInt(parts[parts.length - 2]);
                int y = Integer.parseInt(parts[parts.length - 1]);
                
                // Get tile data
                byte[] tileData = getTile(chartId, z, x, y);
                long queryTime = System.currentTimeMillis() - startTime;
                
                if (tileData == null || tileData.length == 0) {
                    // Return 204 No Content for missing tiles
                    Log.d(TAG, "Raster tile miss: " + chartId + "/" + z + "/" + x + "/" + y + " (" + queryTime + "ms)");
                    Response response = newFixedLengthResponse(Response.Status.NO_CONTENT, "image/png", "");
                    addCorsHeaders(response);
                    addRasterTileHeaders(response);
                    return response;
                }
                
                // Log tile hit with size and timing
                Log.d(TAG, "Raster tile hit: " + chartId + "/" + z + "/" + x + "/" + y + 
                    " size=" + tileData.length + " bytes, query=" + queryTime + "ms");
                
                // Return PNG tile data (not gzipped)
                Response response = newFixedLengthResponse(
                    Response.Status.OK,
                    "image/png",
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
