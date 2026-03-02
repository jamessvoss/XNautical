const MAPTILER_KEY = 'oenkzVJP4AUZcYIsm5xG';

const TRAILS = {
  'grewingk-glacier': {
    name: 'Grewingk Glacier Lake Trail',
    color: '#3b82f6',
    distance: '9.3 mi through-hike',
    elevation: '1,269 ft',
    time: '4-6 hours',
    difficulty: 'Moderate',
    description: 'The most popular trail in Kachemak Bay State Park. Drop off at Glacier Spit and hike through coastal spruce forest to a stunning glacial lake with floating electric-blue icebergs. Cross Grewingk Creek via the famous hand-operated cable tram, then return via the Saddle Trail to your water taxi pickup.',
    highlights: ['Glacial lake with icebergs', 'Hand-operated cable tram', 'Saddle Trail ridge views', 'Old-growth spruce forest'],
    dropoff: 'Glacier Spit',
    pickup: 'Saddle Trailhead',
    relatedTrails: ['Saddle Trail'],
    image: 'grewingk-glacier.webp',
    camera: { center: [-151.17, 59.612], zoom: 13, pitch: 65, bearing: 200 }
  },
  'grace-ridge': {
    name: 'Grace Ridge Trail',
    color: '#ef4444',
    distance: '8.2 mi point-to-point',
    elevation: '3,145 ft',
    time: '6-8 hours',
    difficulty: 'Moderate to Difficult',
    description: 'A spectacular ridge hike climbing from sea level through old-growth spruce forest to expansive alpine meadows above 3,000 feet. 360-degree panoramic views of Cook Inlet volcanoes, glaciers, fjords, and islands.',
    highlights: ['360\u00b0 volcano panoramas', 'Alpine meadows & wildflowers', 'Mountain goat sightings', 'Old-growth spruce forest'],
    dropoff: 'South Grace Ridge',
    pickup: 'Kayak Beach',
    image: 'grace-ridge.webp',
    camera: { center: [-151.42, 59.48], zoom: 12.5, pitch: 60, bearing: 160 }
  },
  'china-poot-lake': {
    name: 'China Poot Lake Trail',
    color: '#22c55e',
    distance: '2.8 mi one-way',
    elevation: '500 ft',
    time: '1.5-2 hours',
    difficulty: 'Moderate',
    description: 'A scenic forest trail from Halibut Cove Lagoon climbing through spruce to tranquil China Poot Lake. Passes two small lakes where loons nest. Blueberries abundant in August. Gateway to longer backcountry routes.',
    highlights: ['Tranquil alpine lake', 'Nesting loons', 'August blueberry picking', 'Gateway to Poot Peak & Moose Valley'],
    dropoff: 'Halibut Cove Lagoon',
    image: 'china-poot-lake.webp',
    camera: { center: [-151.16, 59.565], zoom: 13.5, pitch: 60, bearing: 160 }
  },
  'alpine-ridge': {
    name: 'Alpine Ridge Trail',
    color: '#f97316',
    distance: '2.5 mi one-way',
    elevation: '1,650 ft',
    time: '2-3 hours',
    difficulty: 'Moderate to Difficult',
    description: 'The quickest route to alpine terrain in the park. Steeply ascends a ridge through spruce and alder, breaking into open tundra with sweeping views of Grewingk Glacier and Kachemak Bay.',
    highlights: ['Fastest route to alpine', 'Grewingk Glacier views', 'Open alpine tundra', 'Connects to Sadie Knob'],
    dropoff: 'Saddle Trailhead',
    waterTaxiTrail: 'Grewingk Glacier Lake Trail',
    image: 'alpine-ridge.webp',
    camera: { center: [-151.155, 59.59], zoom: 14, pitch: 65, bearing: 130 }
  },
  'emerald-lake': {
    name: 'Emerald Lake Trail',
    color: '#eab308',
    distance: '9.0 mi one-way',
    elevation: '2,000 ft',
    time: '5-7 hours',
    difficulty: 'Moderate to Difficult',
    description: 'Cross Grewingk Creek via the famous hand-operated cable tram, then follow the lakeshore before climbing a stunning alpine ridge with panoramic views. The trail traverses high alpine terrain above 2,000 feet before descending to the Humpy Creek Trailhead.',
    highlights: ['Hand-operated cable tram crossing', 'Grewingk Glacier Lake shoreline', 'High alpine ridge traverse', 'Panoramic views of Kachemak Bay'],
    dropoff: 'Glacier Spit',
    waterTaxiTrail: 'Grewingk Glacier Lake Trail',
    image: 'grewingk-glacier.webp',
    camera: { center: [-151.14, 59.64], zoom: 12.5, pitch: 60, bearing: 180 }
  },
  'tutka-lake': {
    name: 'Tutka Lake Trail',
    color: '#06b6d4',
    distance: '1.6 mi one-way',
    elevation: '400 ft',
    time: '1-1.5 hours',
    difficulty: 'Easy to Moderate',
    description: 'A scenic trail through old-growth forest leading to the pristine Tutka Lakes. The trail follows Tutka Creek through lush vegetation with opportunities to spot wildlife and enjoy peaceful lakeside views.',
    highlights: ['Pristine alpine lakes', 'Old-growth forest', 'Tutka Creek views', 'Wildlife viewing'],
    dropoff: 'Tutka Lake Trailhead',
    relatedTrails: ['Tutka Bay Lagoon Trail'],
    image: 'grewingk-glacier.webp',
    camera: { center: [-151.39, 59.435], zoom: 14, pitch: 60, bearing: 160 }
  },
  'tutka-lagoon': {
    name: 'Tutka Bay Lagoon Trail',
    color: '#84cc16',
    distance: '3.1 mi one-way',
    elevation: '200 ft',
    time: '1.5-2.5 hours',
    difficulty: 'Easy',
    description: 'A gentle coastal trail along the shores of Tutka Bay Lagoon, one of the most scenic bays in Kachemak Bay State Park. Passes through meadows and old-growth spruce with views of the lagoon and surrounding peaks.',
    highlights: ['Tutka Bay Lagoon views', 'Coastal meadows', 'Tidal flats & marine life', 'Tutka Bay Lodge area'],
    dropoff: 'Tutka Bay Lagoon',
    waterTaxiTrail: 'Tutka Lake Trail',
    relatedTrails: ['Tutka Lake Trail'],
    image: 'grewingk-glacier.webp',
    camera: { center: [-151.45, 59.44], zoom: 14, pitch: 60, bearing: 120 }
  }
};

let activeTrail = null;

const map = new maplibregl.Map({
  container: 'map',
  style: `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`,
  center: [-151.35, 59.60],
  zoom: 10,
  pitch: 45,
  bearing: 90,
  maxPitch: 85,
  failIfMajorPerformanceCaveat: false
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');

map.on('error', (e) => {
  console.error('Map error:', e.error || e);
});

map.on('load', () => {
  // Terrain DEM source
  try {
    map.addSource('terrain-dem', {
      type: 'raster-dem',
      url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`,
      tileSize: 256
    });

    map.setTerrain({
      source: 'terrain-dem',
      exaggeration: 1.2
    });
  } catch (e) {
    console.warn('Terrain not supported:', e);
  }

  // Sky layer
  try {
    map.setSky({
      'sky-color': '#87CEEB',
      'sky-horizon-blend': 0.5,
      'horizon-color': '#ffffff',
      'horizon-fog-blend': 0.5,
      'fog-color': '#dce6f0',
      'fog-ground-blend': 0.8
    });
  } catch (e) {
    // Sky not supported, skip
  }

  // Trail GeoJSON source
  map.addSource('trails', {
    type: 'geojson',
    data: 'trails.geojson'
  });

  // Water taxi routes (dashed line, rendered first so trails draw on top)
  map.addLayer({
    id: 'water-taxi',
    type: 'line',
    source: 'trails',
    filter: ['==', ['get', 'type'], 'water-taxi'],
    paint: {
      'line-color': '#38bdf8',
      'line-width': 2.5,
      'line-opacity': 0.7,
      'line-dasharray': [4, 3]
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    }
  });

  // Water taxi labels (distance & time)
  map.addLayer({
    id: 'water-taxi-labels',
    type: 'symbol',
    source: 'trails',
    filter: ['==', ['get', 'type'], 'water-taxi'],
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-font': ['Noto Sans Bold'],
      'text-offset': [0, -1],
      'text-allow-overlap': false
    },
    paint: {
      'text-color': '#7dd3fc',
      'text-halo-color': 'rgba(15, 23, 42, 0.9)',
      'text-halo-width': 1.5
    }
  });

  // Hiking trail lines (colored per trail)
  map.addLayer({
    id: 'trail-line',
    type: 'line',
    source: 'trails',
    filter: ['all',
      ['==', '$type', 'LineString'],
      ['!has', 'type']
    ],
    paint: {
      'line-color': [
        'match', ['get', 'name'],
        'Grewingk Glacier Lake Trail', '#3b82f6',
        'Grace Ridge Trail', '#ef4444',
        'China Poot Lake Trail', '#22c55e',
        'Alpine Ridge Trail', '#f97316',
        'Saddle Trail', '#a855f7',
        'Sadie Knob Trail', '#ec4899',
        'Coalition Loop Trail', '#14b8a6',
        'Emerald Lake Trail', '#eab308',
        'Tutka Lake Trail', '#06b6d4',
        'Tutka Bay Lagoon Trail', '#84cc16',
        '#ffffff'
      ],
      'line-width': 4,
      'line-opacity': 0.95
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round'
    }
  });

  // Trail line labels (name & distance along the line)
  map.addLayer({
    id: 'trail-line-labels',
    type: 'symbol',
    source: 'trails',
    filter: ['all',
      ['==', '$type', 'LineString'],
      ['!has', 'type']
    ],
    layout: {
      'symbol-placement': 'line',
      'text-field': ['get', 'label'],
      'text-size': 14,
      'text-font': ['Noto Sans Bold'],
      'text-offset': [0, -0.8],
      'text-allow-overlap': false,
      'text-max-angle': 45,
      'symbol-spacing': 250
    },
    paint: {
      'text-color': '#f8fafc',
      'text-halo-color': 'rgba(15, 23, 42, 0.9)',
      'text-halo-width': 2
    }
  });

  // Trail point markers
  map.addLayer({
    id: 'trail-points',
    type: 'circle',
    source: 'trails',
    filter: ['==', '$type', 'Point'],
    paint: {
      'circle-radius': 5,
      'circle-color': '#ffffff',
      'circle-stroke-color': '#0f172a',
      'circle-stroke-width': 2
    }
  });

  // Trail labels
  map.addLayer({
    id: 'trail-labels',
    type: 'symbol',
    source: 'trails',
    filter: ['==', '$type', 'Point'],
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 12,
      'text-offset': [0, 1.5],
      'text-anchor': 'top',
      'text-font': ['Open Sans Bold']
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#0f172a',
      'text-halo-width': 1.5
    }
  });

  // Preload GeoJSON for elevation profiles
  loadTrailGeoJSON();

  // Build trail cards
  buildTrailCards();

  // Opening fly-in animation
  function showUI() {
    document.getElementById('trail-cards').classList.add('visible');
    document.getElementById('header').classList.add('visible');
  }

  // Fallback: show UI after 5s regardless of fly-in completion
  const uiFallback = setTimeout(showUI, 5000);

  setTimeout(() => {
    map.flyTo({
      center: [-151.30, 59.54],
      zoom: 10.5,
      pitch: 55,
      bearing: 100,
      speed: 0.4,
      curve: 1.5,
      essential: true
    });
    map.once('moveend', () => {
      clearTimeout(uiFallback);
      showUI();
    });
  }, 800);

  // Hover interactions — widen the line on hover instead of separate highlight layer
  let hoveredTrail = null;

  map.on('mousemove', 'trail-line', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    if (e.features.length > 0 && !activeTrail) {
      const trailName = e.features[0].properties.name;
      if (hoveredTrail !== trailName) {
        hoveredTrail = trailName;
        map.setPaintProperty('trail-line', 'line-width', [
          'case',
          ['==', ['get', 'name'], trailName], 7,
          4
        ]);
      }
    }
  });

  map.on('mouseleave', 'trail-line', () => {
    map.getCanvas().style.cursor = '';
    if (!activeTrail) {
      hoveredTrail = null;
      map.setPaintProperty('trail-line', 'line-width', 4);
    }
  });

  // Click trail line to select
  map.on('click', 'trail-line', (e) => {
    if (e.features.length > 0) {
      const trailName = e.features[0].properties.name;
      const trailId = Object.keys(TRAILS).find(id => TRAILS[id].name === trailName);
      if (trailId) selectTrail(trailId);
    }
  });

  // Click empty map area — show coordinates or deselect
  let coordPopup = null;
  map.on('click', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['trail-line'] });
    if (features.length === 0) {
      if (activeTrail) {
        deselectTrail();
      }
      // Show coordinate popup
      const lat = e.lngLat.lat.toFixed(6);
      const lng = e.lngLat.lng.toFixed(6);
      const text = `${lat}, ${lng}`;
      if (coordPopup) coordPopup.remove();
      coordPopup = new maplibregl.Popup({ closeOnClick: true, maxWidth: 'none' })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="cursor:pointer;font:13px monospace;padding:2px" onclick="navigator.clipboard.writeText('${text}');this.textContent='Copied!';setTimeout(()=>this.textContent='${text}',1000)">${text}</div>`)
        .addTo(map);
    }
  });
});

function buildTrailCards() {
  const container = document.getElementById('trail-cards');
  Object.entries(TRAILS).forEach(([id, trail]) => {
    const card = document.createElement('div');
    card.className = 'trail-card';
    card.dataset.trailId = id;
    card.style.setProperty('--trail-color', trail.color);
    card.innerHTML = `
      <img class="trail-card-image" src="images/${trail.image}" alt="${trail.name}" />
      <div class="trail-card-body">
        <div class="trail-card-name">${trail.name}</div>
        <div class="trail-card-meta">
          <span class="difficulty-badge" style="background:${trail.color}20;color:${trail.color}">${trail.difficulty}</span>
          <span>${trail.distance}</span>
        </div>
      </div>
    `;
    card.addEventListener('click', () => selectTrail(id));
    container.appendChild(card);
  });
}

function selectTrail(trailId) {
  const trail = TRAILS[trailId];
  if (!trail) return;
  activeTrail = trailId;

  // Update card active states
  document.querySelectorAll('.trail-card').forEach(card => {
    card.classList.toggle('active', card.dataset.trailId === trailId);
  });

  // Dim other trails, brighten selected (include related trails)
  const activeNames = [trail.name, ...(trail.relatedTrails || [])];
  const nameMatchExpr = activeNames.length === 1
    ? ['==', ['get', 'name'], activeNames[0]]
    : ['any', ...activeNames.map(n => ['==', ['get', 'name'], n])];

  map.setPaintProperty('trail-line', 'line-opacity', [
    'case',
    nameMatchExpr, 1,
    0.3
  ]);

  // Show only the matching water taxi route
  const taxiMatchName = trail.waterTaxiTrail || trail.name;
  map.setPaintProperty('water-taxi', 'line-opacity', [
    'case',
    ['==', ['get', 'trail'], taxiMatchName], 0.9,
    0.15
  ]);

  // Fly to trail camera position
  map.flyTo({
    ...trail.camera,
    speed: 0.8,
    curve: 1.4,
    essential: true
  });

  // Animate trail drawing
  animateTrailPath(trailId);

  // Show info panel and elevation profile
  showInfoPanel(trailId);
  showElevationProfile(trailId);
}

function animateTrailPath(trailId) {
  const trail = TRAILS[trailId];
  const activeNames = [trail.name, ...(trail.relatedTrails || [])];
  const nameMatchExpr = activeNames.length === 1
    ? ['==', ['get', 'name'], activeNames[0]]
    : ['any', ...activeNames.map(n => ['==', ['get', 'name'], n])];

  map.setPaintProperty('trail-line', 'line-width', [
    'case',
    nameMatchExpr, 6,
    3
  ]);
}

function deselectTrail() {
  activeTrail = null;
  document.querySelectorAll('.trail-card').forEach(c => c.classList.remove('active'));
  map.setPaintProperty('trail-line', 'line-opacity', 0.95);
  map.setPaintProperty('trail-line', 'line-width', 4);
  map.setPaintProperty('water-taxi', 'line-opacity', 0.7);
  hideInfoPanel();
  hideElevationProfile();
}

function showInfoPanel(trailId) {
  const trail = TRAILS[trailId];
  const panel = document.getElementById('info-panel');

  panel.innerHTML = `
    <button class="panel-close" onclick="deselectTrail()">&times;</button>
    <img class="panel-image" src="images/${trail.image}" alt="${trail.name}" />
    <div class="panel-content" style="--trail-color:${trail.color}">
      <h2>${trail.name}</h2>
      <span class="difficulty-badge" style="background:${trail.color}20;color:${trail.color}">${trail.difficulty}</span>
      <div class="panel-stats">
        <div class="stat"><span class="stat-value">${trail.distance}</span><span class="stat-label">Distance</span></div>
        <div class="stat"><span class="stat-value">${trail.elevation}</span><span class="stat-label">Elevation</span></div>
        <div class="stat"><span class="stat-value">${trail.time}</span><span class="stat-label">Time</span></div>
        <div class="stat"><span class="stat-value">${trail.dropoff}</span><span class="stat-label">${trail.pickup ? 'Drop-off' : 'Water Taxi'}</span></div>
        ${trail.pickup ? `<div class="stat"><span class="stat-value">${trail.pickup}</span><span class="stat-label">Pick-up</span></div>` : ''}
      </div>
      <p class="panel-description">${trail.description}</p>
      <div class="panel-highlights">
        <h3>Highlights</h3>
        <ul>${trail.highlights.map(h => `<li>${h}</li>`).join('')}</ul>
      </div>
      <a href="https://49northalaskanadventures.com" class="panel-cta" target="_blank">Book This Adventure</a>
    </div>
  `;

  requestAnimationFrame(() => panel.classList.add('open'));
}

function hideInfoPanel() {
  document.getElementById('info-panel').classList.remove('open');
}

// --- Elevation Profile ---

// Cache for GeoJSON data
let trailGeoJSON = null;

function loadTrailGeoJSON() {
  return fetch('trails.geojson')
    .then(r => r.json())
    .then(data => { trailGeoJSON = data; return data; });
}

function getTrailCoordinates(trailName) {
  if (!trailGeoJSON) return null;
  const feature = trailGeoJSON.features.find(
    f => f.geometry.type === 'LineString' && f.properties.name === trailName
  );
  return feature ? feature.geometry.coordinates : null;
}

function haversineDistance(coord1, coord2) {
  const R = 6371000; // meters
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(coord2[1] - coord1[1]);
  const dLon = toRad(coord2[0] - coord1[0]);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(coord1[1])) * Math.cos(toRad(coord2[1])) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function showElevationProfile(trailId) {
  const trail = TRAILS[trailId];
  const coords = getTrailCoordinates(trail.name);
  if (!coords || coords.length < 2) return;

  const canvas = document.getElementById('elevation-profile');
  const ctx = canvas.getContext('2d');

  // Set canvas resolution
  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.clientWidth;
  const displayH = canvas.clientHeight;
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  ctx.scale(dpr, dpr);

  // Sample elevations from terrain DEM
  const samples = [];
  let cumulDist = 0;

  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      cumulDist += haversineDistance(coords[i - 1], coords[i]);
    }
    const elev = map.queryTerrainElevation({ lng: coords[i][0], lat: coords[i][1] });
    if (elev != null) {
      samples.push({ dist: cumulDist, elev: elev });
    }
  }

  if (samples.length < 2) return;

  const totalDist = samples[samples.length - 1].dist;
  const minElev = Math.min(...samples.map(s => s.elev));
  const maxElev = Math.max(...samples.map(s => s.elev));
  const elevRange = maxElev - minElev || 1;

  // Drawing area with margins for labels
  const ml = 45, mr = 10, mt = 10, mb = 22;
  const w = displayW - ml - mr;
  const h = displayH - mt - mb;

  ctx.clearRect(0, 0, displayW, displayH);

  // Build path
  const toX = d => ml + (d / totalDist) * w;
  const toY = e => mt + h - ((e - minElev) / elevRange) * h;

  // Gradient fill
  const grad = ctx.createLinearGradient(0, mt, 0, mt + h);
  grad.addColorStop(0, trail.color + '60');
  grad.addColorStop(1, trail.color + '08');

  ctx.beginPath();
  ctx.moveTo(toX(samples[0].dist), mt + h);
  samples.forEach(s => ctx.lineTo(toX(s.dist), toY(s.elev)));
  ctx.lineTo(toX(samples[samples.length - 1].dist), mt + h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line on top
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = toX(s.dist);
    const y = toY(s.elev);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = trail.color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Labels
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px -apple-system, sans-serif';

  // Y-axis labels (elevation in ft)
  ctx.textAlign = 'right';
  ctx.fillText(Math.round(maxElev * 3.281) + ' ft', ml - 5, mt + 10);
  ctx.fillText(Math.round(minElev * 3.281) + ' ft', ml - 5, mt + h);

  // X-axis labels (distance in miles)
  ctx.textAlign = 'left';
  ctx.fillText('0 mi', ml, mt + h + 14);
  ctx.textAlign = 'right';
  ctx.fillText((totalDist / 1609.34).toFixed(1) + ' mi', ml + w, mt + h + 14);

  canvas.classList.add('visible');
}

function hideElevationProfile() {
  document.getElementById('elevation-profile').classList.remove('visible');
}

// --- Auto-Tour Mode ---

let tourActive = false;
let tourAbortController = null;

async function startTour() {
  tourActive = true;
  const btn = document.getElementById('tour-btn');
  btn.textContent = 'Exit Tour';
  btn.classList.add('active');

  tourAbortController = new AbortController();
  const signal = tourAbortController.signal;

  const trailIds = Object.keys(TRAILS);

  // Start with overview
  deselectTrail();
  map.flyTo({
    center: [-151.30, 59.54],
    zoom: 10.5,
    pitch: 55,
    bearing: 100,
    speed: 0.6,
    essential: true
  });

  await waitForIdle(signal);
  await delay(2000, signal);

  for (const id of trailIds) {
    if (signal.aborted) break;

    const trail = TRAILS[id];

    // Show trail name overlay
    showTourOverlay(trail.name);
    await delay(1500, signal);

    // Select and fly to trail
    selectTrail(id);
    await waitForIdle(signal);
    await delay(4000, signal);

    hideTourOverlay();
    await delay(500, signal);
  }

  if (!signal.aborted) {
    endTour();
  }
}

function endTour() {
  tourActive = false;
  const btn = document.getElementById('tour-btn');
  btn.textContent = 'Take the Tour';
  btn.classList.remove('active');
  tourAbortController = null;
  hideTourOverlay();
}

function stopTour() {
  if (tourAbortController) {
    tourAbortController.abort();
  }
  endTour();
}

function waitForIdle(signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onEnd = () => resolve();
    const onAbort = () => { map.off('moveend', onEnd); resolve(); };
    map.once('moveend', onEnd);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function showTourOverlay(text) {
  const el = document.getElementById('tour-overlay');
  el.textContent = text;
  el.classList.add('visible');
}

function hideTourOverlay() {
  document.getElementById('tour-overlay').classList.remove('visible');
}

// Tour button handler
document.getElementById('tour-btn').addEventListener('click', () => {
  if (tourActive) stopTour();
  else startTour();
});

// Escape key stops tour or deselects trail
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (tourActive) stopTour();
    else if (activeTrail) flyToOverview();
  }
});

// --- Overview / Reset ---

function flyToOverview() {
  deselectTrail();
  map.flyTo({
    center: [-151.30, 59.54],
    zoom: 10.5,
    pitch: 55,
    bearing: 100,
    speed: 0.8,
    curve: 1.4,
    essential: true
  });
}

document.getElementById('overview-btn').addEventListener('click', flyToOverview);
