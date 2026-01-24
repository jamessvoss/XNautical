import { StatusBar } from 'expo-status-bar';
import { StyleSheet, SafeAreaView } from 'react-native';
// React Native automatically resolves to:
// - ChartViewer.native.tsx on iOS/Android (uses Mapbox)
// - ChartViewer.web.tsx on Web (uses Leaflet)
import ChartViewer from './src/components/ChartViewer';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <ChartViewer />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
