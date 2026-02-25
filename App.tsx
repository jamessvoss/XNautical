import React, { useState, useEffect, useRef, useMemo, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, Platform, ActivityIndicator, TouchableOpacity, AppState, Modal } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { FirebaseAuthTypes, getAuth, onAuthStateChanged } from '@react-native-firebase/auth';

// Platform-specific imports
import { OverlayProvider, useOverlay } from './src/contexts/OverlayContext';
import { NavigationProvider, useContextNav } from './src/contexts/NavigationContext';
import { useDeviceHeading } from './src/hooks/useDeviceHeading';
import { WaypointProvider } from './src/contexts/WaypointContext';
import { RouteProvider } from './src/contexts/RouteContext';

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
  LoginScreen = require('./src/screens/LoginScreen').default;
  DynamicChartViewer = require('./src/components/DynamicChartViewer.native').default;
  WeatherScreen = require('./src/screens/WeatherScreen').default;
  MoreScreen = require('./src/screens/MoreScreen').default;
  ContextScreen = require('./src/screens/ContextScreen').default;
  CompassModal = require('./src/components/CompassModal').default;
  HalfMoonCompass = require('./src/components/HalfMoonCompass').default;
  TickerTapeCompass = require('./src/components/TickerTapeCompass').default;
  MinimalCompass = require('./src/components/MinimalCompass').default;
  GPSInfoModal = require('./src/components/GPSInfoModal').default;
  MorePanel = require('./src/components/MorePanel').default;
  RegionSelector = require('./src/components/RegionSelector').default;
  WaypointCreationModal = require('./src/components/WaypointCreationModal').default;

  // Initialize Crashlytics for native platforms (modular API)
  try {
    const rnfbCrashlytics = require('@react-native-firebase/crashlytics');
    crashlyticsInstance = rnfbCrashlytics.getCrashlytics();
    crashlyticsFns = {
      setCrashlyticsCollectionEnabled: rnfbCrashlytics.setCrashlyticsCollectionEnabled,
      setUserId: rnfbCrashlytics.setUserId,
      setAttributes: rnfbCrashlytics.setAttributes,
      log: rnfbCrashlytics.log,
      recordError: rnfbCrashlytics.recordError,
    };
  } catch (e) {
    // Crashlytics not available
  }

  console.log(`[App] Loaded 13 native screens, Crashlytics: ${crashlyticsInstance ? 'yes' : 'no'}`);
}

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
  const { setShowDownloads } = useOverlay();
  const onNavigateToDownloads = useCallback(() => setShowDownloads(true), [setShowDownloads]);
  if (!DynamicChartViewer) return null;
  return <DynamicChartViewer onNavigateToDownloads={onNavigateToDownloads} />;
}

function WeatherTab() {
  if (!WeatherScreen) return null;
  return <WeatherScreen />;
}

function ContextTab() {
  if (!ContextScreen) return null;
  return <ContextScreen />;
}

function MoreTab() {
  if (!MoreScreen) return null;
  return <MoreScreen />;
}

// Renders overlays outside the navigation hierarchy to avoid MapLibre conflicts
function OverlayRenderer() {
  const { compassMode, showGPSPanel, showMorePanel, setShowMorePanel, showDownloads, setShowDownloads, showTideDetails, showCurrentDetails, showNavData, course, gpsData, handleMorePanelClosed } = useOverlay();

  // Device heading lives HERE (not in OverlayContext) so 60Hz updates only
  // re-render this overlay tree — not the entire app including MapLibre.
  const showCompass = compassMode !== 'off';
  const { heading: fusedHeading } = useDeviceHeading({
    enabled: showCompass,
    updateInterval: 16,    // 60Hz
    lerpFactor: 0.2,       // Smooth but responsive
  });

  const heading = fusedHeading ?? gpsData?.heading ?? null;

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
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [pausedDownloadsCount, setPausedDownloadsCount] = useState(0);

  // Initialize download manager and restore state
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const initDownloadManager = async () => {
      try {
        const { downloadManager } = await import('./src/services/downloadManager');
        await downloadManager.loadState();
        const incomplete = await downloadManager.getIncompleteDownloads();
        
        if (incomplete.length > 0) {
          console.log(`[App] Found ${incomplete.length} incomplete downloads`);
        }
      } catch (error) {
        console.error('[App] Error initializing download manager:', error);
      }
    };

    initDownloadManager();
  }, []);

  // Monitor app state for background/foreground transitions
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'background') {
        // App is going to background - pause all downloads
        try {
          const { downloadManager } = await import('./src/services/downloadManager');
          await downloadManager.pauseAll();
          console.log('[App] Paused all downloads - app backgrounded');
        } catch (error) {
          console.error('[App] Error pausing downloads:', error);
        }
      } else if (nextAppState === 'active') {
        // App returned to foreground - check for paused downloads
        try {
          const { downloadManager } = await import('./src/services/downloadManager');
          const paused = await downloadManager.getPausedDownloads();
          
          if (paused.length > 0) {
            console.log(`[App] Found ${paused.length} paused downloads`);
            setPausedDownloadsCount(paused.length);
            setShowResumeDialog(true);
          }
        } catch (error) {
          console.error('[App] Error checking paused downloads:', error);
        }
      }
    });
    
    return () => subscription.remove();
  }, []);

  // Initialize Crashlytics and listen for auth state changes
  useEffect(() => {
    // Enable Crashlytics collection (disabled by default in dev)
    if (crashlyticsFns && crashlyticsInstance && !__DEV__) {
      crashlyticsFns.setCrashlyticsCollectionEnabled(crashlyticsInstance, true);
    }

    // Web platform doesn't use auth
    if (Platform.OS === 'web') {
      setAuthLoading(false);
      return;
    }

    // Use native Firebase Auth listener with modular API
    const authInstance = getAuth();
    const unsubscribe = onAuthStateChanged(authInstance, (authUser: FirebaseAuthTypes.User | null) => {
      if (authUser) console.log(`Auth: ${authUser.email}`);
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

  const handleResumeAll = async () => {
    try {
      const { downloadManager } = await import('./src/services/downloadManager');
      await downloadManager.resumeAll();
      setShowResumeDialog(false);
      setPausedDownloadsCount(0);
    } catch (error) {
      console.error('[App] Error resuming downloads:', error);
    }
  };

  const handleDismissResume = () => {
    setShowResumeDialog(false);
  };

  // Show loading while checking auth
  if (authLoading) {
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
    return (
      <SafeAreaProvider>
        <LoginScreen onLoginSuccess={() => {}} />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  // Main app with tab navigation
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
              
              {/* Resume downloads dialog */}
              {showResumeDialog && (
                <Modal
                  transparent
                  visible={showResumeDialog}
                  animationType="fade"
                  onRequestClose={handleDismissResume}
                >
                  <View style={styles.modalOverlay}>
                    <View style={styles.resumeDialog}>
                      <Text style={styles.resumeTitle}>Resume Downloads?</Text>
                      <Text style={styles.resumeMessage}>
                        You have {pausedDownloadsCount} paused download{pausedDownloadsCount !== 1 ? 's' : ''}.
                      </Text>
                      <View style={styles.resumeButtons}>
                        <TouchableOpacity
                          style={[styles.resumeButton, styles.resumeButtonSecondary]}
                          onPress={handleDismissResume}
                        >
                          <Text style={styles.resumeButtonTextSecondary}>Later</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.resumeButton, styles.resumeButtonPrimary]}
                          onPress={handleResumeAll}
                        >
                          <Text style={styles.resumeButtonTextPrimary}>Resume All</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </Modal>
              )}
            </RouteProvider>
          </WaypointProvider>
        </OverlayProvider>
      </NavigationProvider>
    </SafeAreaProvider>
  );
}

// Separate component to access NavigationContext
function AppNavigator() {
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const insets = useSafeAreaInsets();
  const { setNavigationRef, contextTabName } = useContextNav();
  const { toggleMorePanel } = useOverlay();
  
  // Store navigation ref for programmatic navigation.
  // Run once on mount — NavigationContainer sets the ref synchronously during render,
  // so it's available by the time this effect runs.
  useEffect(() => {
    if (navigationRef.current) {
      setNavigationRef(navigationRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
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

// TEMP: Tile test screen for debugging — bypasses all app infrastructure
const TileTestScreen = require('./src/screens/TileTestScreen').default;

// Main App wrapper with ErrorBoundary
export default function App() {
  // TEMP: uncomment to use test screen instead of full app
  // return <TileTestScreen />;
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  resumeDialog: {
    backgroundColor: '#1a1f2e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  resumeTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  resumeMessage: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 24,
  },
  resumeButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  resumeButton: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeButtonPrimary: {
    backgroundColor: '#4FC3F7',
  },
  resumeButtonSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  resumeButtonTextPrimary: {
    color: '#0a0e1a',
    fontSize: 16,
    fontWeight: '600',
  },
  resumeButtonTextSecondary: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
