// Workaround for TS2305: Module '"react-native"' has no exported member
// This is a known issue with react-native 0.81 type definitions not being
// properly resolved by TypeScript's module resolution.
// See: https://github.com/expo/expo/issues/41790
//
// These declarations augment the react-native module to make its exports
// visible to TypeScript. The actual runtime types come from react-native itself.

export {};

declare module 'react-native' {
  import type {Component, ComponentType, ReactNode} from 'react';

  // Core components
  export const View: ComponentType<any>;
  export const Text: ComponentType<any>;
  export const Image: ComponentType<any>;
  export const ScrollView: ComponentType<any>;
  export const TextInput: ComponentType<any>;
  export const FlatList: ComponentType<any>;
  export const Switch: ComponentType<any>;
  export const Modal: ComponentType<any>;
  export const ActivityIndicator: ComponentType<any>;
  export const TouchableOpacity: ComponentType<any>;
  export const TouchableWithoutFeedback: ComponentType<any>;
  export const KeyboardAvoidingView: ComponentType<any>;
  export const StatusBar: ComponentType<any>;
  export const Picker: ComponentType<any>;

  // APIs
  export const StyleSheet: {
    create: <T extends Record<string, any>>(styles: T) => T;
    flatten: (...styles: any[]) => any;
    absoluteFill: any;
    absoluteFillObject: any;
    hairlineWidth: number;
  };
  export const Platform: {
    OS: 'ios' | 'android' | 'web';
    Version: number | string;
    select: <T>(specifics: {ios?: T; android?: T; web?: T; default?: T}) => T;
    isPad: boolean;
    isTV: boolean;
  };
  export const Dimensions: {
    get: (dim: 'window' | 'screen') => {width: number; height: number; scale: number; fontScale: number};
    addEventListener: (type: string, handler: any) => any;
    removeEventListener: (type: string, handler: any) => void;
  };
  export const Alert: {
    alert: (title: string, message?: string, buttons?: any[], options?: any) => void;
    prompt: (...args: any[]) => void;
  };
  export const Keyboard: {
    dismiss: () => void;
    addListener: (event: string, callback: any) => any;
    removeListener: (event: string, callback: any) => void;
    removeAllListeners: (event: string) => void;
  };
  export const InteractionManager: {
    runAfterInteractions: (task?: any) => {then: Function; done: Function; cancel: Function};
    createInteractionHandle: () => number;
    clearInteractionHandle: (handle: number) => void;
  };
  export const Share: {
    share: (content: any, options?: any) => Promise<any>;
  };
  export const PermissionsAndroid: any;
  export const NativeModules: {[key: string]: any};
  export const Animated: any;
  export const Easing: any;
  export const PanResponder: any;

  // Classes
  export class NativeEventEmitter {
    constructor(nativeModule?: any);
    addListener(eventType: string, listener: (...args: any[]) => any, context?: any): any;
    removeAllListeners(eventType: string): void;
    listenerCount(eventType: string): number;
  }

  // Types
  export interface GestureResponderEvent {
    nativeEvent: {
      changedTouches: any[];
      identifier: string;
      locationX: number;
      locationY: number;
      pageX: number;
      pageY: number;
      target: string;
      timestamp: number;
      touches: any[];
    };
  }
}
