declare module 'react-native-http-bridge' {
  interface HttpRequest {
    requestId: string;
    url: string;
    type: string;
    postData?: string;
  }

  type RequestCallback = (request: HttpRequest) => void;

  function start(port: number, serviceName: string, callback: RequestCallback): void;
  function stop(): void;
  function respond(
    requestId: string,
    code: number,
    type: string,
    body: string
  ): void;
}

/**
 * LocalTileServer Native Module
 * 
 * Provides a local HTTP server for serving MBTiles vector tiles.
 * The server runs on the device and handles tile requests natively,
 * reading directly from SQLite and returning binary protobuf responses.
 */
interface LocalTileServerModule {
  /**
   * Start the tile server
   * @param options Configuration options
   * @returns Promise resolving to the server URL
   */
  start(options: {
    port?: number;
    mbtilesDir?: string;
  }): Promise<string>;

  /**
   * Stop the tile server
   */
  stop(): Promise<void>;

  /**
   * Check if the server is running
   */
  isRunning(): Promise<boolean>;

  /**
   * Get the server URL if running
   */
  getServerUrl(): Promise<string | null>;

  /**
   * Get the tile URL template for a chart
   * @param chartId The chart ID
   * @returns URL template like "http://127.0.0.1:8765/tiles/{chartId}/{z}/{x}/{y}.pbf"
   */
  getTileUrlTemplate(chartId: string): Promise<string>;
}

declare module 'react-native' {
  interface NativeModulesStatic {
    LocalTileServer: LocalTileServerModule;
  }
}
