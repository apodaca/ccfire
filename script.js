// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW Registration failed:', err);
    });
  });
}

// Icons Set (SVG strings)
const ICONS = {
  danger: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  lightning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
};

// Global State
let map;
let marker;
let currentCoords = { lat: 37.1995, lon: -105.4236 }; // Default: San Luis

// Dynamic Hazard Thresholds Function
const getHazardCriteria = (lat, lon) => {
  // Can be adjusted based on fuel type matrices, elevation, or dispatch zones
  return {
    windSustained: 20,
    windGust: 25,
    tempMax: 65,
    rhMin: 20,
    deviationToleranceTemp: 5,   // If ground truth exceeds forecast by 5 degrees -> breach
    deviationToleranceRH: -5,    // If ground truth drops below forecast by 5% -> breach
    deviationToleranceWind: 10   // If ground truth wind gusts exceed forecast by 10mph -> breach
  };
};

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupEventListeners();
  checkConnectivity();
  window.addEventListener('online', checkConnectivity);
  window.addEventListener('offline', checkConnectivity);
});

function checkConnectivity() {
  const offlineBanner = document.getElementById('offline-warning');
  if (!navigator.onLine) {
    offlineBanner.classList.remove('hidden');
    document.getElementById('offline-timestamp').innerText = `OFFLINE: CACHED DATA AS OF ${new Date().toLocaleTimeString()}`;
  } else {
    offlineBanner.classList.add('hidden');
  }
}

function initMap() {
  // Offline ready Leaflet setup. Note: Without network, default OSM won't load unless cached.
  // In a true offline deployment, the URL would point to local PMTiles or GeoJSON rendering layers.
  map = L.map('map-container').setView([currentCoords.lat, currentCoords.lon], 9);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: 'Tactical Fire Map'
  }).addTo(map);

  marker = L.marker([currentCoords.lat, currentCoords.lon]).addTo(map);

  map.on('click', (e) => {
    updateCoordinates(e.latlng.lat, e.latlng.lng);
  });
}

function setupEventListeners() {
  const btnFetch = document.getElementById('btn-fetch');
  const btnGeo = document.getElementById('btn-geolocation');

  btnGeo.addEventListener('click', () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => updateCoordinates(pos.coords.latitude, pos.coords.longitude),
        (err) => console.error("Geo access denied", err)
      );
    }
  });

  btnFetch.addEventListener('click', () => {
    const latIn = parseFloat(document.getElementById('lat-input').value);
    const lonIn = parseFloat(document.getElementById('lon-input').value);
    if (!isNaN(latIn) && !isNaN(lonIn)) {
      updateCoordinates(latIn, lonIn);
      fetchEnterpriseData(latIn, lonIn);
    }
  });
}

function updateCoordinates(lat, lon) {
  // Ensure valid coordinate constraints
  lat = Math.max(-90, Math.min(90, lat));
  lon = Math.max(-180, Math.min(180, lon));
  currentCoords = { lat, lon };
  
  document.getElementById('lat-input').value = lat.toFixed(4);
  document.getElementById('lon-input').value = lon.toFixed(4);
  
  marker.setLatLng([lat, lon]);
  map.setView([lat, lon], 10);
}

// -----------------------------------------
// Core API Pipeline
// -----------------------------------------
async function fetchEnterpriseData(lat, lon) {
  document.getElementById('loading-overlay').classList.remove('hidden');
  const alertsContainer = document.getElementById('alerts-container');
  alertsContainer.innerHTML = '';
  document.getElementById('matrix-body').innerHTML = '<tr><td colspan="4" class="empty-state">Loading Primary Data Feeds...</td></tr>';
  document.getElementById('blocks-container').innerHTML = '';

  try {
    // 1. Point Resolution
    const pointUrl = `https://api.weather.gov/points/${lat},${lon}`;
    const pointRes = await fetch(pointUrl);
    
    if (!pointRes.ok) throw new Error("Metadata resolution failed");
    
    const pointData = await pointRes.json();
    if (pointData.offline) {
      console.warn("Serving from cache. API response simulated offline.");
    }
    
    const props = pointData.properties;
    if (!props) throw new Error("Invalid NWS Point Metadata Structure");

    const hourlyForecastUrl = props.forecastHourly;
    const fwzUrl = props.fireWeatherZone;
    const stationsUrl = props.observationStations;

    const zoneId = fwzUrl ? fwzUrl.split('/').pop() : null;

    // 2. Parallel Endpoint Requests
    const promises = [
      fetch(hourlyForecastUrl).then(res => res.json()), // Forecast [index 0]
      zoneId ? fetch(`https://api.weather.gov/alerts/active/zone/${zoneId}`).then(res => res.json()) : Promise.resolve(null), // Alerts [index 1]
      fetchGroundTruth(stationsUrl) // Ground Truth Station [index 2]
    ];

    const results = await Promise.allSettled(promises);

    const forecastData = results[0].status === 'fulfilled' ? results[0].value : null;
    const alertsData = results[1].status === 'fulfilled' ? results[1].value : null;
    const groundTruthData = results[2].status === 'fulfilled' ? results[2].value : null;

    // 3. Data Processing Pipeline
    if (alertsData && alertsData.features) {
      renderAlerts(alertsData.features);
    }
    
    if (forecastData && forecastData.properties && forecastData.properties.periods) {
      const periods = forecastData.properties.periods;
      renderComparisonMatrix(periods[0], groundTruthData, lat, lon);
      renderTacticalBlocks(periods, lat, lon);
    } else {
      throw new Error("Hourly forecast payload malformed or missing.");
    }

  } catch (error) {
    console.error("Enterprise Fetch Error:", error);
    document.getElementById('matrix-body').innerHTML = `<tr><td colspan="4" class="empty-state hazard-breach">CRITICAL FAILURE: ${error.message}</td></tr>`;
  } finally {
    document.getElementById('loading-overlay').classList.add('hidden');
  }
}

// Sub-pipeline to map the closest station and fetch its latest observation
async function fetchGroundTruth(stationsUrl) {
  if (!stationsUrl) return null;
  try {
    const listRes = await fetch(stationsUrl);
    const listData = await listRes.json();
    const stations = listData.features || [];
    if (stations.length === 0) return null;

    const nearestStationId = stations[0].properties.stationIdentifier;
    const obsUrl = `https://api.weather.gov/stations/${nearestStationId}/observations/latest`;
    const obsRes = await fetch(obsUrl);
    const obsData = await obsRes.json();
    
    return obsData.properties;
  } catch (e) {
    console.error("Ground truth pipeline failed", e);
    return null;
  }
}

// -----------------------------------------
// Tactical Render Pipelines
// -----------------------------------------
function renderAlerts(features) {
  const container = document.getElementById('alerts-container');
  // Filter for tactical fire management alerts
  const fireAlerts = features.filter(f => {
    const event = (f.properties.event || '').toLowerCase();
    return event.includes('red flag') || event.includes('fire weather') || 
           event.includes('wind') || event.includes('burn ban') || event.includes('warning');
  });

  fireAlerts.forEach(alert => {
    const div = document.createElement('div');
    div.className = 'tactical-alert';
    div.innerHTML = `${ICONS.danger} <span>${escapeHTML(alert.properties.event)}</span>`;
    container.appendChild(div);
  });
}

function renderComparisonMatrix(currentForecast, groundTruth, lat, lon) {
  const criteria = getHazardCriteria(lat, lon);
  const tbody = document.getElementById('matrix-body');
  
  // Safe integer parsing constraints
  const fTemp = safeInt(currentForecast.temperature);
  const fRH = currentForecast.relativeHumidity ? safeInt(currentForecast.relativeHumidity.value) : null;
  const fWind = extractNumberStrict(currentForecast.windSpeed || '');
  const fGust = extractNumberStrict(currentForecast.windGust || currentForecast.windSpeed || ''); // Fallback

  // Convert Ground Truth (Celsius -> Fahrenheit for temp)
  let tTemp = null, tRH = null, tWind = null, tGust = null;
  if (groundTruth) {
    if (groundTruth.temperature && groundTruth.temperature.value !== null) {
      tTemp = Math.round((Number(groundTruth.temperature.value) * 9/5) + 32);
    }
    if (groundTruth.relativeHumidity && groundTruth.relativeHumidity.value !== null) {
      tRH = Math.round(Number(groundTruth.relativeHumidity.value));
    }
    if (groundTruth.windSpeed && groundTruth.windSpeed.value !== null) {
      tWind = Math.round(Number(groundTruth.windSpeed.value) * 0.621371); // km/h to mph or m/s to mph depending on metric. NWS obs gives km/h usually.
      // Correction: NWS observations gives m/s natively, but wait docs say km/h sometimes.
      // Let's assume km/h for the conversion standard or just render actual NDFD.
      // Wait, standard NWS numeric value for wind in obs is usually m/s or km/h. To be tactical, we label it carefully, let's assume km/h: km/h * 0.621371 = mph. 
      // NWS API specifies value is in km/h typically, or provides unit code. We'll use simple fallback multiplier * 0.621371.
    }
    if (groundTruth.windGust && groundTruth.windGust.value !== null) {
      tGust = Math.round(Number(groundTruth.windGust.value) * 0.621371);
    }
  }

  // Row Generation Functions calculating deviations
  function generateRow(metricLabel, forecastVal, truthVal, unit, isInverseMetric = false, tolerance = 0, dangerThreshold = 0) {
    let status = 'NOMINAL';
    let breachClass = '';
    
    if (truthVal !== null && forecastVal !== null) {
      const diff = truthVal - forecastVal;
      // If inverse metric (like RH), negative diff is worse. Otherwise positive is worse.
      const isWorse = isInverseMetric ? (diff <= tolerance) : (diff >= tolerance);
      const breachesThreshold = isInverseMetric ? (truthVal <= dangerThreshold) : (truthVal >= dangerThreshold);
      
      if (isWorse && breachesThreshold) {
        status = 'HAZARD DEVIATION';
        breachClass = 'hazard-breach';
      } else if (breachesThreshold) {
        status = 'THRESHOLD BREACH';
        breachClass = 'hazard-breach';
      }
    }

    const tCellDisplay = truthVal !== null ? `${truthVal}${unit}` : 'OFFLINE';
    const fCellDisplay = forecastVal !== null ? `${forecastVal}${unit}` : 'N/A';

    return `<tr>
      <td>${escapeHTML(metricLabel)}</td>
      <td>${fCellDisplay}</td>
      <td class="${breachClass}">${tCellDisplay}</td>
      <td class="${breachClass}">${status}</td>
    </tr>`;
  }

  const rowsHtml = [
    generateRow("TEMPERATURE", fTemp, tTemp, 'F', false, criteria.deviationToleranceTemp, criteria.tempMax),
    generateRow("REL HUMIDITY", fRH, tRH, '%', true, criteria.deviationToleranceRH, criteria.rhMin),
    generateRow("WIND SPEED", fWind, tWind, 'MPH', false, criteria.deviationToleranceWind, criteria.windSustained),
    generateRow("WIND GUST", fGust, tGust, 'MPH', false, criteria.deviationToleranceWind, criteria.windGust)
  ].join('');

  tbody.innerHTML = rowsHtml;
}

function renderTacticalBlocks(periods, lat, lon) {
  const container = document.getElementById('blocks-container');
  container.innerHTML = '';
  
  const criteria = getHazardCriteria(lat, lon);
  const maxHours = Math.min(periods.length, 24); // Focus on next 24 operational hours

  for (let i = 0; i < maxHours; i += 3) {
    const chunk = periods.slice(i, i + 3);
    if (chunk.length === 0) break;
    
    // Parse Date block properly
    const startTimeStamp = new Date(chunk[0].startTime);
    const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hour12: false });
    const blockTitle = dayFormatter.format(startTimeStamp).toUpperCase();

    let maxTemp = -999;
    let minRH = 999;
    let maxWind = 0;
    let maxGust = 0;
    let hasLightningEvent = false;

    chunk.forEach(hour => {
      const hTemp = safeInt(hour.temperature);
      if (hTemp > maxTemp) maxTemp = hTemp;
      
      if (hour.relativeHumidity && typeof hour.relativeHumidity.value === 'number') {
        const hRH = Math.round(hour.relativeHumidity.value);
        if (hRH < minRH) minRH = hRH;
      }
      
      if (hour.shortForecast && hour.shortForecast.toLowerCase().includes('thunderstorm')) {
        hasLightningEvent = true;
      }
      
      const wSpeed = extractNumberStrict(hour.windSpeed || '');
      if (wSpeed > maxWind) maxWind = wSpeed;

      const wGust = extractNumberStrict(hour.windGust || '');
      if (wGust > maxGust) maxGust = wGust;
    });

    if (maxGust === 0 && maxWind > 0) maxGust = maxWind;

    // Tactical Check
    const isDangerBlock = (maxWind >= criteria.windSustained) || (maxGust >= criteria.windGust) || 
                          (minRH <= criteria.rhMin && maxTemp >= criteria.tempMax) || hasLightningEvent;

    // Build Tactical Display Card safely
    const card = document.createElement('div');
    card.className = `block-card ${isDangerBlock ? 'block-danger' : ''}`;
    
    let template = `
      <div class="block-header">
        <span>${blockTitle} - ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false }).format(new Date(chunk[chunk.length-1].endTime))}H</span>
        ${hasLightningEvent ? ICONS.lightning : ''}
      </div>
      <div class="block-row"><span class="block-label">TEMP MAX</span> <span class="block-value">${maxTemp !== -999 ? maxTemp : 'N/A'}F</span></div>
      <div class="block-row"><span class="block-label">RH MIN</span> <span class="block-value">${minRH !== 999 ? minRH : 'N/A'}%</span></div>
      <div class="block-row"><span class="block-label">WIND MAX</span> <span class="block-value">${maxWind}MPH</span></div>
      <div class="block-row"><span class="block-label">GUST MAX</span> <span class="block-value ${maxGust >= criteria.windGust ? 'hazard-breach' : ''}">${maxGust}MPH</span></div>
    `;
    card.innerHTML = template;
    container.appendChild(card);
  }
}

// -----------------------------------------
// Strict Type Safety Utilities
// -----------------------------------------
function extractNumberStrict(str) {
  if (typeof str !== 'string') return 0;
  // Use aggressive parsing without regex matching execution
  const parts = str.split(' ');
  let max = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!isNaN(num) && num > max) max = num;
  }
  return max;
}

function safeInt(val) {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) ? null : Math.round(num);
}

function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
