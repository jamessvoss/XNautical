/**
 * S-52 Theme Service
 * 
 * Implements IHO S-52 color standards for ECDIS displays.
 * Provides DAY, DUSK, and NIGHT color modes per the S-52 specification.
 * 
 * S-52 Color Design Principles:
 * - DAY: White/light background with dark foreground (optimized for bright sunlight)
 * - DUSK: Black background with light foreground (usable day or twilight)
 * - NIGHT: Very dim black background, strict luminance limits (preserves night vision)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// S-52 Display Modes
export type S52DisplayMode = 'day' | 'dusk' | 'night';

// S-52 Color Token Names (based on S-52 Presentation Library)
export type S52ColorToken = 
  // Depth zone colors
  | 'DEPDW'   // Deep water (deeper than safety contour)
  | 'DEPMD'   // Medium deep water
  | 'DEPMS'   // Medium shallow water
  | 'DEPVS'   // Very shallow water
  | 'DEPIT'   // Intertidal area
  // Land colors
  | 'LANDA'   // Land in general
  | 'LANDF'   // Land features (landmarks)
  | 'CHBRN'   // Built-up areas
  // Chart infrastructure
  | 'NODTA'   // No data area
  | 'CHBLK'   // Chart black (main lines)
  | 'CHGRD'   // Chart grid/graticule
  | 'CHGRF'   // Chart gray fill
  | 'CHWHT'   // Chart white
  | 'SNDG1'   // Soundings (safe depth)
  | 'SNDG2'   // Soundings (unsafe depth)
  // Aids to navigation
  | 'LITRD'   // Light red
  | 'LITGN'   // Light green
  | 'LITYW'   // Light yellow/white
  | 'RADHI'   // Radar high intensity
  | 'RADLO'   // Radar low intensity
  // Traffic/regulatory
  | 'TRFCD'   // Traffic control dominant
  | 'TRFCF'   // Traffic control faint
  | 'RESBL'   // Restricted area blue
  | 'RESGR'   // Restricted area gray
  // Danger highlighting
  | 'DNGHL'   // Danger highlight
  | 'CSTLN'   // Coastline
  // UI colors
  | 'UIBCK'   // UI background
  | 'UIBDR'   // UI border
  | 'UINFF'   // UI info faint
  | 'UINFD'   // UI info dominant (important)
  | 'APTS1'   // Attention point symbol 1
  | 'APTS2'   // Attention point symbol 2
  // Text colors
  | 'CHCOR'   // Chart correction (orange)
  | 'NINFO'   // Navigator info (orange)
  | 'APTS3'   // Attention point symbol 3
  // Water features
  | 'WATRW'   // Waterway
  // Road colors
  | 'ROADF'   // Road fill
  | 'ROADC'   // Road casing
  // Mariner data
  | 'MARINER' // Mariner's data
  | 'ROUTE'   // Route line
  | 'OWNSH'   // Own ship
  // Area fills
  | 'DRGARE'  // Dredged areas
  | 'FAIRWY'  // Fairways
  | 'CBLARE'  // Cable areas
  | 'PIPARE'  // Pipeline areas
  | 'CTNARE'  // Caution areas
  | 'MIPARE'  // Military practice areas
  | 'ACHARE'  // Anchorage areas
  | 'MARCUL'  // Marine farms/culture
  | 'TSSLPT'  // Traffic separation lane parts
  // Structures
  | 'BRGLN'   // Bridge line
  | 'BRGFL'   // Bridge fill
  | 'BUIFL'   // Building fill
  | 'MORLN'   // Mooring line
  | 'SLCLN'   // Shoreline construction line
  | 'SLCFL'   // Shoreline construction fill
  | 'CSWYL'   // Causeway line/fill
  | 'PONTN'   // Pontoon
  | 'HULKS'   // Hulks
  // Lines
  | 'NAVLN'   // Navigation lines
  | 'RECTR'   // Recommended tracks
  | 'TSELN'   // Traffic separation lines
  | 'LDELV'   // Land elevation contours
  | 'CABLN'   // Cable lines
  | 'PIPLN'   // Pipeline lines
  // Soundings/seabed
  | 'SNDCR'   // Sounding color (normal)
  | 'SBDFL'   // Seabed fill
  | 'SBDLN'   // Seabed outline
  | 'SBDTX'   // Seabed text
  // Text/labels
  | 'SENAM'   // Sea area names
  | 'LRGNT'   // Land region name text
  | 'DPCTX'   // Depth contour text
  | 'ACHBT'   // Anchor berth text
  | 'CBLTX'   // Cable text
  | 'PIPTX'   // Pipeline text
  | 'FOGSN'   // Fog signal
  | 'PILPT'   // Pile point
  | 'RSCST'   // Rescue station
  // Halos
  | 'HLCLR'   // Halo color (white in day, deep-water-bg in dusk/night)
  // Outlines
  | 'LNDOL'   // Land outline
  | 'DRGOL'   // Dredged area outline
  | 'FWYOL'   // Fairway outline
  | 'CTNOL'   // Caution area outline
  | 'MIPOL'   // Military area outline
  | 'ACHOL'   // Anchorage outline
  | 'MCUOL'   // Marine culture outline
  // GNIS categories
  | 'GNSWT'   // GNIS water names
  | 'GNSCL'   // GNIS coastal names
  | 'GNSLM'   // GNIS landmark names
  | 'GNSPP'   // GNIS populated place names
  | 'GNSST'   // GNIS stream names
  | 'GNSLK'   // GNIS lake names
  | 'GNSTR'   // GNIS terrain names
  // Stations
  | 'TIDTX'   // Tide station text
  | 'CURTX'   // Current station text
  | 'BUYTX';  // Live buoy text

// RGB Color type
interface RGBColor {
  r: number;
  g: number;
  b: number;
}

// S-52 Color Tables
// Values approximated from S-52 Presentation Library color specifications
// CIE coordinates converted to RGB for display use
const S52_COLOR_TABLES: Record<S52DisplayMode, Record<S52ColorToken, string>> = {
  // DAY mode - white/light backgrounds for bright sunlight viewing
  day: {
    // Depth zones (light backgrounds)
    DEPDW: '#FFFFFF',   // Deep water - white
    DEPMD: '#E6F0F5',   // Medium deep - pale blue
    DEPMS: '#C0D8E8',   // Medium shallow - light blue
    DEPVS: '#A0C8D8',   // Very shallow - cyan-blue
    DEPIT: '#A8D8C0',   // Intertidal - green-gray
    // Land
    LANDA: '#F0EDE9',   // Land - tan/beige
    LANDF: '#D4C4A8',   // Land features - darker tan
    CHBRN: '#E8D8C8',   // Built-up - light brown
    // Chart infrastructure
    NODTA: '#D0D0D0',   // No data - light gray
    CHBLK: '#000000',   // Chart black
    CHGRD: '#C8C8C8',   // Grid - light gray
    CHGRF: '#E0E0E0',   // Gray fill
    CHWHT: '#FFFFFF',   // White
    SNDG1: '#000000',   // Soundings safe - black
    SNDG2: '#000000',   // Soundings unsafe - black (bold)
    // Aids to navigation
    LITRD: '#FF0000',   // Red light
    LITGN: '#00AA00',   // Green light
    LITYW: '#FFD700',   // Yellow/white light
    RADHI: '#00FF00',   // Radar high
    RADLO: '#008800',   // Radar low
    // Traffic/regulatory
    TRFCD: '#C000C0',   // Traffic dominant - magenta
    TRFCF: '#E0C0E0',   // Traffic faint - pale magenta
    RESBL: '#8080FF',   // Restricted blue
    RESGR: '#A0A0A0',   // Restricted gray
    // Danger
    DNGHL: '#FF00FF',   // Danger highlight - magenta
    CSTLN: '#000000',   // Coastline - black
    // UI colors
    UIBCK: '#F5F5F5',   // UI background - near white
    UIBDR: '#C0C0C0',   // UI border - gray
    UINFF: '#808080',   // UI info faint
    UINFD: '#FF4040',   // UI info dominant - red
    APTS1: '#FF0000',   // Attention 1 - red
    APTS2: '#FF8000',   // Attention 2 - orange
    APTS3: '#FFFF00',   // Attention 3 - yellow
    // Text
    CHCOR: '#FF8000',   // Chart correction - orange
    NINFO: '#FF8000',   // Navigator info - orange
    // Water
    WATRW: '#A0CFE8',   // Waterway - blue
    // Roads
    ROADF: '#FFFFFF',   // Road fill - white
    ROADC: '#808080',   // Road casing - gray
    // Mariner
    MARINER: '#FF8000', // Mariner data - orange
    ROUTE: '#C00000',   // Route - dark red
    OWNSH: '#FF8000',   // Own ship - orange
    // Area fills
    DRGARE: '#87CEEB',  // Dredged areas - sky blue
    FAIRWY: '#E6E6FA',  // Fairways - lavender
    CBLARE: '#800080',  // Cable areas - purple
    PIPARE: '#008000',  // Pipeline areas - green
    CTNARE: '#FFD700',  // Caution areas - gold
    MIPARE: '#FF0000',  // Military areas - red
    ACHARE: '#4169E1',  // Anchorage - royal blue
    MARCUL: '#228B22',  // Marine farms - forest green
    TSSLPT: '#FF00FF',  // TSS lane parts - magenta
    // Structures
    BRGLN: '#696969',   // Bridge line - dim gray
    BRGFL: '#A9A9A9',   // Bridge fill - dark gray
    BUIFL: '#8B4513',   // Building fill - saddle brown
    MORLN: '#4B0082',   // Mooring line - indigo
    SLCLN: '#5C4033',   // Shoreline construction - dark brown
    SLCFL: '#808080',   // Shoreline construction fill - gray
    CSWYL: '#808080',   // Causeway - gray
    PONTN: '#808080',   // Pontoon fill - gray
    HULKS: '#696969',   // Hulks - dim gray
    // Lines
    NAVLN: '#FF00FF',   // Navigation lines - magenta
    RECTR: '#000000',   // Recommended tracks - black
    TSELN: '#FF00FF',   // Traffic separation lines - magenta
    LDELV: '#8B4513',   // Land elevation - saddle brown
    CABLN: '#800080',   // Cable lines - purple
    PIPLN: '#008000',   // Pipeline lines - green
    // Soundings/seabed
    SNDCR: '#000080',   // Sounding color - navy
    SBDFL: '#D2B48C',   // Seabed fill - tan
    SBDLN: '#6B4423',   // Seabed outline - brown
    SBDTX: '#6B4423',   // Seabed text - brown
    // Text/labels
    SENAM: '#4169E1',   // Sea area names - royal blue
    LRGNT: '#654321',   // Land region names - dark brown
    DPCTX: '#1E3A5F',   // Depth contour text - dark blue
    ACHBT: '#9400D3',   // Anchor berth text - dark violet
    CBLTX: '#800080',   // Cable text - purple
    PIPTX: '#006400',   // Pipeline text - dark green
    FOGSN: '#FF00FF',   // Fog signal - magenta
    PILPT: '#404040',   // Pile point - dark gray
    RSCST: '#FF0000',   // Rescue station - red
    // Halos
    HLCLR: '#FFFFFF',   // Halo - white (day mode)
    // Outlines
    LNDOL: '#8B7355',   // Land outline - tan
    DRGOL: '#4682B4',   // Dredged outline - steel blue
    FWYOL: '#9370DB',   // Fairway outline - medium purple
    CTNOL: '#FFA500',   // Caution outline - orange
    MIPOL: '#FF0000',   // Military outline - red
    ACHOL: '#9400D3',   // Anchorage outline - dark violet
    MCUOL: '#8B4513',   // Marine culture outline - saddle brown
    // GNIS
    GNSWT: '#0066CC',   // GNIS water - blue
    GNSCL: '#5D4037',   // GNIS coastal - brown
    GNSLM: '#666666',   // GNIS landmark - gray
    GNSPP: '#CC0000',   // GNIS populated - red
    GNSST: '#3399FF',   // GNIS stream - light blue
    GNSLK: '#66CCFF',   // GNIS lake - cyan
    GNSTR: '#999966',   // GNIS terrain - olive
    // Stations
    TIDTX: '#0066CC',   // Tide station text - blue
    CURTX: '#CC0066',   // Current station text - pink
    BUYTX: '#FF8C00',   // Live buoy text - dark orange
  },

  // DUSK mode - black backgrounds, usable day or twilight
  dusk: {
    // Depth zones — visible blue gradient on dark background (#1a1a2e)
    DEPDW: '#253050',   // Deep water - dark blue (clearly above bg)
    DEPMD: '#304068',   // Medium deep - medium-dark blue
    DEPMS: '#3C5580',   // Medium shallow - medium blue
    DEPVS: '#4A6A98',   // Very shallow - steel blue
    DEPIT: '#3A5A48',   // Intertidal - teal-green
    // Land
    LANDA: '#2A2820',   // Land - dark brown
    LANDF: '#3A3828',   // Land features - slightly lighter
    CHBRN: '#3A3530',   // Built-up - dark brown-gray
    // Chart infrastructure
    NODTA: '#252530',   // No data - dark gray
    CHBLK: '#E0E0E0',   // Chart lines - light gray (inverted)
    CHGRD: '#505060',   // Grid - medium gray
    CHGRF: '#353540',   // Gray fill
    CHWHT: '#E0E0E0',   // White (text, symbols)
    SNDG1: '#C0C0C0',   // Soundings safe - light gray
    SNDG2: '#FFFFFF',   // Soundings unsafe - white (bold)
    // Aids to navigation
    LITRD: '#FF4040',   // Red light - brighter for dark bg
    LITGN: '#40FF40',   // Green light
    LITYW: '#FFFF40',   // Yellow light
    RADHI: '#00FF00',   // Radar high
    RADLO: '#008800',   // Radar low
    // Traffic/regulatory
    TRFCD: '#FF80FF',   // Traffic dominant - light magenta
    TRFCF: '#804080',   // Traffic faint - dim magenta
    RESBL: '#6060C0',   // Restricted blue
    RESGR: '#606060',   // Restricted gray
    // Danger
    DNGHL: '#FF80FF',   // Danger highlight
    CSTLN: '#C0C080',   // Coastline - tan
    // UI colors
    UIBCK: '#1A1A25',   // UI background - very dark
    UIBDR: '#404050',   // UI border
    UINFF: '#606070',   // UI info faint
    UINFD: '#FF6060',   // UI info dominant
    APTS1: '#FF4040',   // Attention 1
    APTS2: '#FFA040',   // Attention 2
    APTS3: '#FFFF40',   // Attention 3
    // Text
    CHCOR: '#FFA040',   // Chart correction
    NINFO: '#FFA040',   // Navigator info
    // Water
    WATRW: '#4A6080',   // Waterway - dark blue
    // Roads
    ROADF: '#808080',   // Road fill - gray
    ROADC: '#404040',   // Road casing
    // Mariner
    MARINER: '#FFA040', // Mariner data
    ROUTE: '#FF4040',   // Route - red
    OWNSH: '#FFA040',   // Own ship
    // Area fills (dimmed for dark background)
    DRGARE: '#4A7A90',  // Dredged areas - muted sky blue
    FAIRWY: '#6A6A8A',  // Fairways - muted lavender
    CBLARE: '#704070',  // Cable areas - dim purple
    PIPARE: '#307030',  // Pipeline areas - dim green
    CTNARE: '#9A8030',  // Caution areas - dim gold
    MIPARE: '#903030',  // Military areas - dim red
    ACHARE: '#3A5090',  // Anchorage - dim royal blue
    MARCUL: '#2A6A2A',  // Marine farms - dim forest green
    TSSLPT: '#904090',  // TSS lane parts - dim magenta
    // Structures
    BRGLN: '#909090',   // Bridge line - lighter for dark bg
    BRGFL: '#707070',   // Bridge fill
    BUIFL: '#8A6040',   // Building fill - lighter brown
    MORLN: '#6A40A0',   // Mooring line - lighter indigo
    SLCLN: '#7A6050',   // Shoreline construction
    SLCFL: '#606060',   // Shoreline construction fill
    CSWYL: '#606060',   // Causeway
    PONTN: '#606060',   // Pontoon fill
    HULKS: '#808080',   // Hulks
    // Lines
    NAVLN: '#FF80FF',   // Navigation lines - bright magenta
    RECTR: '#C0C0C0',   // Recommended tracks - light gray
    TSELN: '#FF80FF',   // Traffic separation lines - bright magenta
    LDELV: '#8A6040',   // Land elevation - lighter brown
    CABLN: '#A060A0',   // Cable lines - lighter purple
    PIPLN: '#40A040',   // Pipeline lines - lighter green
    // Soundings/seabed
    SNDCR: '#6080C0',   // Sounding color - lighter for dark bg
    SBDFL: '#705838',   // Seabed fill - dim tan
    SBDLN: '#806040',   // Seabed outline
    SBDTX: '#A08060',   // Seabed text - lighter for readability
    // Text/labels
    SENAM: '#6090E0',   // Sea area names - brighter blue
    LRGNT: '#A08060',   // Land region names - lighter brown
    DPCTX: '#6090C0',   // Depth contour text - lighter blue
    ACHBT: '#B060FF',   // Anchor berth text - lighter violet
    CBLTX: '#A060A0',   // Cable text - lighter purple
    PIPTX: '#40A040',   // Pipeline text - lighter green
    FOGSN: '#FF80FF',   // Fog signal - bright magenta
    PILPT: '#808080',   // Pile point - lighter
    RSCST: '#FF6060',   // Rescue station - bright red
    // Halos
    HLCLR: '#253050',   // Halo - deep water bg (matches dusk DEPDW)
    // Outlines
    LNDOL: '#8A7050',   // Land outline
    DRGOL: '#5090B0',   // Dredged outline
    FWYOL: '#8070C0',   // Fairway outline
    CTNOL: '#C09030',   // Caution outline
    MIPOL: '#C04040',   // Military outline
    ACHOL: '#9060D0',   // Anchorage outline
    MCUOL: '#8A6040',   // Marine culture outline
    // GNIS (brighter for dark bg)
    GNSWT: '#4090E0',   // GNIS water
    GNSCL: '#907060',   // GNIS coastal
    GNSLM: '#909090',   // GNIS landmark
    GNSPP: '#E06060',   // GNIS populated
    GNSST: '#60B0FF',   // GNIS stream
    GNSLK: '#80D0FF',   // GNIS lake
    GNSTR: '#A0A070',   // GNIS terrain
    // Stations
    TIDTX: '#4090E0',   // Tide station text
    CURTX: '#E06090',   // Current station text
    BUYTX: '#FFA040',   // Live buoy text
  },

  // NIGHT mode - very dim, preserves night vision
  // Per S-52: maximum luminance of area color is 1.3 cd/sq.m
  night: {
    // Depth zones (dim but distinguishable gradient)
    DEPDW: '#121828',   // Deep water - very dark blue
    DEPMD: '#182038',   // Medium deep - dark blue
    DEPMS: '#202840',   // Medium shallow - slightly lighter
    DEPVS: '#283248',   // Very shallow - dim steel blue
    DEPIT: '#1C2818',   // Intertidal - dim green
    // Land
    LANDA: '#141410',   // Land - very dark
    LANDF: '#1C1C14',   // Land features
    CHBRN: '#1A1818',   // Built-up
    // Chart infrastructure
    NODTA: '#101014',   // No data
    CHBLK: '#606060',   // Chart lines - dim gray
    CHGRD: '#282830',   // Grid - very dim
    CHGRF: '#181820',   // Gray fill
    CHWHT: '#606060',   // White - dimmed
    SNDG1: '#505050',   // Soundings safe - dim
    SNDG2: '#707070',   // Soundings unsafe - slightly brighter
    // Aids to navigation (can be brighter - point sources)
    LITRD: '#800000',   // Red light - dim
    LITGN: '#008000',   // Green light - dim
    LITYW: '#806000',   // Yellow light - dim
    RADHI: '#004000',   // Radar high - dim
    RADLO: '#002000',   // Radar low - very dim
    // Traffic/regulatory
    TRFCD: '#602060',   // Traffic dominant - dim magenta
    TRFCF: '#301030',   // Traffic faint - very dim
    RESBL: '#303060',   // Restricted blue
    RESGR: '#303030',   // Restricted gray
    // Danger (can be slightly brighter for safety)
    DNGHL: '#803080',   // Danger highlight - dim magenta
    CSTLN: '#504830',   // Coastline - dim tan
    // UI colors (minimal light emission)
    UIBCK: '#0A0A0E',   // UI background - near black
    UIBDR: '#202028',   // UI border - very dim
    UINFF: '#303038',   // UI info faint
    UINFD: '#602020',   // UI info dominant - dim red
    APTS1: '#600000',   // Attention 1 - dim red
    APTS2: '#603000',   // Attention 2 - dim orange
    APTS3: '#606000',   // Attention 3 - dim yellow
    // Text
    CHCOR: '#603000',   // Chart correction
    NINFO: '#603000',   // Navigator info
    // Water
    WATRW: '#202838',   // Waterway - very dark blue
    // Roads
    ROADF: '#303030',   // Road fill
    ROADC: '#181818',   // Road casing
    // Mariner
    MARINER: '#603000', // Mariner data
    ROUTE: '#600000',   // Route - dim red
    OWNSH: '#803000',   // Own ship - dim orange
    // Area fills (severely dimmed for night vision)
    DRGARE: '#1A3038',  // Dredged areas
    FAIRWY: '#202030',  // Fairways
    CBLARE: '#281828',  // Cable areas
    PIPARE: '#102810',  // Pipeline areas
    CTNARE: '#302810',  // Caution areas
    MIPARE: '#301010',  // Military areas
    ACHARE: '#101830',  // Anchorage
    MARCUL: '#102010',  // Marine farms
    TSSLPT: '#281028',  // TSS lane parts
    // Structures
    BRGLN: '#404040',   // Bridge line
    BRGFL: '#303030',   // Bridge fill
    BUIFL: '#302010',   // Building fill
    MORLN: '#201830',   // Mooring line
    SLCLN: '#302820',   // Shoreline construction
    SLCFL: '#282828',   // Shoreline construction fill
    CSWYL: '#282828',   // Causeway
    PONTN: '#282828',   // Pontoon fill
    HULKS: '#303030',   // Hulks
    // Lines
    NAVLN: '#602060',   // Navigation lines
    RECTR: '#404040',   // Recommended tracks
    TSELN: '#602060',   // Traffic separation lines
    LDELV: '#302010',   // Land elevation
    CABLN: '#381838',   // Cable lines
    PIPLN: '#183818',   // Pipeline lines
    // Soundings/seabed
    SNDCR: '#203050',   // Sounding color
    SBDFL: '#282018',   // Seabed fill
    SBDLN: '#302820',   // Seabed outline
    SBDTX: '#403020',   // Seabed text
    // Text/labels
    SENAM: '#203060',   // Sea area names
    LRGNT: '#403020',   // Land region names
    DPCTX: '#203050',   // Depth contour text
    ACHBT: '#382050',   // Anchor berth text
    CBLTX: '#381838',   // Cable text
    PIPTX: '#183818',   // Pipeline text
    FOGSN: '#401040',   // Fog signal
    PILPT: '#303030',   // Pile point
    RSCST: '#602020',   // Rescue station
    // Halos
    HLCLR: '#0A0A10',   // Halo - near black (matches night background)
    // Outlines
    LNDOL: '#382818',   // Land outline
    DRGOL: '#203848',   // Dredged outline
    FWYOL: '#302848',   // Fairway outline
    CTNOL: '#483018',   // Caution outline
    MIPOL: '#481818',   // Military outline
    ACHOL: '#302048',   // Anchorage outline
    MCUOL: '#382010',   // Marine culture outline
    // GNIS (dim for night vision)
    GNSWT: '#183050',   // GNIS water
    GNSCL: '#382820',   // GNIS coastal
    GNSLM: '#303030',   // GNIS landmark
    GNSPP: '#502020',   // GNIS populated
    GNSST: '#204060',   // GNIS stream
    GNSLK: '#205060',   // GNIS lake
    GNSTR: '#383820',   // GNIS terrain
    // Stations
    TIDTX: '#183050',   // Tide station text
    CURTX: '#501830',   // Current station text
    BUYTX: '#603000',   // Live buoy text
  },
};

// UI Theme colors (for app interface elements)
export interface UITheme {
  // Backgrounds
  panelBackground: string;
  panelBackgroundSolid: string;
  cardBackground: string;
  overlayBackground: string;
  mapBackground: string;
  
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnAccent: string;
  
  // Borders and dividers
  border: string;
  divider: string;
  
  // Interactive elements
  buttonBackground: string;
  buttonBackgroundActive: string;
  buttonText: string;
  buttonTextActive: string;
  
  // Accents
  accentPrimary: string;
  accentSecondary: string;
  accentSuccess: string;
  accentWarning: string;
  accentDanger: string;
  
  // Tab bar
  tabBackground: string;
  tabBackgroundActive: string;
  tabText: string;
  tabTextActive: string;
  
  // Slider
  sliderTrack: string;
  sliderTrackActive: string;
  sliderThumb: string;
  
  // Status
  statusOnline: string;
  statusOffline: string;
  statusWarning: string;
}

// UI Theme definitions for each mode
const UI_THEMES: Record<S52DisplayMode, UITheme> = {
  day: {
    // Backgrounds - light
    panelBackground: 'rgba(255, 255, 255, 0.95)',
    panelBackgroundSolid: '#FFFFFF',
    cardBackground: '#F8F8F8',
    overlayBackground: 'rgba(255, 255, 255, 0.9)',
    mapBackground: '#F0F0F0',
    
    // Text - dark
    textPrimary: '#1A1A1A',
    textSecondary: '#4A4A4A',
    textMuted: '#808080',
    textOnAccent: '#FFFFFF',
    
    // Borders
    border: '#C0C0C0',
    divider: '#E0E0E0',
    
    // Interactive
    buttonBackground: '#E8E8E8',
    buttonBackgroundActive: '#007AFF',
    buttonText: '#333333',
    buttonTextActive: '#FFFFFF',
    
    // Accents
    accentPrimary: '#007AFF',
    accentSecondary: '#5856D6',
    accentSuccess: '#34C759',
    accentWarning: '#FF9500',
    accentDanger: '#FF3B30',
    
    // Tab bar
    tabBackground: 'rgba(0, 0, 0, 0.05)',
    tabBackgroundActive: 'rgba(0, 122, 255, 0.15)',
    tabText: '#666666',
    tabTextActive: '#007AFF',
    
    // Slider
    sliderTrack: '#D0D0D0',
    sliderTrackActive: '#007AFF',
    sliderThumb: '#007AFF',
    
    // Status
    statusOnline: '#34C759',
    statusOffline: '#8E8E93',
    statusWarning: '#FF9500',
  },

  dusk: {
    // Backgrounds - dark
    panelBackground: 'rgba(20, 25, 35, 0.95)',
    panelBackgroundSolid: '#1A1A25',
    cardBackground: '#252530',
    overlayBackground: 'rgba(20, 25, 35, 0.9)',
    mapBackground: '#1A1A2E',
    
    // Text - light
    textPrimary: '#E8E8F0',
    textSecondary: '#A0A0B0',
    textMuted: '#606070',
    textOnAccent: '#FFFFFF',
    
    // Borders
    border: '#404050',
    divider: '#303040',
    
    // Interactive
    buttonBackground: '#303040',
    buttonBackgroundActive: '#4FC3F7',
    buttonText: '#C0C0D0',
    buttonTextActive: '#FFFFFF',
    
    // Accents
    accentPrimary: '#4FC3F7',
    accentSecondary: '#7C4DFF',
    accentSuccess: '#69F0AE',
    accentWarning: '#FFB74D',
    accentDanger: '#FF5252',
    
    // Tab bar
    tabBackground: 'rgba(255, 255, 255, 0.05)',
    tabBackgroundActive: 'rgba(79, 195, 247, 0.2)',
    tabText: 'rgba(255, 255, 255, 0.6)',
    tabTextActive: '#4FC3F7',
    
    // Slider
    sliderTrack: 'rgba(255, 255, 255, 0.2)',
    sliderTrackActive: '#4FC3F7',
    sliderThumb: '#4FC3F7',
    
    // Status
    statusOnline: '#69F0AE',
    statusOffline: '#606070',
    statusWarning: '#FFB74D',
  },

  night: {
    // Backgrounds - very dark, minimal luminance
    panelBackground: 'rgba(10, 10, 14, 0.95)',
    panelBackgroundSolid: '#0A0A0E',
    cardBackground: '#101014',
    overlayBackground: 'rgba(10, 10, 14, 0.9)',
    mapBackground: '#0A0A10',
    
    // Text - dim
    textPrimary: '#606068',
    textSecondary: '#404048',
    textMuted: '#282830',
    textOnAccent: '#303030',
    
    // Borders
    border: '#202028',
    divider: '#181820',
    
    // Interactive
    buttonBackground: '#181820',
    buttonBackgroundActive: '#303850',
    buttonText: '#404048',
    buttonTextActive: '#506070',
    
    // Accents - very dim
    accentPrimary: '#304050',
    accentSecondary: '#302840',
    accentSuccess: '#203020',
    accentWarning: '#403020',
    accentDanger: '#402020',
    
    // Tab bar
    tabBackground: 'rgba(255, 255, 255, 0.02)',
    tabBackgroundActive: 'rgba(48, 64, 80, 0.3)',
    tabText: 'rgba(255, 255, 255, 0.2)',
    tabTextActive: '#405060',
    
    // Slider
    sliderTrack: 'rgba(255, 255, 255, 0.1)',
    sliderTrackActive: '#304050',
    sliderThumb: '#405060',
    
    // Status
    statusOnline: '#203020',
    statusOffline: '#181820',
    statusWarning: '#302818',
  },
};

// Storage key
const THEME_MODE_STORAGE_KEY = '@XNautical:themeMode';

// Current mode state
let currentMode: S52DisplayMode = 'dusk'; // Default to dusk (dark background)

// Listeners for mode changes
type ModeChangeListener = (mode: S52DisplayMode) => void;
const listeners: Set<ModeChangeListener> = new Set();

/**
 * Get a specific S-52 color for the current or specified mode
 */
export function getS52Color(token: S52ColorToken, mode?: S52DisplayMode): string {
  const effectiveMode = mode ?? currentMode;
  return S52_COLOR_TABLES[effectiveMode][token] ?? '#FF00FF'; // Magenta fallback for missing
}

/**
 * Get the entire UI theme for the current or specified mode
 */
export function getUITheme(mode?: S52DisplayMode): UITheme {
  const effectiveMode = mode ?? currentMode;
  return UI_THEMES[effectiveMode];
}

/**
 * Get the current display mode
 */
export function getCurrentMode(): S52DisplayMode {
  return currentMode;
}

/**
 * Set the display mode
 */
export async function setDisplayMode(mode: S52DisplayMode): Promise<void> {
  if (currentMode === mode) return;
  
  currentMode = mode;
  
  // Persist to storage
  try {
    await AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch (error) {
    console.warn('[ThemeService] Failed to persist theme mode:', error);
  }
  
  // Notify listeners
  listeners.forEach(listener => listener(mode));
}

/**
 * Load saved mode from storage
 */
export async function loadSavedMode(): Promise<S52DisplayMode> {
  try {
    const saved = await AsyncStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (saved && (saved === 'day' || saved === 'dusk' || saved === 'night')) {
      currentMode = saved;
    }
  } catch (error) {
    console.warn('[ThemeService] Failed to load saved theme mode:', error);
  }
  return currentMode;
}

/**
 * Subscribe to mode changes
 */
export function subscribeToModeChanges(listener: ModeChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Get all S-52 colors for a specific mode (for chart rendering)
 */
export function getS52ColorTable(mode?: S52DisplayMode): Record<S52ColorToken, string> {
  const effectiveMode = mode ?? currentMode;
  return { ...S52_COLOR_TABLES[effectiveMode] };
}

/**
 * ECDIS color overrides per display mode.
 * When ECDIS toggle is on, depth zones and land use IHO-standard blue depth shading.
 */
const ECDIS_OVERRIDES: Record<S52DisplayMode, Partial<Record<S52ColorToken, string>>> = {
  day: {
    DEPIT: '#D4E6C8',   // Intertidal - pale green
    DEPVS: '#C8E1F5',   // Very shallow - pale blue
    DEPMS: '#A0D0F0',   // Medium shallow - light blue
    DEPMD: '#6EB8E8',   // Medium deep - medium blue
    DEPDW: '#FFFFFF',   // Deep water - white
    LANDA: '#F0E9D2',   // Land - warm cream
  },
  dusk: {
    DEPIT: '#4A6848',   // Intertidal - muted green
    DEPVS: '#5A80A0',   // Very shallow - visible blue
    DEPMS: '#4A6888',   // Medium shallow - medium blue
    DEPMD: '#3A5070',   // Medium deep - darker blue
    DEPDW: '#2A3048',   // Deep water - dark blue-gray (distinct from bg #1a1a2e)
    LANDA: '#7A6A50',   // Land - warm tan (clearly distinct from water)
  },
  night: {
    DEPIT: '#283820',   // Intertidal - dim green
    DEPVS: '#304858',   // Very shallow - dim blue
    DEPMS: '#283848',   // Medium shallow
    DEPMD: '#202838',   // Medium deep
    DEPDW: '#151820',   // Deep water - very dark blue (still distinct from bg #0A0A10)
    LANDA: '#3A3028',   // Land - dim warm (distinct from water)
  },
};

/**
 * Relief marine theme token overrides per display mode.
 * Applied to non-fill elements (soundings, contour labels, halos, contour lines)
 * when the Relief bathymetric gradient is active.
 */
const RELIEF_TOKEN_OVERRIDES: Record<S52DisplayMode, Partial<Record<S52ColorToken, string>>> = {
  day: {
    SNDCR: '#0A3A5C',   // Soundings - dark navy
    DPCTX: '#FFFFFF',   // Depth contour labels - white (matches contour lines)
    HLCLR: '#1A3A5A',   // Halo - dark navy shadow (water labels)
    CHGRD: '#FFFFFF',   // Contour lines - white
    LRGNT: '#2A1800',   // Land region names - dark brown (readable on green land)
    SENAM: '#FFFFFF',   // Sea area names - white (readable on teal/blue gradient)
    SBDTX: '#C8D8E8',   // Seabed text - light blue-gray (readable on dark blue water)
    GNSWT: '#FFFFFF',   // GNIS water - white (readable on teal/blue gradient)
    GNSCL: '#FFFFFF',   // GNIS coastal - white (readable on teal shoreline)
    GNSLM: '#2A1800',   // GNIS landmark - dark brown (readable on green land)
    GNSPP: '#B01010',   // GNIS populated - dark red (readable on green land)
    GNSST: '#FFFFFF',   // GNIS stream - white (readable on blue water)
    GNSLK: '#FFFFFF',   // GNIS lake - white (readable on blue water)
  },
  dusk: {
    SNDCR: '#6090C0', DPCTX: '#C0D0E0', HLCLR: '#0A1A2A', CHGRD: '#C0D0E0',
    LRGNT: '#D8C8A8', SENAM: '#A0C0E0', SBDTX: '#8098B0',
    GNSWT: '#90B8E0', GNSCL: '#C0A888', GNSLM: '#C0A888', GNSPP: '#E08080', GNSST: '#90B8E0', GNSLK: '#90C8E0',
  },
  night: {
    SNDCR: '#304060', DPCTX: '#607080', HLCLR: '#050A10', CHGRD: '#607080',
    LRGNT: '#706048', SENAM: '#384860', SBDTX: '#384050',
    GNSWT: '#304868', GNSCL: '#504030', GNSLM: '#504030', GNSPP: '#603030', GNSST: '#304868', GNSLK: '#305060',
  },
};

/**
 * Depth color ramp definition for MapLibre fill expressions.
 * Used by getDepthColorRamp() to build either interpolate or step expressions.
 */
export interface DepthColorRamp {
  interpolate: boolean;      // true = smooth gradient, false = discrete bands
  defaultColor: string;      // Color below first stop (step mode only)
  stops: [number, string][]; // [depth_meters, color] pairs, ascending
}

/**
 * Relief depth ramps — smooth interpolated gradient per S-52 display mode.
 * Green (shore) → teal → blue → deep navy.
 */
const RELIEF_DEPTH_RAMPS: Record<S52DisplayMode, DepthColorRamp> = {
  day: {
    interpolate: true,
    defaultColor: '#C0E8A0',
    stops: [
      [-2, '#C0E8A0'],    // Bright lime-green (drying/intertidal)
      [0,  '#80E0A0'],    // Vivid green (shoreline)
      [2,  '#50D8A8'],    // Bright teal-green
      [5,  '#30C8B0'],    // Vivid teal
      [10, '#18A0C8'],    // Bright blue (sharp shift)
      [20, '#1070B8'],    // Saturated blue
      [50, '#0850A0'],    // Rich navy
      [100, '#063878'],   // Dark navy
      [200, '#042860'],   // Very dark navy
      [500, '#021840'],   // Abyss
    ],
  },
  dusk: {
    interpolate: true,
    defaultColor: '#4A6848',
    stops: [
      [-2, '#4A6848'],    // Dim green
      [0,  '#406848'],    // Dim green-teal
      [2,  '#306448'],    // Dim teal-green
      [5,  '#285C48'],    // Dim teal
      [10, '#184858'],    // Dim blue (sharp shift)
      [20, '#103850'],    // Dim deep blue
      [50, '#0A2848'],    // Dim navy
      [100, '#082040'],   // Dim dark navy
      [200, '#061838'],   // Dim very dark navy
      [500, '#060E24'],   // Dim abyss
    ],
  },
  night: {
    interpolate: true,
    defaultColor: '#243418',
    stops: [
      [-2, '#243418'],    // Very dim green
      [0,  '#203420'],    // Very dim green-teal
      [2,  '#183224'],    // Very dim teal-green
      [5,  '#142E24'],    // Very dim teal
      [10, '#0E2430'],    // Very dim blue (sharp shift)
      [20, '#0A1C2C'],    // Very dim deep blue
      [50, '#081626'],    // Very dim navy
      [100, '#061220'],   // Very dim dark navy
      [200, '#040E1C'],   // Very dim very dark navy
      [500, '#030814'],   // Very dim abyss
    ],
  },
};

/**
 * Get S-52 color table with marine theme overrides applied.
 * Currently supports the 'relief' theme for non-fill token overrides.
 */
export function getS52ColorTableWithMarineTheme(
  mode: S52DisplayMode,
  theme: 'relief'
): Record<S52ColorToken, string> {
  return { ...S52_COLOR_TABLES[mode], ...RELIEF_TOKEN_OVERRIDES[mode] };
}

/**
 * Get the depth color ramp for a given display mode and marine theme.
 * Relief returns a smooth interpolated gradient; all others return discrete step bands.
 */
export function getDepthColorRamp(
  mode: S52DisplayMode,
  marineTheme: string
): DepthColorRamp {
  if (marineTheme === 'relief') return RELIEF_DEPTH_RAMPS[mode];
  // Standard 4-breakpoint step ramp for noaa-chart, ocean, ecdis
  const colors = marineTheme === 'ecdis'
    ? { ...S52_COLOR_TABLES[mode], ...ECDIS_OVERRIDES[mode] }
    : S52_COLOR_TABLES[mode];
  return {
    interpolate: false,
    defaultColor: colors.DEPIT,
    stops: [[0, colors.DEPVS], [2, colors.DEPMS], [5, colors.DEPMD], [10, colors.DEPDW]],
  };
}

/**
 * Get S-52 color table with ECDIS overrides applied.
 * Use this when the ECDIS toggle is on.
 *
 * Always returns DAY color base + DAY ECDIS overrides regardless of current
 * display mode. This produces the traditional ECDIS appearance: white deep
 * water, graduated blue depth zones, black text, cream land — matching the
 * IHO S-52 day-mode ECDIS standard that mariners expect.
 */
export function getS52ColorTableWithECDIS(_mode?: S52DisplayMode): Record<S52ColorToken, string> {
  return { ...S52_COLOR_TABLES.day, ...ECDIS_OVERRIDES.day };
}

/**
 * Convert hex color to rgba with opacity
 */
export function hexToRgba(hex: string, opacity: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Default export for convenience
export default {
  getS52Color,
  getUITheme,
  getCurrentMode,
  setDisplayMode,
  loadSavedMode,
  subscribeToModeChanges,
  getS52ColorTable,
  getS52ColorTableWithECDIS,
  getS52ColorTableWithMarineTheme,
  getDepthColorRamp,
  hexToRgba,
};
