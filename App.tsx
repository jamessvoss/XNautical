import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, Platform, ActivityIndicator } from 'react-native';
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

if (Platform.OS !== 'web') {
  LoginScreen = require('./src/screens/LoginScreen').default;
  MapSelectionScreen = require('./src/screens/MapSelectionScreen').default;
  DynamicChartViewer = require('./src/components/DynamicChartViewer.native').default;
  SettingsScreen = require('./src/screens/SettingsScreen').default;
}

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
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
