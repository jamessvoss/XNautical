/**
 * BoatPerformanceScreen
 * 
 * Main screen for managing boat information, engines, performance data,
 * fuel system, insurance, and maintenance tracking.
 * Supports multiple boats with a selector dropdown.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Boat,
  Engine,
  MaintenanceRecord,
  createDefaultBoat,
  createDefaultEngine,
  createMaintenanceRecord,
} from '../types/boat';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeToCloudBoats,
  getLocalBoats,
  saveBoat,
  deleteBoat,
  saveEngine,
  deleteEngine as deleteEngineFromBoat,
  addMaintenanceRecord,
} from '../services/boatStorageService';
import BoatDetailsModal from '../components/BoatDetailsModal';
import EngineDetailsModal from '../components/EngineDetailsModal';

type TabId = 'details' | 'engines' | 'performance' | 'fuel' | 'insurance' | 'maintenance';

interface Tab {
  id: TabId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const TABS: Tab[] = [
  { id: 'details', label: 'Boat Details', icon: 'boat' },
  { id: 'engines', label: 'Engines', icon: 'hardware-chip' },
  { id: 'performance', label: 'Performance', icon: 'speedometer' },
  { id: 'fuel', label: 'Fuel System', icon: 'water' },
  { id: 'insurance', label: 'Insurance', icon: 'shield-checkmark' },
  { id: 'maintenance', label: 'Maintenance', icon: 'construct' },
];

export default function BoatPerformanceScreen() {
  const { currentUser } = useAuth();
  const [boats, setBoats] = useState<Boat[]>([]);
  const [selectedBoatId, setSelectedBoatId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [loading, setLoading] = useState(true);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [editingEngine, setEditingEngine] = useState<Engine | null>(null);
  const [newEnginePosition, setNewEnginePosition] = useState(1);

  // Load boats on mount
  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    // Load local boats immediately
    getLocalBoats().then((localBoats) => {
      setBoats(localBoats);
      if (localBoats.length > 0 && !selectedBoatId) {
        setSelectedBoatId(localBoats[0].id);
      }
      setLoading(false);
    });

    // Subscribe to cloud boats
    const unsubscribe = subscribeToCloudBoats(
      currentUser.uid,
      (cloudBoats) => {
        // Merge with local boats (avoid duplicates)
        getLocalBoats().then((localBoats) => {
          const allBoats = [...cloudBoats];
          localBoats.forEach((localBoat) => {
            if (!allBoats.find(b => b.id === localBoat.id)) {
              allBoats.push(localBoat);
            }
          });
          setBoats(allBoats);
          if (allBoats.length > 0 && !selectedBoatId) {
            setSelectedBoatId(allBoats[0].id);
          }
        });
      },
      (error) => {
        console.error('[BoatPerformanceScreen] Cloud sync error:', error);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  const selectedBoat = boats.find(b => b.id === selectedBoatId);

  const handleAddBoat = useCallback(() => {
    if (!currentUser) {
      Alert.alert('Not Logged In', 'Please log in to add a boat.');
      return;
    }

    Alert.prompt(
      'New Boat',
      'Enter boat name:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Create',
          onPress: async (name) => {
            if (!name || name.trim().length === 0) {
              Alert.alert('Invalid Name', 'Please enter a boat name.');
              return;
            }

            const newBoat = createDefaultBoat(name.trim());
            try {
              await saveBoat(currentUser.uid, newBoat);
              setSelectedBoatId(newBoat.id);
              Alert.alert('Success', `${name} has been created!`);
            } catch (error) {
              console.error('[BoatPerformanceScreen] Error creating boat:', error);
              Alert.alert('Error', 'Failed to create boat. Please try again.');
            }
          },
        },
      ],
      'plain-text'
    );
  }, [currentUser]);

  const handleDeleteBoat = useCallback(() => {
    if (!currentUser || !selectedBoat) return;

    Alert.alert(
      'Delete Boat',
      `Are you sure you want to delete "${selectedBoat.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBoat(currentUser.uid, selectedBoat);
              
              // Select another boat or clear selection
              const remainingBoats = boats.filter(b => b.id !== selectedBoat.id);
              if (remainingBoats.length > 0) {
                setSelectedBoatId(remainingBoats[0].id);
              } else {
                setSelectedBoatId(null);
              }
              
              Alert.alert('Success', `${selectedBoat.name} has been deleted.`);
            } catch (error) {
              console.error('[BoatPerformanceScreen] Error deleting boat:', error);
              Alert.alert('Error', 'Failed to delete boat. Please try again.');
            }
          },
        },
      ]
    );
  }, [currentUser, selectedBoat, boats]);

  const handleAddEngine = useCallback(() => {
    if (!selectedBoat) return;

    if (selectedBoat.engines.length >= 5) {
      Alert.alert('Maximum Engines', 'You can add up to 5 engines per boat.');
      return;
    }

    const nextPosition = selectedBoat.engines.length + 1;
    setNewEnginePosition(nextPosition);
    setEditingEngine(null);
    setShowEngineModal(true);
  }, [selectedBoat]);

  const handleEditEngine = useCallback((engine: Engine) => {
    setEditingEngine(engine);
    setNewEnginePosition(engine.position);
    setShowEngineModal(true);
  }, []);

  const handleSaveEngine = useCallback(async (engine: Engine) => {
    if (!currentUser || !selectedBoat) return;

    try {
      await saveEngine(currentUser.uid, selectedBoat, engine);
      // Refresh boats
      const updatedBoats = await getLocalBoats();
      setBoats(updatedBoats);
    } catch (error) {
      console.error('[BoatPerformanceScreen] Error saving engine:', error);
      Alert.alert('Error', 'Failed to save engine. Please try again.');
    }
  }, [currentUser, selectedBoat]);

  const handleDeleteEngine = useCallback((engineId: string) => {
    if (!currentUser || !selectedBoat) return;

    Alert.alert(
      'Delete Engine',
      'Are you sure you want to delete this engine?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEngineFromBoat(currentUser.uid, selectedBoat, engineId);
              const updatedBoats = await getLocalBoats();
              setBoats(updatedBoats);
            } catch (error) {
              console.error('[BoatPerformanceScreen] Error deleting engine:', error);
              Alert.alert('Error', 'Failed to delete engine. Please try again.');
            }
          },
        },
      ]
    );
  }, [currentUser, selectedBoat]);

  const renderEnginesTab = () => {
    if (!selectedBoat) return null;

    return (
      <View style={styles.tabContainer}>
        <View style={styles.tabHeader}>
          <Text style={styles.tabTitle}>Engines</Text>
          <TouchableOpacity style={styles.addButton} onPress={handleAddEngine}>
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {selectedBoat.engines.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="hardware-chip-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
            <Text style={styles.emptyStateText}>No Engines</Text>
            <Text style={styles.emptyStateSubtext}>Add an engine to get started</Text>
          </View>
        ) : (
          <ScrollView style={styles.listContainer}>
            {selectedBoat.engines.map((engine) => (
              <TouchableOpacity
                key={engine.id}
                style={styles.card}
                onPress={() => handleEditEngine(engine)}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleRow}>
                    <Ionicons name="hardware-chip" size={24} color="#4FC3F7" />
                    <Text style={styles.cardTitle}>
                      Engine {engine.position} - {engine.manufacturer === 'Other' 
                        ? engine.customManufacturer 
                        : engine.manufacturer} {engine.model}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDeleteEngine(engine.id)}
                    style={styles.deleteButton}
                  >
                    <Ionicons name="trash-outline" size={20} color="#FF6B6B" />
                  </TouchableOpacity>
                </View>
                <View style={styles.cardContent}>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Horsepower:</Text>
                    <Text style={styles.statValue}>{engine.horsepower} HP</Text>
                  </View>
                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Hours:</Text>
                    <Text style={styles.statValue}>{engine.hours}</Text>
                  </View>
                  {engine.serialNumber && (
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>Serial #:</Text>
                      <Text style={styles.statValue}>{engine.serialNumber}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    );
  };

  const renderFuelTab = () => {
    if (!selectedBoat || !currentUser) return null;

    const fuelSystem = selectedBoat.fuelSystem;

    return (
      <ScrollView style={styles.tabContainer}>
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>FUEL SYSTEM</Text>
          
          <Text style={styles.fieldLabel}>Total Capacity ({fuelSystem.capacityUnit})</Text>
          <TextInput
            style={styles.textInput}
            value={fuelSystem.totalCapacity.toString()}
            onChangeText={(value) => {
              const capacity = parseFloat(value) || 0;
              const updatedBoat = {
                ...selectedBoat,
                fuelSystem: { ...fuelSystem, totalCapacity: capacity },
              };
              saveBoat(currentUser.uid, updatedBoat).then(() => {
                setBoats(boats.map(b => b.id === selectedBoat.id ? updatedBoat : b));
              });
            }}
            keyboardType="decimal-pad"
            placeholder="300"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />

          <Text style={styles.fieldLabel}>Fuel Type</Text>
          <View style={styles.buttonGroup}>
            {['gasoline', 'diesel', 'other'].map((type) => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.optionButton,
                  fuelSystem.fuelType === type && styles.optionButtonActive,
                ]}
                onPress={() => {
                  const updatedBoat = {
                    ...selectedBoat,
                    fuelSystem: { ...fuelSystem, fuelType: type as any },
                  };
                  saveBoat(currentUser.uid, updatedBoat).then(() => {
                    setBoats(boats.map(b => b.id === selectedBoat.id ? updatedBoat : b));
                  });
                }}
              >
                <Text
                  style={[
                    styles.optionButtonText,
                    fuelSystem.fuelType === type && styles.optionButtonTextActive,
                  ]}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Reserve Level (%)</Text>
          <TextInput
            style={styles.textInput}
            value={fuelSystem.reserveLevel.toString()}
            onChangeText={(value) => {
              const level = parseFloat(value) || 25;
              const updatedBoat = {
                ...selectedBoat,
                fuelSystem: { ...fuelSystem, reserveLevel: level },
              };
              saveBoat(currentUser.uid, updatedBoat).then(() => {
                setBoats(boats.map(b => b.id === selectedBoat.id ? updatedBoat : b));
              });
            }}
            keyboardType="decimal-pad"
            placeholder="25"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
        </View>
      </ScrollView>
    );
  };

  const renderInsuranceTab = () => {
    if (!selectedBoat || !currentUser) return null;

    const insurance = selectedBoat.insurance;

    return (
      <ScrollView style={styles.tabContainer}>
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>INSURANCE & DOCUMENTATION</Text>
          
          <Text style={styles.fieldLabel}>Insurance Provider</Text>
          <TextInput
            style={styles.textInput}
            value={insurance.provider || ''}
            onChangeText={(value) => {
              const updatedBoat = {
                ...selectedBoat,
                insurance: { ...insurance, provider: value },
              };
              saveBoat(currentUser.uid, updatedBoat).then(() => {
                setBoats(boats.map(b => b.id === selectedBoat.id ? updatedBoat : b));
              });
            }}
            placeholder="State Farm"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />

          <Text style={styles.fieldLabel}>Policy Number</Text>
          <TextInput
            style={styles.textInput}
            value={insurance.policyNumber || ''}
            onChangeText={(value) => {
              const updatedBoat = {
                ...selectedBoat,
                insurance: { ...insurance, policyNumber: value },
              };
              saveBoat(currentUser.uid, updatedBoat).then(() => {
                setBoats(boats.map(b => b.id === selectedBoat.id ? updatedBoat : b));
              });
            }}
            placeholder="POL-123456"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />

          <Text style={styles.fieldLabel}>Coverage Amount</Text>
          <TextInput
            style={styles.textInput}
            value={insurance.coverageAmount?.toString() || ''}
            onChangeText={(value) => {
              const amount = parseFloat(value) || undefined;
              const updatedBoat = {
                ...selectedBoat,
                insurance: { ...insurance, coverageAmount: amount },
              };
              saveBoat(currentUser.uid, updatedBoat).then(() => {
                setBoats(boats.map(b => b.id === selectedBoat.id ? updatedBoat : b));
              });
            }}
            keyboardType="decimal-pad"
            placeholder="100000"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />

          <Text style={styles.fieldLabel}>Notes</Text>
          <TextInput
            style={[styles.textInput, styles.textInputMultiline]}
            value={insurance.notes || ''}
            onChangeText={(value) => {
              const updatedBoat = {
                ...selectedBoat,
                insurance: { ...insurance, notes: value },
              };
              saveBoat(currentUser.uid, updatedBoat).then(() => {
                setBoats(boats.map(b => b.id === selectedBoat.id ? updatedBoat : b));
              });
            }}
            placeholder="Additional insurance notes..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            multiline
            numberOfLines={4}
          />
        </View>
      </ScrollView>
    );
  };

  const renderMaintenanceTab = () => {
    if (!selectedBoat) return null;

    return (
      <View style={styles.tabContainer}>
        <View style={styles.tabHeader}>
          <Text style={styles.tabTitle}>Maintenance Log</Text>
        </View>

        {selectedBoat.maintenanceLog.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="construct-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
            <Text style={styles.emptyStateText}>No Maintenance Records</Text>
            <Text style={styles.emptyStateSubtext}>
              Track oil changes, lower unit service, and more
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.listContainer}>
            {selectedBoat.maintenanceLog.map((record) => (
              <View key={record.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{record.type.replace('_', ' ').toUpperCase()}</Text>
                  <Text style={styles.cardDate}>
                    {new Date(record.date).toLocaleDateString()}
                  </Text>
                </View>
                <Text style={styles.cardDescription}>{record.description}</Text>
                {record.engineHours && (
                  <Text style={styles.cardMeta}>Engine Hours: {record.engineHours}</Text>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    );
  };

  const renderPerformanceTab = () => {
    if (!selectedBoat) return null;

    return (
      <View style={styles.tabContainer}>
        <View style={styles.emptyState}>
          <Ionicons name="speedometer-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
          <Text style={styles.emptyStateText}>Performance Data</Text>
          <Text style={styles.emptyStateSubtext}>
            RPM, Speed, and Fuel Consumption tracking coming soon
          </Text>
        </View>
      </View>
    );
  };

  const renderTabContent = () => {
    if (!selectedBoat) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="boat-outline" size={64} color="rgba(255, 255, 255, 0.3)" />
          <Text style={styles.emptyStateText}>No boat selected</Text>
          <Text style={styles.emptyStateSubtext}>Add a boat to get started</Text>
        </View>
      );
    }

    switch (activeTab) {
      case 'details':
        return (
          <View style={styles.tabContainer}>
            <View style={styles.detailsCard}>
              <Text style={styles.cardTitle}>{selectedBoat.name}</Text>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Registration:</Text>
                <Text style={styles.detailValue}>{selectedBoat.registration || 'N/A'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Hull ID:</Text>
                <Text style={styles.detailValue}>{selectedBoat.hullIdNumber || 'N/A'}</Text>
              </View>
              {selectedBoat.manufacturer && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Manufacturer:</Text>
                  <Text style={styles.detailValue}>{selectedBoat.manufacturer}</Text>
                </View>
              )}
              {selectedBoat.model && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Model:</Text>
                  <Text style={styles.detailValue}>{selectedBoat.model}</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => setShowDetailsModal(true)}
              >
                <Ionicons name="create-outline" size={20} color="#fff" />
                <Text style={styles.editButtonText}>Edit Boat Details</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      
      case 'engines':
        return renderEnginesTab();
      
      case 'performance':
        return renderPerformanceTab();
      
      case 'fuel':
        return renderFuelTab();
      
      case 'insurance':
        return renderInsuranceTab();
      
      case 'maintenance':
        return renderMaintenanceTab();
      
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4FC3F7" />
          <Text style={styles.loadingText}>Loading boats...</Text>
        </View>
      </View>
    );
  }

  if (boats.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Ionicons name="boat-outline" size={80} color="rgba(255, 255, 255, 0.3)" />
          <Text style={styles.emptyStateText}>No Boats Yet</Text>
          <Text style={styles.emptyStateSubtext}>
            Add your first boat to track performance, maintenance, and more
          </Text>
          <TouchableOpacity style={styles.addButtonLarge} onPress={handleAddBoat}>
            <Ionicons name="add" size={24} color="#fff" />
            <Text style={styles.addButtonText}>Add Your First Boat</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Boat selector header */}
      <View style={styles.header}>
        <View style={styles.boatSelector}>
          <TouchableOpacity
            style={styles.boatSelectorButton}
            onPress={() => {
              if (boats.length === 1) {
                Alert.alert('Info', 'You only have one boat. Add more boats to switch between them.');
                return;
              }
              
              // Show boat selection alert
              Alert.alert(
                'Select Boat',
                'Choose a boat:',
                [
                  ...boats.map(boat => ({
                    text: boat.name,
                    onPress: () => setSelectedBoatId(boat.id),
                  })),
                  { text: 'Cancel', style: 'cancel' },
                ]
              );
            }}
          >
            <Ionicons name="boat" size={20} color="#4FC3F7" />
            <Text style={styles.boatSelectorText} numberOfLines={1}>
              {selectedBoat?.name || 'Select Boat'}
            </Text>
            <Ionicons name="chevron-down" size={20} color="rgba(255, 255, 255, 0.5)" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerButton} onPress={handleAddBoat}>
            <Ionicons name="add" size={24} color="#4FC3F7" />
          </TouchableOpacity>
          {selectedBoat && (
            <TouchableOpacity style={styles.headerButton} onPress={handleDeleteBoat}>
              <Ionicons name="trash-outline" size={22} color="#FF6B6B" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tab navigation */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.id)}
            >
              <Ionicons
                name={tab.icon}
                size={20}
                color={isActive ? '#4FC3F7' : 'rgba(255, 255, 255, 0.5)'}
              />
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Tab content */}
      <ScrollView style={styles.contentContainer}>
        {renderTabContent()}
      </ScrollView>

      {/* Modals */}
      {selectedBoat && (
        <>
          <BoatDetailsModal
            visible={showDetailsModal}
            boat={selectedBoat}
            onClose={() => setShowDetailsModal(false)}
            onSave={(updatedBoat) => {
              setBoats(prevBoats =>
                prevBoats.map(b => b.id === updatedBoat.id ? updatedBoat : b)
              );
            }}
          />
          <EngineDetailsModal
            visible={showEngineModal}
            engine={editingEngine}
            position={newEnginePosition}
            onClose={() => {
              setShowEngineModal(false);
              setEditingEngine(null);
            }}
            onSave={handleSaveEngine}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1f2e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 24,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginBottom: 24,
  },
  addButtonLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4FC3F7',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    gap: 12,
  },
  boatSelector: {
    flex: 1,
  },
  boatSelectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 10,
  },
  boatSelectorText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  tabBarContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  tabActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(79, 195, 247, 0.3)',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  tabTextActive: {
    color: '#4FC3F7',
  },
  contentContainer: {
    flex: 1,
  },
  tabContainer: {
    flex: 1,
    padding: 16,
  },
  tabHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tabTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  addButton: {
    width: 40,
    height: 40,
    backgroundColor: '#4FC3F7',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    flex: 1,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    flex: 1,
  },
  deleteButton: {
    padding: 8,
  },
  cardContent: {
    gap: 8,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  cardDate: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  cardDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 8,
  },
  cardMeta: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 4,
  },
  detailsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  detailLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4FC3F7',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
    marginTop: 16,
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  formSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 6,
    marginTop: 12,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  textInputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
  },
  optionButtonActive: {
    backgroundColor: 'rgba(79, 195, 247, 0.15)',
    borderColor: '#4FC3F7',
  },
  optionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.5)',
  },
  optionButtonTextActive: {
    color: '#4FC3F7',
  },
});
