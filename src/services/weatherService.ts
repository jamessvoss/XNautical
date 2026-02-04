/**
 * Weather Service
 * Fetches weather forecasts from NOAA Weather.gov API
 */

export interface WeatherPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  temperatureTrend: string | null;
  probabilityOfPrecipitation: {
    unitCode: string;
    value: number | null;
  } | null;
  windSpeed: string;
  windDirection: string;
  icon: string;
  shortForecast: string;
  detailedForecast: string;
}

export interface WeatherForecast {
  location: string;
  updated: string;
  periods: WeatherPeriod[];
}

// Cache for weather data
let forecastCache: WeatherForecast | null = null;
let forecastCacheTime: number = 0;
let cachedLat: number = 0;
let cachedLon: number = 0;
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes
const LOCATION_THRESHOLD = 0.1; // ~7 miles - don't refetch if location change is small

/**
 * Get weather forecast for a location
 */
export async function getWeatherForecast(lat: number, lon: number): Promise<WeatherForecast | null> {
  // Check cache - use if location hasn't changed much and cache is fresh
  const locationChanged = Math.abs(lat - cachedLat) > LOCATION_THRESHOLD || 
                          Math.abs(lon - cachedLon) > LOCATION_THRESHOLD;
  
  if (forecastCache && !locationChanged && Date.now() - forecastCacheTime < CACHE_DURATION) {
    return forecastCache;
  }

  try {
    // Step 1: Get the forecast office/grid for this location
    const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
    const pointsResponse = await fetch(pointsUrl, {
      headers: {
        'User-Agent': 'XNautical Mobile App (contact@xnautical.com)',
        'Accept': 'application/geo+json',
      },
    });

    if (!pointsResponse.ok) {
      console.error('Weather points API error:', pointsResponse.status);
      return null;
    }

    const pointsData = await pointsResponse.json();
    const forecastUrl = pointsData.properties?.forecast;
    const locationName = pointsData.properties?.relativeLocation?.properties?.city || 'Unknown Location';
    const state = pointsData.properties?.relativeLocation?.properties?.state || '';

    if (!forecastUrl) {
      console.error('No forecast URL in points response');
      return null;
    }

    // Step 2: Get the actual forecast
    const forecastResponse = await fetch(forecastUrl, {
      headers: {
        'User-Agent': 'XNautical Mobile App (contact@xnautical.com)',
        'Accept': 'application/geo+json',
      },
    });

    if (!forecastResponse.ok) {
      console.error('Weather forecast API error:', forecastResponse.status);
      return null;
    }

    const forecastData = await forecastResponse.json();
    const periods: WeatherPeriod[] = forecastData.properties?.periods || [];

    const forecast: WeatherForecast = {
      location: state ? `${locationName}, ${state}` : locationName,
      updated: forecastData.properties?.updated || new Date().toISOString(),
      periods: periods.slice(0, 7), // Get about 3-4 days worth (day + night periods)
    };

    // Update cache
    forecastCache = forecast;
    forecastCacheTime = Date.now();
    cachedLat = lat;
    cachedLon = lon;

    return forecast;
  } catch (error: any) {
    // Silently handle network errors when offline
    if (!error?.message?.includes('Network request failed') && !error?.message?.includes('offline')) {
      console.log('[Weather] Error fetching forecast:', error?.message || error);
    }
    return null;
  }
}

/**
 * Get weather icon based on forecast text
 */
export function getWeatherEmoji(shortForecast: string, isDaytime: boolean): string {
  const forecast = shortForecast.toLowerCase();
  
  if (forecast.includes('snow') || forecast.includes('blizzard')) return '❄️';
  if (forecast.includes('rain') && forecast.includes('snow')) return '🌨️';
  if (forecast.includes('thunder') || forecast.includes('storm')) return '⛈️';
  if (forecast.includes('rain') || forecast.includes('showers')) return '🌧️';
  if (forecast.includes('drizzle')) return '🌦️';
  if (forecast.includes('fog') || forecast.includes('mist')) return '🌫️';
  if (forecast.includes('cloudy') && forecast.includes('partly')) return isDaytime ? '⛅' : '☁️';
  if (forecast.includes('cloudy') || forecast.includes('overcast')) return '☁️';
  if (forecast.includes('wind')) return '💨';
  if (forecast.includes('clear') || forecast.includes('sunny')) return isDaytime ? '☀️' : '🌙';
  
  return isDaytime ? '🌤️' : '🌙';
}

/**
 * Format temperature with degree symbol
 */
export function formatTemp(temp: number, unit: string = 'F'): string {
  return `${temp}°${unit}`;
}

/**
 * Get short day name from date string
 */
export function getShortDayName(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}
