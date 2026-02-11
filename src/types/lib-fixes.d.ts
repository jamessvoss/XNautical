// Workaround for library type resolution issues
// Similar to react-native-fix.d.ts, these declarations fix type resolution
// problems with third-party libraries under Expo SDK 54's module resolution.

declare module 'react-native-safe-area-context' {
  import type { ComponentType } from 'react';
  export const SafeAreaView: ComponentType<any>;
  export const SafeAreaProvider: ComponentType<any>;
  export function useSafeAreaInsets(): {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

declare module 'react-native-webview' {
  import type { ComponentType } from 'react';
  const WebView: ComponentType<any>;
  export default WebView;
  export { WebView };
}

declare module '@maplibre/maplibre-react-native' {
  import type { ComponentType, RefObject } from 'react';
  export const MapView: ComponentType<any>;
  export const Camera: ComponentType<any>;
  export const ShapeSource: ComponentType<any>;
  export const LineLayer: ComponentType<any>;
  export const FillLayer: ComponentType<any>;
  export const SymbolLayer: ComponentType<any>;
  export const CircleLayer: ComponentType<any>;
  export const RasterLayer: ComponentType<any>;
  export const RasterSource: ComponentType<any>;
  export const Images: ComponentType<any>;
  export const MarkerView: ComponentType<any>;
  export const PointAnnotation: ComponentType<any>;
  export const Callout: ComponentType<any>;
  export const UserLocation: ComponentType<any>;
  export interface MapViewRef {
    getCenter: () => Promise<[number, number]>;
    getZoom: () => Promise<number>;
    getVisibleBounds: () => Promise<[[number, number], [number, number]]>;
    setCamera: (config: any) => void;
    flyTo: (coordinates: [number, number], duration?: number) => void;
  }
  export interface CameraRef {
    setCamera: (config: any) => void;
    flyTo: (coordinates: [number, number], duration?: number) => void;
    moveTo: (coordinates: [number, number], duration?: number) => void;
    zoomTo: (zoom: number, duration?: number) => void;
    fitBounds: (ne: [number, number], sw: [number, number], padding?: number | number[], duration?: number) => void;
  }
  export const VectorSource: ComponentType<any>;
  export const BackgroundLayer: ComponentType<any>;
  export const HeatmapLayer: ComponentType<any>;
  const MapLibre: {
    MapView: ComponentType<any>;
    Camera: ComponentType<any>;
    ShapeSource: ComponentType<any>;
    LineLayer: ComponentType<any>;
    FillLayer: ComponentType<any>;
    SymbolLayer: ComponentType<any>;
    CircleLayer: ComponentType<any>;
    RasterLayer: ComponentType<any>;
    RasterSource: ComponentType<any>;
    VectorSource: ComponentType<any>;
    Images: ComponentType<any>;
    MarkerView: ComponentType<any>;
    PointAnnotation: ComponentType<any>;
    Callout: ComponentType<any>;
    UserLocation: ComponentType<any>;
    BackgroundLayer: ComponentType<any>;
    HeatmapLayer: ComponentType<any>;
    setAccessToken: (token: string | null) => void;
    [key: string]: any;
  };
  export default MapLibre;
}
