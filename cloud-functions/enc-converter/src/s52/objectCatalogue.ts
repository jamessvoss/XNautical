/**
 * S-57 Object Class and Attribute Catalogue
 *
 * Maps numeric codes to acronyms/names for S-57 object classes and attributes.
 * Based on IHO S-57 Appendix A - Object Catalogue.
 *
 * IMPORTANT: Code numbers are the actual binary OBJL values found in .000 files.
 * Verified empirically by cross-referencing GDAL layer names with TypeScript
 * parser output on 50+ NOAA charts. Codes marked (v) are verified.
 */

/**
 * S-57 Object class code → acronym mapping.
 * Covers the most common hydrographic object classes.
 */
const OBJECT_CLASSES: Record<number, string> = {
  // Administration
  1: 'ADMARE',   // Administration area (Named) (v)
  2: 'AIRARE',   // Airport / airfield (v)
  3: 'ACHBRT',   // Anchor berth (v)
  4: 'ACHARE',   // Anchorage area (v)
  5: 'BCNCAR',   // Beacon, cardinal (v)
  6: 'BCNISD',   // Beacon, isolated danger (v)
  7: 'BCNLAT',   // Beacon, lateral (v)
  8: 'BCNSAW',   // Beacon, safe water (v)
  9: 'BCNSPP',   // Beacon, special purpose (v)
  10: 'BERTHS',  // Berth
  11: 'BRIDGE',  // Bridge (v)
  12: 'BUISGL',  // Building, single (v)
  13: 'BUAARE',  // Built-up area (v)
  14: 'BOYCAR',  // Buoy, cardinal (v)
  15: 'BOYINB',  // Buoy, installation (v)
  16: 'BOYISD',  // Buoy, isolated danger (v)
  17: 'BOYLAT',  // Buoy, lateral (v)
  18: 'BOYSAW',  // Buoy, safe water (v)
  19: 'BOYSPP',  // Buoy, special purpose (v)
  20: 'CBLARE',  // Cable area (v)
  21: 'CBLOHD',  // Cable, overhead (v)
  22: 'CBLSUB',  // Cable, submarine (v)
  23: 'CANALS',  // Canal (v)
  24: 'CANBNK',  // Canal bank (obsolete)
  25: 'CTSARE',  // Cargo transhipment area
  26: 'CAUSWY',  // Causeway (v)
  27: 'CTNARE',  // Caution area (v)
  28: 'CHKPNT',  // Checkpoint
  29: 'CGUSTA',  // Coastguard station
  30: 'COALNE',  // Coastline (v)
  31: 'CONZNE',  // Contiguous zone (v)
  32: 'COSARE',  // Continental shelf area
  33: 'CTRPNT',  // Control point
  34: 'CONVYR',  // Conveyor
  35: 'CRANES',  // Crane
  36: 'CURONE',  // Current - non-gravitational
  37: 'CUSZNE',  // Custom zone
  38: 'DAMCON',  // Dam
  39: 'DAYMAR',  // Daymark (v)
  40: 'DWRTCL',  // Deep water route centerline
  41: 'DWRTPT',  // Deep water route part
  42: 'DEPARE',  // Depth area (v)
  43: 'DEPCNT',  // Depth contour (v)
  44: 'DISMAR',  // Distance mark
  45: 'DOCARE',  // Dock area
  46: 'DRGARE',  // Dredged area (v)
  47: 'DRYDOC',  // Dry dock
  48: 'DMPGRD',  // Dumping ground
  49: 'DYKCON',  // Dyke
  50: 'EXEZNE',  // Exclusive Economic Zone (v)
  51: 'FAIRWY',  // Fairway (v)
  52: 'FNCLNE',  // Fence/wall
  53: 'FERYRT',  // Ferry route
  54: 'FSHZNE',  // Fishery zone
  55: 'FSHFAC',  // Fishing facility
  56: 'FSHGRD',  // Fishing ground
  57: 'FLODOC',  // Floating dock
  58: 'FOGSIG',  // Fog signal (v)
  59: 'FORSTC',  // Fortified structure
  60: 'FRPARE',  // Free port area
  61: 'GATCON',  // Gate
  62: 'GRIDRN',  // Gridiron
  63: 'HRBARE',  // Harbour area (administrative)
  64: 'HRBFAC',  // Harbour facility
  65: 'HULKES',  // Hulk (v)
  66: 'ICEARE',  // Ice area (v)
  67: 'ICNARE',  // Incineration area (obsolete)
  68: 'ISTZNE',  // Inshore traffic zone
  69: 'LAKARE',  // Lake (v)
  70: 'LAKSHR',  // Lake shore (obsolete)
  71: 'LNDARE',  // Land area (v)
  72: 'LNDELV',  // Land elevation (v)
  73: 'LNDRGN',  // Land region (v)
  74: 'LNDMRK',  // Landmark (v)
  75: 'LIGHTS',  // Light (v)
  76: 'LITFLT',  // Light float
  77: 'LITVES',  // Light vessel
  78: 'LOCMAG',  // Local magnetic anomaly (v)
  79: 'LOKBSN',  // Lock basin
  80: 'LOGPON',  // Log pond
  81: 'MAGVAR',  // Magnetic variation (v)
  82: 'MARCUL',  // Marine farm/culture (v)
  83: 'MIPARE',  // Military practice area (v)
  84: 'MORFAC',  // Mooring/warping facility (v)
  85: 'NAVLNE',  // Navigation line (v)
  86: 'OBSTRN',  // Obstruction (v)
  87: 'OFSPLF',  // Offshore platform
  88: 'OSPARE',  // Offshore production area
  89: 'OILBAR',  // Oil barrier
  90: 'PILPNT',  // Pile (v)
  91: 'PILBOP',  // Pilot boarding place (v)
  92: 'PIPARE',  // Pipeline area (v)
  93: 'PIPOHD',  // Pipeline, overhead
  94: 'PIPSOL',  // Pipeline, submarine/on land (v)
  95: 'PONTON',  // Pontoon (v)
  96: 'PRCARE',  // Precautionary area
  97: 'PRDARE',  // Production / storage area
  98: 'PYLONS',  // Pylon/bridge support
  99: 'RADLNE',  // Radar line
  100: 'RADRNG', // Radar range
  101: 'RADRFL', // Radar reflector
  102: 'RADSTA', // Radar station
  103: 'RTPBCN', // Radar transponder beacon
  104: 'RDOCAL', // Radio calling-in point
  105: 'RDOSTA', // Radio station
  106: 'RAILWY', // Railway
  107: 'RAPIDS', // Rapids
  108: 'RCRTCL', // Recommended route centerline
  109: 'RECTRC', // Recommended track (v)
  110: 'RCTLPT', // Recommended traffic lane part
  111: 'RSCSTA', // Rescue station (v)
  112: 'RESARE', // Restricted area (v)
  113: 'RETRFL', // Retro-reflector
  114: 'RIVERS', // River (v)
  115: 'RIVBNK', // River bank (obsolete)
  116: 'ROADWY', // Road
  117: 'RUNWAY', // Runway (v)
  118: 'SNDWAV', // Sand waves
  119: 'SEAARE', // Sea area / named water area (v)
  120: 'SPLARE', // Sea-plane landing area
  121: 'SBDARE', // Seabed area (v)
  122: 'SLCONS', // Shoreline construction (v)
  123: 'SISTAT', // Signal station, traffic
  124: 'SISTAW', // Signal station, warning
  125: 'SILTNK', // Silo / tank (v)
  126: 'SLOTOP', // Slope topline (v)
  127: 'SLOGRD', // Sloping ground (v)
  128: 'SMCFAC', // Small craft facility
  129: 'SOUNDG', // Sounding (v)
  130: 'SPRING', // Spring
  131: 'STSLNE', // Straight territorial sea baseline (obsolete)
  132: 'SUBTLN', // Submarine transit lane
  133: 'SWPARE', // Swept area
  134: 'TESARE', // Territorial sea area
  135: 'TIDEWY', // Tideway (obsolete)
  136: 'TS_PRH', // Tidal stream - prediction - harmonic
  137: 'TS_PNH', // Tidal stream - prediction - non-harmonic
  138: 'TS_PAD', // Tidal stream panel data
  139: 'TS_TIS', // Tidal stream - time series
  140: 'T_HMON', // Tide - harmonic prediction
  141: 'T_NHMN', // Tide - non-harmonic prediction
  142: 'T_TIMS', // Tidal stream - time series (obsolete)
  143: 'TSSBND', // Traffic separation scheme boundary
  144: 'TOPMAR', // Topmark (v)
  145: 'TSELNE', // Traffic separation line (v)
  146: 'TSSCRS', // Traffic separation scheme crossing
  147: 'TSEZNE', // Traffic separation zone
  148: 'TSSLPT', // Traffic separation scheme lane part (v)
  149: 'TSSRON', // Traffic separation scheme roundabout
  150: 'TUNNEL', // Tunnel
  151: 'TWRTPT', // Two-way route part
  152: 'UNSARE', // Unsurveyed area
  153: 'UWTROC', // Underwater/awash rock (v)
  154: 'WATFAL', // Waterfall
  155: 'VEGATN', // Vegetation (v)
  156: 'WATTUR', // Water turbulence (v)
  157: 'TS_FEB', // Tidal stream - flood/ebb
  158: 'WEDKLP', // Weed/Kelp (v)
  159: 'WRECKS', // Wreck (v)
  160: 'ARCSLN', // Archipelagic sea lane
  161: 'ASLXIS', // Archipelagic sea lane axis
  162: 'NEWOBJ', // New object

  // Meta objects
  300: 'M_ACCY', // Accuracy of data
  301: 'M_CSCL', // Compilation scale of data
  302: 'M_COVR', // Coverage (v)
  303: 'M_HDAT', // Horizontal datum of data (obsolete)
  304: 'M_HOPA', // Horizontal datum shift parameters
  305: 'M_NPUB', // Nautical publication information (v)
  306: 'M_NSYS', // Navigational system of marks (v)
  307: 'M_PROD', // Production information
  308: 'M_QUAL', // Quality of data (v)
  309: 'M_SDAT', // Sounding datum (obsolete)
  310: 'M_SREL', // Survey reliability
  311: 'M_UNIT', // Units of measurement of data (obsolete)
  312: 'M_VDAT', // Vertical datum of data (obsolete)

  // Cartographic objects
  400: 'C_AGGR', // Aggregation
  401: 'C_ASSO', // Association (v)
  402: 'C_STAC', // Stacked on/stacked under

  // Skin of earth
  500: '$AREAS', // Cartographic area
  501: '$LINES', // Cartographic line
  502: '$CSYMB', // Cartographic symbol
  503: '$COMPS', // Compass
  504: '$TEXTS', // Text
};

/**
 * Get object class acronym from numeric code.
 */
export function getObjectClassName(objl: number): string {
  return OBJECT_CLASSES[objl] || `UNKNOWN_${objl}`;
}

/**
 * Get object class code from acronym.
 */
export function getObjectClassCode(acronym: string): number | undefined {
  for (const [code, name] of Object.entries(OBJECT_CLASSES)) {
    if (name === acronym) return parseInt(code, 10);
  }
  return undefined;
}

/**
 * S-57 Attribute code → acronym mapping.
 * Based on IHO S-57 Appendix A / GDAL s57attributes.csv canonical reference.
 * Codes are the ATTL values found in binary ATTF/NATF fields.
 */
const ATTRIBUTES: Record<number, string> = {
  1: 'AGENCY',   // Agency responsible for production
  2: 'BCNSHP',   // Beacon shape
  3: 'BUISHP',   // Building shape
  4: 'BOYSHP',   // Buoy shape
  5: 'BURDEP',   // Buried depth
  6: 'CALSGN',   // Call sign
  7: 'CATAIR',   // Category of airport/airfield
  8: 'CATACH',   // Category of anchorage
  9: 'CATBRG',   // Category of bridge
  10: 'CATBUA',  // Category of built-up area
  11: 'CATCBL',  // Category of cable
  12: 'CATCAN',  // Category of canal
  13: 'CATCAM',  // Category of cardinal mark
  14: 'CATCHP',  // Category of checkpoint
  15: 'CATCOA',  // Category of coastline
  16: 'CATCTR',  // Category of control point
  17: 'CATCON',  // Category of conveyor
  18: 'CATCOV',  // Category of coverage
  19: 'CATCRN',  // Category of crane
  20: 'CATDAM',  // Category of dam
  21: 'CATDIS',  // Category of distance mark
  22: 'CATDOC',  // Category of dock
  23: 'CATDPG',  // Category of dumping ground
  24: 'CATFNC',  // Category of fence/wall
  25: 'CATFRY',  // Category of ferry
  26: 'CATFIF',  // Category of fishing facility
  27: 'CATFOG',  // Category of fog signal
  28: 'CATFOR',  // Category of fortified structure
  29: 'CATGAT',  // Category of gate
  30: 'CATHAF',  // Category of harbour facility
  31: 'CATHLK',  // Category of hulk
  32: 'CATICE',  // Category of ice
  33: 'CATINB',  // Category of installation buoy
  34: 'CATLND',  // Category of land region
  35: 'CATLMK',  // Category of landmark
  36: 'CATLAM',  // Category of lateral mark
  37: 'CATLIT',  // Category of light
  38: 'CATMFA',  // Category of marine farm/culture
  39: 'CATMPA',  // Category of military practice area
  40: 'CATMOR',  // Category of mooring/warping facility
  41: 'CATNAV',  // Category of navigation line
  42: 'CATOBS',  // Category of obstruction
  43: 'CATOFP',  // Category of offshore platform
  44: 'CATOLB',  // Category of oil barrier
  45: 'CATPLE',  // Category of pile
  46: 'CATPIL',  // Category of pilot boarding place
  47: 'CATPIP',  // Category of pipeline/pipe
  48: 'CATPRA',  // Category of production area
  49: 'CATPYL',  // Category of pylon
  50: 'CATQUA',  // Category of quality of data
  51: 'CATRAS',  // Category of radar station
  52: 'CATRTB',  // Category of radar transponder beacon
  53: 'CATROS',  // Category of radio station
  54: 'CATTRK',  // Category of recommended track
  55: 'CATRSC',  // Category of rescue station
  56: 'CATREA',  // Category of restricted area
  57: 'CATROD',  // Category of road
  58: 'CATRUN',  // Category of runway
  59: 'CATSEA',  // Category of sea area
  60: 'CATSLC',  // Category of shoreline construction
  61: 'CATSIT',  // Category of signal station, traffic
  62: 'CATSIW',  // Category of signal station, warning
  63: 'CATSIL',  // Category of silo/tank
  64: 'CATSLO',  // Category of slope
  65: 'CATSCF',  // Category of small craft facility
  66: 'CATSPM',  // Category of special purpose mark
  67: 'CATTSS',  // Category of Traffic Separation Scheme
  68: 'CATVEG',  // Category of vegetation
  69: 'CATWAT',  // Category of water turbulence
  70: 'CATWED',  // Category of weed/kelp
  71: 'CATWRK',  // Category of wreck
  72: 'CATZOC',  // Category of zone of confidence data
  75: 'COLOUR',  // Colour
  76: 'COLPAT',  // Colour pattern
  77: 'COMCHA',  // Communication channel
  79: 'CPDATE',  // Compilation date
  80: 'CSCALE',  // Compilation scale
  81: 'CONDTN',  // Condition
  82: 'CONRAD',  // Conspicuous, Radar
  83: 'CONVIS',  // Conspicuous, visual
  84: 'CURVEL',  // Current velocity
  85: 'DATEND',  // Date end
  86: 'DATSTA',  // Date start
  87: 'DRVAL1',  // Depth range value 1
  88: 'DRVAL2',  // Depth range value 2
  89: 'DUNITS',  // Depth units
  90: 'ELEVAT',  // Elevation
  91: 'ESTRNG',  // Estimated range of transmission
  92: 'EXCLIT',  // Exhibition condition of light
  93: 'EXPSOU',  // Exposition of sounding
  94: 'FUNCTN',  // Function
  95: 'HEIGHT',  // Height
  96: 'HUNITS',  // Height/length units
  97: 'HORACC',  // Horizontal accuracy
  98: 'HORCLR',  // Horizontal clearance
  99: 'HORLEN',  // Horizontal length
  100: 'HORWID', // Horizontal width
  101: 'ICEFAC', // Ice factor
  102: 'INFORM', // Information
  103: 'JRSDTN', // Jurisdiction
  106: 'LIFCAP', // Lifting capacity
  107: 'LITCHR', // Light characteristic
  108: 'LITVIS', // Light visibility
  109: 'MARSYS', // Marks navigational - System of
  110: 'MLTYLT', // Multiplicity of lights
  111: 'NATION', // Nationality
  112: 'NATCON', // Nature of construction
  113: 'NATSUR', // Nature of surface
  114: 'NATQUA', // Nature of surface - qualifying terms
  115: 'NMDATE', // Notice to Mariners date
  116: 'OBJNAM', // Object name
  117: 'ORIENT', // Orientation
  118: 'PEREND', // Periodic date end
  119: 'PERSTA', // Periodic date start
  120: 'PICREP', // Pictorial representation
  121: 'PILDST', // Pilot district
  122: 'PRCTRY', // Producing country
  123: 'PRODCT', // Product
  124: 'PUBREF', // Publication reference
  125: 'QUASOU', // Quality of sounding measurement
  126: 'RADWAL', // Radar wave length
  127: 'RADIUS', // Radius
  128: 'RECDAT', // Recording date
  129: 'RECIND', // Recording indication
  130: 'RYRMGV', // Reference year for magnetic variation
  131: 'RESTRN', // Restriction
  132: 'SCAMAX', // Scale maximum
  133: 'SCAMIN', // Scale minimum
  134: 'SCVAL1', // Scale value one
  135: 'SCVAL2', // Scale value two
  136: 'SECTR1', // Sector limit one
  137: 'SECTR2', // Sector limit two
  138: 'SHIPAM', // Shift parameters
  139: 'SIGFRQ', // Signal frequency
  140: 'SIGGEN', // Signal generation
  141: 'SIGGRP', // Signal group
  142: 'SIGPER', // Signal period
  143: 'SIGSEQ', // Signal sequence
  144: 'SOUACC', // Sounding accuracy
  145: 'SDISMX', // Sounding distance - maximum
  146: 'SDISMN', // Sounding distance - minimum
  147: 'SORDAT', // Source date
  148: 'SORIND', // Source indication
  149: 'STATUS', // Status
  150: 'SURATH', // Survey authority
  151: 'SUREND', // Survey date - end
  152: 'SURSTA', // Survey date - start
  153: 'SURTYP', // Survey type
  156: 'TECSOU', // Technique of sounding measurement
  158: 'TXTDSC', // Textual description
  159: 'TS_TSP', // Tidal stream - panel values
  160: 'TS_TSV', // Tidal stream, current - time series values
  161: 'T_ACWL', // Tide - accuracy of water level
  162: 'T_HWLW', // Tide - high and low water values
  163: 'T_MTOD', // Tide - method of tidal prediction
  164: 'T_THDF', // Tide - time and height differences
  165: 'T_TINT', // Tide, current - time interval of values
  166: 'T_TSVL', // Tide - time series values
  167: 'T_VAHC', // Tide - value of harmonic constituents
  168: 'TIMEND', // Time end
  169: 'TIMSTA', // Time start
  171: 'TOPSHP', // Topmark/daymark shape
  172: 'TRAFIC', // Traffic flow
  173: 'VALACM', // Value of annual change in magnetic variation
  174: 'VALDCO', // Value of depth contour
  175: 'VALLMA', // Value of local magnetic anomaly
  176: 'VALMAG', // Value of magnetic variation
  177: 'VALMXR', // Value of maximum range
  178: 'VALNMR', // Value of nominal range
  179: 'VALSOU', // Value of sounding
  180: 'VERACC', // Vertical accuracy
  181: 'VERCLR', // Vertical clearance
  182: 'VERCCL', // Vertical clearance, closed
  183: 'VERCOP', // Vertical clearance, open
  184: 'VERCSA', // Vertical clearance, safe
  185: 'VERDAT', // Vertical datum
  186: 'VERLEN', // Vertical length
  187: 'WATLEV', // Water level effect
  188: 'CAT_TS', // Category of Tidal stream
  189: 'PUNITS', // Positional accuracy units
  190: 'CLSDEF', // Object class definition
  191: 'CLSNAM', // Object class name
  192: 'SYMINS', // Symbol instruction
  // National language attributes
  300: 'NINFOM', // Information in national language
  301: 'NOBJNM', // Object name in national language
  302: 'NPLDST', // Pilot district in national language
  304: 'NTXTDS', // Textual description in national language
  // Spatial attributes
  400: 'HORDAT', // Horizontal datum
  401: 'POSACC', // Positional Accuracy
  402: 'QUAPOS', // Quality of position
};

/**
 * Get attribute acronym from numeric code.
 */
export function getAttributeAcronym(code: number): string {
  return ATTRIBUTES[code] || `ATTR_${code}`;
}

/**
 * Get attribute code from acronym.
 */
export function getAttributeCode(acronym: string): number | undefined {
  for (const [code, name] of Object.entries(ATTRIBUTES)) {
    if (name === acronym) return parseInt(code, 10);
  }
  return undefined;
}
