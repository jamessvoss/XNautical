// Override @react-native-community/slider types to fix JSX component compatibility
// with React 18+ types (TS2786: 'Slider' cannot be used as a JSX component)
declare module '@react-native-community/slider' {
  import { Component } from 'react';
  import {
    ViewProps,
    StyleProp,
    ViewStyle,
    ImageURISource,
  } from 'react-native';

  export interface SliderProps extends ViewProps {
    disabled?: boolean;
    maximumTrackTintColor?: string;
    maximumValue?: number;
    minimumTrackTintColor?: string;
    minimumValue?: number;
    step?: number;
    style?: StyleProp<ViewStyle>;
    value?: number;
    inverted?: boolean;
    tapToSeek?: boolean;
    thumbTintColor?: string;
    thumbImage?: ImageURISource;
    maximumTrackImage?: ImageURISource;
    minimumTrackImage?: ImageURISource;
    trackImage?: ImageURISource;
    vertical?: boolean;
    onSlidingStart?: (value: number) => void;
    onSlidingComplete?: (value: number) => void;
    onValueChange?: (value: number) => void;
  }

  export default class Slider extends Component<SliderProps> {}
}
