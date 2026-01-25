import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, Platform, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './src/config/firebase';

// Platform-specific imports
import ChartViewer from './src/components/ChartViewer';

// Only import Firebase-based components on native platforms
let LoginScreen: React.ComponentType<{ onLoginSuccess: () => void }> | null = null;
let MapSelectionScreen: React.ComponentType | null = null;
let DynamicChartViewer: React.ComponentType<{ onNavigateToDownloads?: () => void }> | null = null;
let SettingsScreen: React.ComponentType | null = null;
let crashlytics: any = null;

if (Platform.OS !== 'web') {
  LoginScreen = require('./src/screens/LoginScreen').default;
  MapSelectionScreen = require('./src/screens/MapSelectionScreen').default;
  DynamicChartViewer = require('./src/components/DynamicChartViewer.native').default;
  SettingsScreen = require('./src/screens/SettingsScreen').default;
  
  // Initialize Crashlytics for native platforms
  try {
    crashlytics = require('@react-native-firebase/crashlytics').default;
  } catch (e) {
    console.log('Crashlytics not available');
  }
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
    if (crashlytics) {
      crashlytics().recordError(error);
      crashlytics().log(`Component stack: ${errorInfo.componentStack}`);
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

// Tab icon component
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Charts: '📊',
    Viewer: '🗺️',
    Settings: '⚙️',
  };
  
  return (
    <Text style={{ fontSize: focused ? 26 : 24, opacity: focused ? 1 : 0.6 }}>
      {icons[name] || '📄'}
    </Text>
  );
}

// Wrapper components to handle navigation props
function ChartsTab() {
  if (!MapSelectionScreen) return null;
  return <MapSelectionScreen />;
}

function ViewerTab() {
  if (!DynamicChartViewer) return null;
  return <DynamicChartViewer />;
}

function SettingsTab() {
  if (!SettingsScreen) return null;
  return <SettingsScreen />;
}

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Initialize Crashlytics and listen for auth state changes
  useEffect(() => {
    // Enable Crashlytics collection (disabled by default in dev)
    if (crashlytics && !__DEV__) {
      crashlytics().setCrashlyticsCollectionEnabled(true);
    }

    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      setUser(authUser);
      setAuthLoading(false);

      // Set user ID in Crashlytics for crash attribution
      if (crashlytics && authUser) {
        crashlytics().setUserId(authUser.uid);
        crashlytics().setAttributes({
          email: authUser.email || '',
        });
        crashlytics().log(`User authenticated: ${authUser.email}`);
      }
    });
    return unsubscribe;
  }, []);

  // Web platform - use original ChartViewer only
  if (Platform.OS === 'web') {
    return (
      <SafeAreaProvider>
        <View style={styles.container}>
          <ChartViewer />
          <StatusBar style="light" />
        </View>
      </SafeAreaProvider>
    );
  }

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
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <TabIcon name={route.name} focused={focused} />
            ),
            tabBarActiveTintColor: '#007AFF',
            tabBarInactiveTintColor: '#8e8e93',
            tabBarStyle: {
              backgroundColor: '#fff',
              borderTopColor: '#e0e0e0',
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
            },
            // Let React Navigation handle safe area automatically
            tabBarHideOnKeyboard: true,
          })}
        >
          <Tab.Screen 
            name="Charts" 
            component={ChartsTab}
            options={{ tabBarLabel: 'Charts' }}
          />
          <Tab.Screen 
            name="Viewer" 
            component={ViewerTab}
            options={{ tabBarLabel: 'Viewer' }}
          />
          <Tab.Screen 
            name="Settings" 
            component={SettingsTab}
            options={{ tabBarLabel: 'Settings' }}
          />
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}

// Main App wrapper with ErrorBoundary
export default function App() {
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
