console.log('[App.tsx] Module loading started...');

import React, { useState, useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, Platform, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { FirebaseAuthTypes, getAuth, onAuthStateChanged } from '@react-native-firebase/auth';

console.log('[App.tsx] Core imports complete');

// Platform-specific imports
import { OverlayProvider, useOverlay } from './src/contexts/OverlayContext';
import { NavigationProvider, useContextNav } from './src/contexts/NavigationContext';
import { WaypointProvider } from './src/contexts/WaypointContext';
import { RouteProvider } from './src/contexts/RouteContext';

console.log('[App.tsx] Context imports complete');

// Only import Firebase-based components on native platforms
let LoginScreen: React.ComponentType<{ onLoginSuccess: () => void }> | null = null;
let DynamicChartViewer: React.ComponentType<{ onNavigateToDownloads?: () => void }> | null = null;
let WeatherScreen: React.ComponentType | null = null;
let MoreScreen: React.ComponentType | null = null;
let ContextScreen: React.ComponentType | null = null;
let CompassModal: React.ComponentType<{ visible: boolean; heading: number | null; course: number | null; showTideChart?: boolean; showCurrentChart?: boolean }> | null = null;
let HalfMoonCompass: React.ComponentType<{ heading: number | null; course: number | null; showTideChart?: boolean; showCurrentChart?: boolean }> | null = null;
let TickerTapeCompass: React.ComponentType<{ heading: number | null; course: number | null; showTideChart?: boolean; showCurrentChart?: boolean }> | null = null;
let MinimalCompass: React.ComponentType<{ heading: number | null; course: number | null; showTideChart?: boolean; showCurrentChart?: boolean }> | null = null;
let GPSInfoModal: React.ComponentType<{ visible: boolean; gpsData: any }> | null = null;
let MorePanel: React.ComponentType<{ visible: boolean; onClose: () => void; onCloseComplete?: () => void }> | null = null;
let RegionSelector: React.ComponentType<{ visible: boolean; onClose: () => void }> | null = null;
let WaypointCreationModal: React.ComponentType | null = null;

// Modular Crashlytics API (v22+ requires passing instance as first param)
let crashlyticsInstance: any = null;
let crashlyticsFns: {
  setCrashlyticsCollectionEnabled: (crashlytics: any, enabled: boolean) => void;
  setUserId: (crashlytics: any, userId: string) => void;
  setAttributes: (crashlytics: any, attributes: Record<string, string>) => void;
  log: (crashlytics: any, message: string) => void;
  recordError: (crashlytics: any, error: Error) => void;
} | null = null;

if (Platform.OS !== 'web') {
  console.log('[App.tsx] Loading native screens...');
  LoginScreen = require('./src/screens/LoginScreen').default;
  console.log('[App.tsx] LoginScreen loaded');
  DynamicChartViewer = require('./src/components/DynamicChartViewer.native').default;
  console.log('[App.tsx] DynamicChartViewer loaded');
  WeatherScreen = require('./src/screens/WeatherScreen').default;
  console.log('[App.tsx] WeatherScreen loaded');
  MoreScreen = require('./src/screens/MoreScreen').default;
  console.log('[App.tsx] MoreScreen loaded');
  ContextScreen = require('./src/screens/ContextScreen').default;
  console.log('[App.tsx] ContextScreen loaded');
  CompassModal = require('./src/components/CompassModal').default;
  console.log('[App.tsx] CompassModal loaded');
  HalfMoonCompass = require('./src/components/HalfMoonCompass').default;
  console.log('[App.tsx] HalfMoonCompass loaded');
  TickerTapeCompass = require('./src/components/TickerTapeCompass').default;
  console.log('[App.tsx] TickerTapeCompass loaded');
  MinimalCompass = require('./src/components/MinimalCompass').default;
  console.log('[App.tsx] MinimalCompass loaded');
  GPSInfoModal = require('./src/components/GPSInfoModal').default;
  console.log('[App.tsx] GPSInfoModal loaded');
  MorePanel = require('./src/components/MorePanel').default;
  console.log('[App.tsx] MorePanel loaded');
  RegionSelector = require('./src/components/RegionSelector').default;
  console.log('[App.tsx] RegionSelector loaded');
  WaypointCreationModal = require('./src/components/WaypointCreationModal').default;
  console.log('[App.tsx] WaypointCreationModal loaded');
  console.log('[App.tsx] All native screens loaded successfully');
  
  // Initialize Crashlytics for native platforms (modular API)
  try {
    console.log('[App.tsx] Initializing Crashlytics...');
    const rnfbCrashlytics = require('@react-native-firebase/crashlytics');
    crashlyticsInstance = rnfbCrashlytics.getCrashlytics();
    crashlyticsFns = {
      setCrashlyticsCollectionEnabled: rnfbCrashlytics.setCrashlyticsCollectionEnabled,
      setUserId: rnfbCrashlytics.setUserId,
      setAttributes: rnfbCrashlytics.setAttributes,
      log: rnfbCrashlytics.log,
      recordError: rnfbCrashlytics.recordError,
    };
    console.log('[App.tsx] Crashlytics initialized');
  } catch (e) {
    console.log('[App.tsx] Crashlytics not available');
  }
}

console.log('[App.tsx] Module loading complete');

// Error Boundary to catch JavaScript errors
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to Crashlytics
    if (crashlyticsFns && crashlyticsInstance) {
      crashlyticsFns.recordError(crashlyticsInstance, error);
      crashlyticsFns.log(crashlyticsInstance, `Component stack: ${errorInfo.componentStack}`);
    }
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Something went wrong</Text>
          <Text style={errorStyles.message}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Text>
          <TouchableOpacity style={errorStyles.button} onPress={this.handleRetry}>
            <Text style={errorStyles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a365d',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  message: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

const Tab = createBottomTabNavigator();

// Tab icon component - Professional vector icons with filled/outline states
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const { Ionicons } = require('@expo/vector-icons');
  
  const getIconName = (): string => {
    switch (name) {
      case 'Viewer':
        return focused ? 'map' : 'map-outline';
      case 'Weather':
        return focused ? 'rainy' : 'rainy-outline';
      case 'Context':
        return focused ? 'stats-chart' : 'stats-chart-outline';
      case 'More':
        return 'ellipsis-horizontal';
      default:
        return 'help-circle-outline';
    }
  };
  
  return (
    <Ionicons 
      name={getIconName()} 
      size={24} 
      color={focused ? '#1a1f2e' : 'rgba(255, 255, 255, 0.5)'} 
    />
  );
}

// Wrapper components to handle navigation props
function ViewerTab() {
  console.log('[ViewerTab] Rendering...');
  if (!DynamicChartViewer) return null;
  return <DynamicChartViewer />;
}

function WeatherTab() {
  console.log('[WeatherTab] Rendering...');
  if (!WeatherScreen) return null;
  return <WeatherScreen />;
}

function ContextTab() {
  console.log('[ContextTab] Rendering...');
  if (!ContextScreen) {
    console.log('[ContextTab] ContextScreen is null!');
    return null;
  }
  console.log('[ContextTab] Returning ContextScreen component');
  return <ContextScreen />;
}

function MoreTab() {
  console.log('[MoreTab] Rendering...');
  if (!MoreScreen) {
    console.log('[MoreTab] MoreScreen is null!');
    return null;
  }
  console.log('[MoreTab] Returning MoreScreen component');
  return <MoreScreen />;
}

// Renders overlays outside the navigation hierarchy to avoid MapLibre conflicts
function OverlayRenderer() {
  const { compassMode, showGPSPanel, showMorePanel, setShowMorePanel, showDownloads, setShowDownloads, showTideDetails, showCurrentDetails, showNavData, heading, course, gpsData, handleMorePanelClosed } = useOverlay();

  const compassProps = useMemo(() => ({
    heading,
    course,
    showTideChart: showTideDetails,
    showCurrentChart: showCurrentDetails,
    showNavData,
  }), [heading, course, showTideDetails, showCurrentDetails, showNavData]);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="box-none">
      {compassMode === 'full' && CompassModal && (
        <CompassModal visible={true} {...compassProps} />
      )}
      {compassMode === 'halfmoon' && HalfMoonCompass && (
        <HalfMoonCompass {...compassProps} />
      )}
      {compassMode === 'ticker' && TickerTapeCompass && (
        <TickerTapeCompass {...compassProps} />
      )}
      {compassMode === 'minimal' && MinimalCompass && (
        <MinimalCompass {...compassProps} />
      )}
      {GPSInfoModal && showGPSPanel && (
        <GPSInfoModal
          visible={true}
          gpsData={gpsData}
        />
      )}
      {MorePanel && (
        <MorePanel
          visible={showMorePanel}
          onClose={() => setShowMorePanel(false)}
          onCloseComplete={handleMorePanelClosed}
        />
      )}
      {RegionSelector && (
        <RegionSelector
          visible={showDownloads}
          onClose={() => setShowDownloads(false)}
        />
      )}
      {WaypointCreationModal && <WaypointCreationModal />}
    </View>
  );
}

function AppContent() {
  console.log('[AppContent] Initializing...');
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Initialize Crashlytics and listen for auth state changes
  useEffect(() => {
    console.log('[AppContent] useEffect running...');
    // Enable Crashlytics collection (disabled by default in dev)
    if (crashlyticsFns && crashlyticsInstance && !__DEV__) {
      crashlyticsFns.setCrashlyticsCollectionEnabled(crashlyticsInstance, true);
    }

    // Web platform doesn't use auth
    if (Platform.OS === 'web') {
      console.log('[AppContent] Web platform detected');
      setAuthLoading(false);
      return;
    }

    // Use native Firebase Auth listener with modular API
    const authInstance = getAuth();
    const unsubscribe = onAuthStateChanged(authInstance, (authUser: FirebaseAuthTypes.User | null) => {
      console.log('Auth state changed:', authUser ? `Logged in as ${authUser.email}` : 'Logged out');
      setUser(authUser);
      setAuthLoading(false);

      // Set user ID in Crashlytics for crash attribution
      if (crashlyticsFns && crashlyticsInstance && authUser) {
        crashlyticsFns.setUserId(crashlyticsInstance, authUser.uid);
        crashlyticsFns.setAttributes(crashlyticsInstance, {
          email: authUser.email || '',
        });
        crashlyticsFns.log(crashlyticsInstance, `User authenticated: ${authUser.email}`);
      }
    });
    return unsubscribe;
  }, []);

  // Show loading while checking auth
  if (authLoading) {
    console.log('[AppContent] Rendering loading state');
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  // Show login if not authenticated
  if (!user && LoginScreen) {
    console.log('[AppContent] Rendering login screen');
    return (
      <SafeAreaProvider>
        <LoginScreen onLoginSuccess={() => {}} />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  // Main app with tab navigation
  console.log('[AppContent] Rendering main app with user:', user?.email);
  console.log('[AppContent] About to render NavigationProvider...');
  return (
    <SafeAreaProvider>
      <NavigationProvider>
        <OverlayProvider>
          <WaypointProvider>
            <RouteProvider>
              <AppNavigator />
              {/* Overlays rendered OUTSIDE NavigationContainer to avoid MapLibre view conflicts */}
              <OverlayRenderer />
              <StatusBar style="light" />
            </RouteProvider>
          </WaypointProvider>
        </OverlayProvider>
      </NavigationProvider>
    </SafeAreaProvider>
  );
}

// Separate component to access NavigationContext
function AppNavigator() {
  console.log('[AppNavigator] Initializing...');
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const insets = useSafeAreaInsets();
  const { setNavigationRef, contextTabName } = useContextNav();
  const { toggleMorePanel } = useOverlay();
  
  // Store navigation ref for programmatic navigation
  useEffect(() => {
    if (navigationRef.current) {
      setNavigationRef(navigationRef.current);
    }
  }, [navigationRef.current, setNavigationRef]);
  
  return (
    <NavigationContainer ref={navigationRef}>
      <Tab.Navigator
        initialRouteName="Viewer"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon name={route.name} focused={focused} />
          ),
          tabBarActiveTintColor: '#1a1f2e',
          tabBarInactiveTintColor: 'rgba(255, 255, 255, 0.5)',
          tabBarActiveBackgroundColor: 'rgba(255, 255, 255, 0.75)', // Reduced brightness
          tabBarStyle: {
            backgroundColor: 'rgba(20, 25, 35, 0.92)',
            borderTopColor: 'rgba(255, 255, 255, 0.1)',
            borderTopWidth: 0.5,
            paddingBottom: insets.bottom,
            height: 56 + insets.bottom,
          },
          tabBarItemStyle: {
            marginHorizontal: 4,
            marginTop: 4,
            marginBottom: 4,
            borderRadius: 8,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
          },
          tabBarHideOnKeyboard: true,
        })}
      >
        <Tab.Screen 
          name="Viewer" 
          component={ViewerTab}
          options={{ tabBarLabel: 'Maps' }}
        />
        <Tab.Screen 
          name="Weather" 
          component={WeatherTab}
          options={{ tabBarLabel: 'Weather' }}
        />
        <Tab.Screen 
          name="Context" 
          component={ContextTab}
          options={{ tabBarLabel: contextTabName }}
        />
        <Tab.Screen 
          name="More" 
          component={MoreTab}
          options={{ tabBarLabel: 'More' }}
          listeners={{
            tabPress: (e) => {
              console.log('[AppNavigator] More tab pressed');
              // Prevent navigating to the More screen
              e.preventDefault();
              // Instead toggle the slide-out panel
              toggleMorePanel();
            },
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// Main App wrapper with ErrorBoundary
export default function App() {
  console.log('[App] Rendering App component...');
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a365d',
  },
  loadingText: {
    marginTop: 16,
    color: '#fff',
    fontSize: 16,
  },
});
