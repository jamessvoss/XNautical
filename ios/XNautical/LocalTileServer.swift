import Foundation
import React
import SQLite3

/**
 * Native HTTP tile server that serves MBTiles vector tiles.
 *
 * This module runs a local HTTP server on the device that:
 * 1. Listens on a configurable port (default 8765)
 * 2. Handles GET requests for /tiles/{chartId}/{z}/{x}/{y}.pbf
 * 3. Reads tile data directly from MBTiles SQLite databases
 * 4. Returns binary protobuf responses with proper headers
 *
 * Uses a simple custom HTTP server implementation to avoid external dependencies.
 */
@objc(LocalTileServer)
class LocalTileServer: NSObject {
  
  private static let DEFAULT_PORT: UInt16 = 8765
  private var server: SimpleTileServer?
  private var port: UInt16 = DEFAULT_PORT
  private var mbtilesDir: String?
  
  // Cache of open database connections
  private var databases: [String: OpaquePointer?] = [:]
  private let dbLock = NSLock()
  
  // Chart index for composite tile serving
  private var chartIndex: [String: ChartInfo] = [:]
  private var chartIndexLoaded = false
  private let indexLock = NSLock()
  
  // Chart metadata for quilting decisions
  private struct ChartInfo {
    let chartId: String
    var west: Double = -180
    var south: Double = -90
    var east: Double = 180
    var north: Double = 90
    var level: Int = 1
    var minZoom: Int = 0
    var maxZoom: Int = 22
    
    func containsPoint(lon: Double, lat: Double) -> Bool {
      return lon >= west && lon <= east && lat >= south && lat <= north
    }
    
    func isVisibleAtZoom(_ zoom: Int) -> Bool {
      return zoom >= minZoom && zoom <= maxZoom
    }
  }
  
  override init() {
    super.init()
  }
  
  /**
   * Start the tile server
   */
  @objc
  func start(_ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let existingServer = server, existingServer.isRunning {
      resolve("http://127.0.0.1:\(port)")
      return
    }
    
    port = (options["port"] as? NSNumber)?.uint16Value ?? Self.DEFAULT_PORT
    
    if let dir = options["mbtilesDir"] as? String {
      mbtilesDir = dir
    } else {
      // Default to documents directory
      let documentsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
      mbtilesDir = documentsDir.appendingPathComponent("mbtiles").path
    }
    
    // Ensure directory exists
    try? FileManager.default.createDirectory(atPath: mbtilesDir!, withIntermediateDirectories: true, attributes: nil)
    
    // Load chart index for composite tile serving
    loadChartIndex()
    
    do {
      server = SimpleTileServer(port: port, tileProvider: self)
      try server?.start()
      
      let url = "http://127.0.0.1:\(port)"
      print("[LocalTileServer] Server started at \(url)")
      print("[LocalTileServer] MBTiles directory: \(mbtilesDir!)")
      
      resolve(url)
    } catch {
      print("[LocalTileServer] Failed to start server: \(error)")
      reject("START_ERROR", "Failed to start tile server: \(error.localizedDescription)", error)
    }
  }
  
  /**
   * Stop the tile server
   */
  @objc
  func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    server?.stop()
    server = nil
    
    // Close all database connections
    dbLock.lock()
    for (_, db) in databases {
      if let db = db {
        sqlite3_close(db)
      }
    }
    databases.removeAll()
    dbLock.unlock()
    
    print("[LocalTileServer] Server stopped")
    resolve(nil)
  }
  
  /**
   * Check if server is running
   */
  @objc
  func isRunning(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(server?.isRunning ?? false)
  }
  
  /**
   * Get the server URL
   */
  @objc
  func getServerUrl(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let server = server, server.isRunning {
      resolve("http://127.0.0.1:\(port)")
    } else {
      resolve(nil)
    }
  }
  
  /**
   * Get the tile URL template for a chart
   */
  @objc
  func getTileUrlTemplate(_ chartId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve("http://127.0.0.1:\(port)/tiles/\(chartId)/{z}/{x}/{y}.pbf")
  }
  
  /**
   * Get the composite tile URL template (no chartId - server does quilting)
   */
  @objc
  func getCompositeTileUrl(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve("http://127.0.0.1:\(port)/tiles/{z}/{x}/{y}.pbf")
  }
  
  /**
   * Load chart index from chart_index.json
   */
  private func loadChartIndex() {
    indexLock.lock()
    defer { indexLock.unlock() }
    
    chartIndex.removeAll()
    chartIndexLoaded = false
    
    guard let mbtilesDir = mbtilesDir else {
      print("[LocalTileServer] MBTiles directory not set")
      return
    }
    
    let indexPath = "\(mbtilesDir)/chart_index.json"
    
    guard FileManager.default.fileExists(atPath: indexPath) else {
      print("[LocalTileServer] Chart index not found: \(indexPath)")
      return
    }
    
    do {
      let data = try Data(contentsOf: URL(fileURLWithPath: indexPath))
      guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let charts = json["charts"] as? [String: [String: Any]] else {
        print("[LocalTileServer] Invalid chart index format")
        return
      }
      
      for (chartId, chartData) in charts {
        var info = ChartInfo(chartId: chartId)
        
        // Parse bounds [west, south, east, north]
        if let bounds = chartData["bounds"] as? [Double], bounds.count == 4 {
          info.west = bounds[0]
          info.south = bounds[1]
          info.east = bounds[2]
          info.north = bounds[3]
        }
        
        // Parse level
        if let level = chartData["level"] as? Int {
          info.level = level
        }
        
        // Parse zoom range
        if let minZoom = chartData["minZoom"] as? Int {
          info.minZoom = minZoom
        }
        if let maxZoom = chartData["maxZoom"] as? Int {
          info.maxZoom = maxZoom
        }
        
        // Verify mbtiles file exists
        let mbtPath = "\(mbtilesDir)/\(chartId).mbtiles"
        if FileManager.default.fileExists(atPath: mbtPath) {
          chartIndex[chartId] = info
        }
      }
      
      chartIndexLoaded = true
      print("[LocalTileServer] Chart index loaded: \(chartIndex.count) charts with mbtiles files")
      
    } catch {
      print("[LocalTileServer] Failed to load chart index: \(error)")
    }
  }
  
  /**
   * Convert tile coordinates to geographic bounds
   */
  func tileToBounds(z: Int, x: Int, y: Int) -> (west: Double, south: Double, east: Double, north: Double) {
    let n = pow(2.0, Double(z))
    let west = Double(x) / n * 360.0 - 180.0
    let east = Double(x + 1) / n * 360.0 - 180.0
    let north = atan(sinh(.pi * (1 - 2.0 * Double(y) / n))) * 180.0 / .pi
    let south = atan(sinh(.pi * (1 - 2.0 * Double(y + 1) / n))) * 180.0 / .pi
    return (west, south, east, north)
  }
  
  /**
   * Find the best chart for a tile using quilting logic
   */
  func findBestChartForTile(z: Int, x: Int, y: Int) -> String? {
    indexLock.lock()
    defer { indexLock.unlock() }
    
    guard chartIndexLoaded, !chartIndex.isEmpty else {
      return nil
    }
    
    let bounds = tileToBounds(z: z, x: x, y: y)
    let centerLon = (bounds.west + bounds.east) / 2
    let centerLat = (bounds.south + bounds.north) / 2
    
    // Find all charts that contain the tile center and are visible at this zoom
    var candidates = chartIndex.values.filter { chart in
      chart.containsPoint(lon: centerLon, lat: centerLat) && chart.isVisibleAtZoom(z)
    }
    
    guard !candidates.isEmpty else {
      return nil
    }
    
    // Sort by level descending (most detailed first)
    candidates.sort { $0.level > $1.level }
    
    return candidates.first?.chartId
  }
  
  /**
   * Open a database connection for a chart
   */
  func openDatabase(chartId: String) -> OpaquePointer? {
    dbLock.lock()
    defer { dbLock.unlock() }
    
    if let db = databases[chartId], db != nil {
      return db
    }
    
    guard let mbtilesDir = mbtilesDir else {
      print("[LocalTileServer] MBTiles directory not set")
      return nil
    }
    
    let dbPath = "\(mbtilesDir)/\(chartId).mbtiles"
    
    if !FileManager.default.fileExists(atPath: dbPath) {
      print("[LocalTileServer] MBTiles file not found: \(dbPath)")
      return nil
    }
    
    var db: OpaquePointer?
    let result = sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil)
    
    if result != SQLITE_OK {
      print("[LocalTileServer] Failed to open database: \(dbPath)")
      return nil
    }
    
    databases[chartId] = db
    print("[LocalTileServer] Opened database: \(dbPath)")
    return db
  }
  
  /**
   * Get a tile from the MBTiles database
   */
  func getTile(chartId: String, z: Int, x: Int, y: Int) -> Data? {
    guard let db = openDatabase(chartId: chartId) else {
      return nil
    }
    
    // MBTiles uses TMS y-coordinate (flipped)
    let tmsY = (1 << z) - 1 - y
    
    let query = "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?"
    var statement: OpaquePointer?
    
    guard sqlite3_prepare_v2(db, query, -1, &statement, nil) == SQLITE_OK else {
      print("[LocalTileServer] Failed to prepare query")
      return nil
    }
    
    defer { sqlite3_finalize(statement) }
    
    sqlite3_bind_int(statement, 1, Int32(z))
    sqlite3_bind_int(statement, 2, Int32(x))
    sqlite3_bind_int(statement, 3, Int32(tmsY))
    
    if sqlite3_step(statement) == SQLITE_ROW {
      if let dataPointer = sqlite3_column_blob(statement, 0) {
        let dataSize = sqlite3_column_bytes(statement, 0)
        let data = Data(bytes: dataPointer, count: Int(dataSize))
        print("[LocalTileServer] Found tile \(chartId)/\(z)/\(x)/\(y) (\(data.count) bytes)")
        return data
      }
    }
    
    print("[LocalTileServer] Tile not found: \(chartId)/\(z)/\(x)/\(y)")
    return nil
  }
  
  // Required for RCTBridgeModule
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}

/**
 * Simple HTTP server for serving tiles
 */
class SimpleTileServer {
  private let port: UInt16
  private weak var tileProvider: LocalTileServer?
  private var serverSocket: Int32 = -1
  private var listenThread: Thread?
  private(set) var isRunning = false
  
  init(port: UInt16, tileProvider: LocalTileServer) {
    self.port = port
    self.tileProvider = tileProvider
  }
  
  func start() throws {
    // Create socket
    serverSocket = socket(AF_INET, SOCK_STREAM, 0)
    guard serverSocket >= 0 else {
      throw NSError(domain: "TileServer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create socket"])
    }
    
    // Allow socket reuse
    var reuseAddr: Int32 = 1
    setsockopt(serverSocket, SOL_SOCKET, SO_REUSEADDR, &reuseAddr, socklen_t(MemoryLayout<Int32>.size))
    
    // Bind to address
    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = INADDR_ANY
    
    let bindResult = withUnsafePointer(to: &addr) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(serverSocket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    
    guard bindResult >= 0 else {
      close(serverSocket)
      throw NSError(domain: "TileServer", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed to bind to port \(port)"])
    }
    
    // Listen for connections
    guard listen(serverSocket, 10) >= 0 else {
      close(serverSocket)
      throw NSError(domain: "TileServer", code: 3, userInfo: [NSLocalizedDescriptionKey: "Failed to listen on socket"])
    }
    
    isRunning = true
    
    // Start listening thread
    listenThread = Thread { [weak self] in
      self?.acceptConnections()
    }
    listenThread?.name = "TileServerListener"
    listenThread?.start()
  }
  
  func stop() {
    isRunning = false
    if serverSocket >= 0 {
      close(serverSocket)
      serverSocket = -1
    }
    listenThread?.cancel()
    listenThread = nil
  }
  
  private func acceptConnections() {
    while isRunning {
      var clientAddr = sockaddr_in()
      var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
      
      let clientSocket = withUnsafeMutablePointer(to: &clientAddr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          accept(serverSocket, $0, &addrLen)
        }
      }
      
      if clientSocket >= 0 {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
          self?.handleConnection(clientSocket)
        }
      }
    }
  }
  
  private func handleConnection(_ clientSocket: Int32) {
    defer { close(clientSocket) }
    
    // Read request
    var buffer = [CChar](repeating: 0, count: 4096)
    let bytesRead = recv(clientSocket, &buffer, buffer.count - 1, 0)
    
    guard bytesRead > 0 else { return }
    
    let request = String(cString: buffer)
    
    // Parse request line
    let lines = request.components(separatedBy: "\r\n")
    guard let requestLine = lines.first else { return }
    
    let parts = requestLine.components(separatedBy: " ")
    guard parts.count >= 2 else { return }
    
    let method = parts[0]
    let path = parts[1]
    
    print("[TileServer] \(method) \(path)")
    
    // Handle request
    let response: (statusCode: Int, contentType: String, body: Data, headers: [String: String])
    
    if method == "OPTIONS" {
      response = (200, "text/plain", Data(), corsHeaders())
    } else if path.hasPrefix("/tiles/") && path.hasSuffix(".pbf") {
      // Check if this is a composite request (no chartId, just z/x/y)
      let cleanPath = String(path.dropFirst(7).dropLast(4)) // Remove "/tiles/" and ".pbf"
      let parts = cleanPath.components(separatedBy: "/")
      if parts.count == 3 {
        // Composite request: /tiles/{z}/{x}/{y}.pbf
        response = handleCompositeTileRequest(path)
      } else {
        // Per-chart request: /tiles/{chartId}/{z}/{x}/{y}.pbf
        response = handleTileRequest(path)
      }
    } else if path == "/health" {
      let body = "{\"status\":\"ok\"}".data(using: .utf8)!
      response = (200, "application/json", body, corsHeaders())
    } else {
      let body = "Not Found".data(using: .utf8)!
      response = (404, "text/plain", body, corsHeaders())
    }
    
    // Send response
    sendResponse(clientSocket, statusCode: response.statusCode, contentType: response.contentType, body: response.body, headers: response.headers)
  }
  
  private func handleTileRequest(_ path: String) -> (Int, String, Data, [String: String]) {
    // Parse /tiles/{chartId}/{z}/{x}/{y}.pbf
    var cleanPath = String(path.dropFirst(7)) // Remove "/tiles/"
    cleanPath = String(cleanPath.dropLast(4)) // Remove ".pbf"
    
    let parts = cleanPath.components(separatedBy: "/")
    guard parts.count >= 4 else {
      return (400, "text/plain", "Invalid tile path".data(using: .utf8)!, corsHeaders())
    }
    
    let chartId = parts[0]
    guard let z = Int(parts[parts.count - 3]),
          let x = Int(parts[parts.count - 2]),
          let y = Int(parts[parts.count - 1]) else {
      return (400, "text/plain", "Invalid tile coordinates".data(using: .utf8)!, corsHeaders())
    }
    
    // Get tile data
    guard let tileData = tileProvider?.getTile(chartId: chartId, z: z, x: x, y: y), !tileData.isEmpty else {
      // Return 204 No Content for missing tiles
      var headers = corsHeaders()
      headers["Cache-Control"] = "public, max-age=86400"
      return (204, "application/x-protobuf", Data(), headers)
    }
    
    // Return tile data
    var headers = corsHeaders()
    headers["Content-Encoding"] = "gzip" // MBTiles tiles are gzipped
    headers["Cache-Control"] = "public, max-age=86400"
    
    return (200, "application/x-protobuf", tileData, headers)
  }
  
  /**
   * Handle composite tile request - quilts tiles from multiple charts
   * URL format: /tiles/{z}/{x}/{y}.pbf
   */
  private func handleCompositeTileRequest(_ path: String) -> (Int, String, Data, [String: String]) {
    // Parse /tiles/{z}/{x}/{y}.pbf
    var cleanPath = String(path.dropFirst(7)) // Remove "/tiles/"
    cleanPath = String(cleanPath.dropLast(4)) // Remove ".pbf"
    
    let parts = cleanPath.components(separatedBy: "/")
    guard parts.count == 3,
          let z = Int(parts[0]),
          let x = Int(parts[1]),
          let y = Int(parts[2]) else {
      return (400, "text/plain", "Invalid tile path".data(using: .utf8)!, corsHeaders())
    }
    
    // Find the best chart for this tile using quilting logic
    guard let bestChart = tileProvider?.findBestChartForTile(z: z, x: x, y: y) else {
      // No chart covers this tile
      print("[TileServer] Composite: No chart for \(z)/\(x)/\(y)")
      var headers = corsHeaders()
      headers["Cache-Control"] = "public, max-age=86400"
      return (204, "application/x-protobuf", Data(), headers)
    }
    
    // Get tile from the best chart
    guard let tileData = tileProvider?.getTile(chartId: bestChart, z: z, x: x, y: y), !tileData.isEmpty else {
      // Chart exists but no tile data at this location
      print("[TileServer] Composite: No tile from \(bestChart) at \(z)/\(x)/\(y)")
      var headers = corsHeaders()
      headers["Cache-Control"] = "public, max-age=86400"
      return (204, "application/x-protobuf", Data(), headers)
    }
    
    print("[TileServer] Composite hit: \(z)/\(x)/\(y) -> \(bestChart) (\(tileData.count) bytes)")
    
    // Return tile data
    var headers = corsHeaders()
    headers["Content-Encoding"] = "gzip"
    headers["Cache-Control"] = "public, max-age=86400"
    headers["X-Chart-Source"] = bestChart
    
    return (200, "application/x-protobuf", tileData, headers)
  }
  
  private func corsHeaders() -> [String: String] {
    return [
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    ]
  }
  
  private func sendResponse(_ socket: Int32, statusCode: Int, contentType: String, body: Data, headers: [String: String]) {
    let statusText: String
    switch statusCode {
    case 200: statusText = "OK"
    case 204: statusText = "No Content"
    case 400: statusText = "Bad Request"
    case 404: statusText = "Not Found"
    case 500: statusText = "Internal Server Error"
    default: statusText = "Unknown"
    }
    
    var response = "HTTP/1.1 \(statusCode) \(statusText)\r\n"
    response += "Content-Type: \(contentType)\r\n"
    response += "Content-Length: \(body.count)\r\n"
    response += "Connection: close\r\n"
    
    for (key, value) in headers {
      response += "\(key): \(value)\r\n"
    }
    
    response += "\r\n"
    
    // Send headers
    response.withCString { ptr in
      _ = send(socket, ptr, strlen(ptr), 0)
    }
    
    // Send body
    if !body.isEmpty {
      body.withUnsafeBytes { ptr in
        _ = send(socket, ptr.baseAddress!, body.count, 0)
      }
    }
  }
}
