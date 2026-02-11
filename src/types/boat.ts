/**
 * Boat Performance Data Types
 * 
 * Type definitions for boat information, engines, performance data,
 * fuel system, insurance, and maintenance tracking.
 */

export type EngineManufacturer = 
  | 'Yamaha'
  | 'Mercury'
  | 'Suzuki'
  | 'Honda'
  | 'Evinrude'
  | 'Johnson'
  | 'Volvo Penta'
  | 'MerCruiser'
  | 'Other';

export type FuelType = 'gasoline' | 'diesel' | 'other';

export type CapacityUnit = 'gallons' | 'liters';

export type MaintenanceType = 
  | 'oil'
  | 'lower_unit'
  | 'hull'
  | 'zincs'
  | 'through_hulls'
  | 'propeller'
  | 'other';

export type StorageType = 'cloud' | 'local' | 'both';

/**
 * Performance point representing RPM, speed, and fuel consumption
 */
export interface PerformancePoint {
  rpm: number;
  speed: number; // knots or mph
  fuelConsumption: number; // gallons per hour
  notes?: string;
}

/**
 * Maintenance record for tracking service history
 */
export interface MaintenanceRecord {
  id: string;
  type: MaintenanceType;
  date: string; // ISO 8601 format
  engineHours?: number;
  description: string;
  cost?: number;
  performedBy?: string;
  nextDueDate?: string; // ISO 8601 format
  nextDueHours?: number;
}

/**
 * Engine information and performance data
 */
export interface Engine {
  id: string;
  position: number; // 1-5
  manufacturer: EngineManufacturer;
  customManufacturer?: string; // For "Other" manufacturer
  model: string;
  horsepower: number;
  serialNumber: string;
  hours: number;
  
  // Performance data
  performanceData: PerformancePoint[];
  
  // Maintenance tracking
  lastOilChange?: MaintenanceRecord;
  lastLowerUnitService?: MaintenanceRecord;
  nextServiceDue?: number; // hours
}

/**
 * Fuel system configuration
 */
export interface FuelSystem {
  totalCapacity: number;
  capacityUnit: CapacityUnit;
  fuelType: FuelType;
  reserveLevel: number; // percentage (0-100)
  numberOfTanks: number;
}

/**
 * Insurance information
 */
export interface InsuranceInfo {
  provider?: string;
  policyNumber?: string;
  expirationDate?: string; // ISO 8601 format
  coverageAmount?: number;
  notes?: string;
}

/**
 * Boat photo with local and remote URIs
 */
export interface BoatPhoto {
  id: string;
  localUri?: string;
  remoteUrl?: string;
  uploaded: boolean;
  takenAt: string; // ISO 8601 format
}

/**
 * Main boat interface
 */
export interface Boat {
  id: string;
  name: string;
  
  // Core identification
  registration: string;
  hullIdNumber: string;
  
  // Basic information (optional)
  year?: number;
  manufacturer?: string;
  model?: string;
  
  // Dimensions (optional)
  lengthOverall?: number; // feet
  beam?: number; // feet
  draft?: number; // feet
  displacement?: number; // pounds
  homeport?: string;
  
  // Engines
  engines: Engine[];
  
  // Fuel system
  fuelSystem: FuelSystem;
  
  // Insurance & documentation
  insurance: InsuranceInfo;
  
  // Maintenance history
  maintenanceLog: MaintenanceRecord[];
  
  // Performance data (boat-level, not per-engine)
  performanceData: PerformancePoint[];
  
  // Photos
  photos: BoatPhoto[];
  
  // Storage configuration
  storageType: StorageType;
  
  // Metadata
  createdAt: string; // ISO 8601 format
  updatedAt: string; // ISO 8601 format
}

/**
 * Default values for new boat
 */
export const createDefaultBoat = (name: string = 'My Boat'): Boat => ({
  id: `boat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  name,
  registration: '',
  hullIdNumber: '',
  engines: [],
  performanceData: [],
  fuelSystem: {
    totalCapacity: 0,
    capacityUnit: 'gallons',
    fuelType: 'gasoline',
    reserveLevel: 25,
    numberOfTanks: 1,
  },
  insurance: {},
  maintenanceLog: [],
  photos: [],
  storageType: 'both', // Always store both locally and in cloud
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/**
 * Default values for new engine
 */
export const createDefaultEngine = (position: number): Engine => ({
  id: `engine_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  position,
  manufacturer: 'Yamaha',
  model: '',
  horsepower: 0,
  serialNumber: '',
  hours: 0,
  performanceData: [],
});

/**
 * Default performance data points (common RPM values)
 */
export const getDefaultPerformanceRPMs = (): number[] => [
  0, // Idle
  500,
  1000,
  1500,
  2000,
  2500,
  3000,
  3500,
  4000,
  4500,
  5000,
  5500,
  6000,
];

/**
 * Create a new maintenance record
 */
export const createMaintenanceRecord = (
  type: MaintenanceType,
  description: string,
  engineHours?: number
): MaintenanceRecord => ({
  id: `maint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  type,
  date: new Date().toISOString(),
  engineHours,
  description,
});
