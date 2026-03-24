// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW Registration failed:', err);
    });
  });
}

// Icons Set (SVG strings exclusively)
const ICONS = {
  danger: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  lightning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  chevron: `<svg class="chevron-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`
};

// Global State
let map;
let marker;
let currentCoords = { lat: 37.1995, lon: -105.4236 };
let currentFuelType = 'Brush';
let currentForecastPeriods = [];

// Threat Numerics
const THREAT_LEVELS = {
  1: { id: "low", label: "LOW" },
  2: { id: "elevated", label: "ELEVATED" },
  3: { id: "escalated", label: "ESCALATED" },
  4: { id: "extreme", label: "EXTREME" }
};

document.addEventListener('DOMContentLoaded', () => {
  enforceOperationalDisclaimer();
  initMap();
  setupEventListeners();
  checkConnectivity();
  window.addEventListener('online', checkConnectivity);
  window.addEventListener('offline', checkConnectivity);
});

// -----------------------------------------
// 1. Gatekeeper Logic
// -----------------------------------------
function enforceOperationalDisclaimer() {
  const modal = document.getElementById('disclaimer-modal');
  const btnAccept = document.getElementById('btn-accept-disclaimer');
  
  const lastAcceptedStr = localStorage.getItem('disclaimerAcceptedTimestamp');
  let requireAcceptance = true;
  
  if (lastAcceptedStr) {
    const lastAccepted = Number(lastAcceptedStr);
    const now = Date.now();
    const hoursSinceAccept = (now - lastAccepted) / (1000 * 60 * 60);
    if (hoursSinceAccept < 24) {
      requireAcceptance = false;
    }
  }

  if (requireAcceptance) {
    modal.classList.remove('hidden');
  }

  btnAccept.addEventListener('click', () => {
    localStorage.setItem('disclaimerAcceptedTimestamp', Date.now().toString());
    modal.classList.add('hidden');
  });
}

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
  map = L.map('map-container').setView([currentCoords.lat, currentCoords.lon], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: 'Tactical Fire Map'
  }).addTo(map);

  marker = L.marker([currentCoords.lat, currentCoords.lon]).addTo(map);
  map.on('click', (e) => updateCoordinates(e.latlng.lat, e.latlng.lng));
}

function setupEventListeners() {
  const btnFetch = document.getElementById('btn-fetch');
  const btnGeo = document.getElementById('btn-geolocation');
  const fuelInputs = document.querySelectorAll('input[name="fuel-type"]');
  const btnToggleManual = document.getElementById('btn-toggle-manual');
  const manualContainer = document.getElementById('manual-input-container');

  btnToggleManual.addEventListener('click', () => {
    manualContainer.classList.toggle('hidden');
    if (manualContainer.classList.contains('hidden')) {
      btnToggleManual.innerText = "+ ENTER COORDINATES MANUALLY";
    } else {
      btnToggleManual.innerText = "- HIDE MANUAL COORDINATES";
    }
  });

  btnGeo.addEventListener('click', () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => updateCoordinates(pos.coords.latitude, pos.coords.longitude),
        (err) => console.error("Geo access denied", err)
      );
    }
  });

  btnFetch.addEventListener('click', () => {
    const latInput = document.getElementById('lat-input');
    const lonInput = document.getElementById('lon-input');
    const latVal = parseFloat(latInput.value);
    const lonVal = parseFloat(lonInput.value);

    // Validation Logic
    if (isNaN(latVal) || isNaN(lonVal) || latVal < -90 || latVal > 90 || lonVal < -180 || lonVal > 180) {
      triggerFormError(btnFetch, latInput, lonInput);
      return;
    }

    updateCoordinates(latVal, lonVal);
    fetchEnterpriseData(latVal, lonVal);
  });

  fuelInputs.forEach(input => {
    input.addEventListener('change', (e) => {
      currentFuelType = e.target.value;
      if (currentForecastPeriods.length > 0) {
        renderTacticalBlocks(currentForecastPeriods);
      }
    });
  });
}

function triggerFormError(btn, latInput, lonInput) {
  btn.classList.add('btn-error', 'shake');
  latInput.classList.add('input-error', 'shake');
  lonInput.classList.add('input-error', 'shake');
  
  const originalText = btn.innerHTML;
  btn.innerHTML = 'ERROR: ENTER VALID COORDINATES';
  
  setTimeout(() => {
    btn.classList.remove('btn-error', 'shake');
    latInput.classList.remove('input-error', 'shake');
    lonInput.classList.remove('input-error', 'shake');
    btn.innerHTML = originalText;
  }, 3000);
}

function updateCoordinates(lat, lon) {
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
  
  const telemetryZoneEl = document.getElementById('telemetry-zone');
  const telemetryStationEl = document.getElementById('telemetry-station');
  document.getElementById('telemetry-metadata').classList.add('hidden');
  
  telemetryZoneEl.innerText = "FORECAST ZONE: PENDING";
  telemetryStationEl.innerText = "OBSERVATION STATION: PENDING";

  try {
    const pointUrl = `https://api.weather.gov/points/${lat},${lon}`;
    const pointRes = await fetch(pointUrl);
    
    if (!pointRes.ok) throw new Error("Metadata resolution failed");
    
    const pointData = await pointRes.json();
    const props = pointData.properties;
    if (!props) throw new Error("Invalid NWS Point Metadata Structure");

    const hourlyForecastUrl = props.forecastHourly;
    const fwzUrl = props.fireWeatherZone;
    const stationsUrl = props.observationStations;
    const zoneId = fwzUrl ? fwzUrl.split('/').pop() : null;

    // Parallel Sub-Pipelines
    const promises = [
      fetch(hourlyForecastUrl).then(res => res.json()),
      zoneId ? fetch(`https://api.weather.gov/alerts/active/zone/${zoneId}`).then(res => res.json()) : Promise.resolve(null),
      fetchGroundTruth(stationsUrl),
      fwzUrl ? fetch(fwzUrl).then(res => res.json()) : Promise.resolve(null) // Fetch Zone Metadata
    ];

    const results = await Promise.allSettled(promises);

    const forecastData = results[0].status === 'fulfilled' ? results[0].value : null;
    const alertsData = results[1].status === 'fulfilled' ? results[1].value : null;
    const groundTruthResult = results[2].status === 'fulfilled' ? results[2].value : null;
    const zoneData = results[3].status === 'fulfilled' ? results[3].value : null;

    // Extract Context Data
    const groundTruthData = groundTruthResult ? groundTruthResult.obsData : null;
    const stationName = groundTruthResult ? groundTruthResult.stationName : "UNKNOWN";
    const zoneName = zoneData && zoneData.properties ? zoneData.properties.name : (zoneId || "UNKNOWN");

    // Re-bind Telemetry
    telemetryZoneEl.innerText = `FORECAST ZONE: ${zoneName.toUpperCase()}`;
    telemetryStationEl.innerText = `OBSERVATION STATION: ${stationName.toUpperCase()}`;
    document.getElementById('telemetry-metadata').classList.remove('hidden');

    if (alertsData && alertsData.features) {
      renderAlerts(alertsData.features);
    }
    
    if (forecastData && forecastData.properties && forecastData.properties.periods) {
      currentForecastPeriods = forecastData.properties.periods;
      renderComparisonMatrix(currentForecastPeriods[0], groundTruthData);
      renderTacticalBlocks(currentForecastPeriods);
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

async function fetchGroundTruth(stationsUrl) {
  if (!stationsUrl) return null;
  try {
    const listRes = await fetch(stationsUrl);
    const listData = await listRes.json();
    const stations = listData.features || [];
    if (stations.length === 0) return null;

    const nearestStation = stations[0];
    const nearestStationId = nearestStation.properties.stationIdentifier;
    const stationName = nearestStation.properties.name || nearestStationId;

    const obsUrl = `https://api.weather.gov/stations/${nearestStationId}/observations/latest`;
    const obsRes = await fetch(obsUrl);
    const obsData = await obsRes.json();
    
    return {
      obsData: obsData.properties,
      stationName: stationName
    };
  } catch (e) {
    console.error("Ground truth pipeline failed", e);
    return null;
  }
}

// -----------------------------------------
// Utility: Fine Dead Fuel Moisture & Drivers
// -----------------------------------------
function calculateFDFM(tempF, rh) {
  let rhClamped = Math.max(0, Math.min(100, rh));
  let m = 0;
  if (rhClamped < 10) {
    m = 0.03229 + 0.281073 * rhClamped - 0.000578 * rhClamped * tempF;
  } else if (rhClamped < 50) {
    m = 2.22749 + 0.160107 * rhClamped - 0.01478 * tempF;
  } else {
    m = 21.0606 + 0.005565 * (rhClamped * rhClamped) - 0.00035 * rhClamped * tempF - 0.483199 * rhClamped;
  }
  return Math.max(1, Math.round(m));
}

function evaluateThreatTier(temp, rh, gust, fdfm) {
  let tempTier = 1;
  if (temp >= 90) tempTier = 4;
  else if (temp >= 80) tempTier = 3;
  else if (temp >= 70) tempTier = 2;

  let rhTier = 1;
  if (rh <= 15) rhTier = 4;
  else if (rh <= 24) rhTier = 3;
  else if (rh <= 40) rhTier = 2;

  let gustTier = 1;
  if (gust >= 40) gustTier = 4;
  else if (gust >= 26) gustTier = 3;
  else if (gust >= 15) gustTier = 2;

  let fdfmTier = 1;
  if (fdfm <= 5) fdfmTier = 4;
  else if (fdfm <= 8) fdfmTier = 3;
  else if (fdfm <= 12) fdfmTier = 2;

  return {
    temp: tempTier,
    rh: rhTier,
    gust: gustTier,
    fdfm: fdfmTier,
    max: Math.max(rhTier, gustTier, fdfmTier)
  };
}

// Four-Part Text Synthesis Matrix
function generateSynthesisText(tiers, fuelType) {
  const tempMsg = {
    1: "Temperatures are low, minimizing pre-heating of fuels.",
    2: "Moderate temperatures are slightly increasing fuel pre-heating.",
    3: "Elevated temperatures are actively pre-heating the fuel bed.",
    4: "Extreme temperatures are critically pre-heating fuels and lowering ignition resistance."
  };
  
  const rhMsg = {
    1: "Moderate RH is allowing fine fuels to recover moisture.",
    2: "Lowering RH is beginning to slowly desiccate fine fuels.",
    3: "Low RH is accelerating fine fuel drying and increasing ignition probability.",
    4: "Critically low RH is driving rapid fine fuel desiccation and intense burning conditions."
  };

  const gustMsg = {
    1: "Light winds will limit fire spread primarily to topographical influences.",
    2: "Moderate wind gusts may increase surface spread rates.",
    3: "Strong wind gusts will drive active head fire spread and possible short-range spotting.",
    4: "Extreme wind gusts will drive rapid rates of spread and cause long-range spotting."
  };

  const fdfmMsg = {
    "Grass": {
      1: "1-Hr fuel moisture remains high, resisting ignition and spread in grassy fuels.",
      2: "Curing grass fuels are becoming receptive to ignition.",
      3: "Dry fine fuels in this grass model will support rapid rates of spread.",
      4: "Critically dry fine fuels in this grass model will support nearly instantaneous ignition and rapid transition to the primary carrier."
    },
    "Brush": {
      1: "Heavy fuel moistures are resisting persistent ignition.",
      2: "Surface litter provides isolated ignition points beneath the canopy.",
      3: "Receptive dry brush will support active fire with group torching.",
      4: "Critically dry brush stands will support intense fire behavior, sustained crown runs, and short-range spotting."
    },
    "Timber": {
      1: "Surface spread is confined largely to duff and heavy litter layers.",
      2: "Occasional single-tree torching is possible in unburned canopies.",
      3: "Dry ladder fuels will assist fire transitioning into the canopy.",
      4: "Severely dry timber profiles threaten independent crowning, extreme resistance to control, and long-range spotting."
    }
  };

  return `
    <ul style="padding-left: 1.25rem;">
      <li style="margin-bottom: 0.5rem;">${tempMsg[tiers.temp]}</li>
      <li style="margin-bottom: 0.5rem;">${rhMsg[tiers.rh]}</li>
      <li style="margin-bottom: 0.5rem;">${gustMsg[tiers.gust]}</li>
      <li style="margin-bottom: 0.5rem;">${fdfmMsg[fuelType][tiers.fdfm]}</li>
    </ul>
  `;
}

// -----------------------------------------
// Tactical Render Pipelines
// -----------------------------------------
function renderAlerts(features) {
  const container = document.getElementById('alerts-container');
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

function renderComparisonMatrix(currentForecast, groundTruth) {
  const tbody = document.getElementById('matrix-body');
  
  const fTemp = safeInt(currentForecast.temperature);
  const fRH = currentForecast.relativeHumidity ? safeInt(currentForecast.relativeHumidity.value) : null;
  const fGust = extractNumberStrict(currentForecast.windGust || currentForecast.windSpeed || '');

  let tTemp = null, tRH = null, tGust = null;
  if (groundTruth) {
    if (groundTruth.temperature && groundTruth.temperature.value !== null) {
      tTemp = Math.round((Number(groundTruth.temperature.value) * 9/5) + 32);
    }
    if (groundTruth.relativeHumidity && groundTruth.relativeHumidity.value !== null) {
      tRH = Math.round(Number(groundTruth.relativeHumidity.value));
    }
    if (groundTruth.windGust && groundTruth.windGust.value !== null) {
      tGust = Math.round(Number(groundTruth.windGust.value) * 0.621371);
    }
  }

  function generateRow(metricLabel, forecastVal, truthVal, unit, isInverseMetric, tolerance, dangerThreshold) {
    let status = 'NOMINAL';
    let breachClass = '';
    
    if (truthVal !== null && forecastVal !== null) {
      const diff = truthVal - forecastVal;
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
    generateRow("TEMPERATURE", fTemp, tTemp, 'F', false, 5, 85),
    generateRow("REL HUMIDITY", fRH, tRH, '%', true, -5, 20),
    generateRow("WIND GUST", fGust, tGust, 'MPH', false, 10, 25)
  ].join('');

  tbody.innerHTML = rowsHtml;
}

function renderTacticalBlocks(periods) {
  const container = document.getElementById('blocks-container');
  container.innerHTML = '';
  
  const maxHours = Math.min(periods.length, 24); 

  for (let i = 0; i < maxHours; i += 3) {
    const chunk = periods.slice(i, i + 3);
    if (chunk.length === 0) break;
    
    let maxTemp = -999;
    let minRH = 999;
    let maxWind = 0;
    let maxGust = 0;

    chunk.forEach(hour => {
      const hTemp = safeInt(hour.temperature);
      if (hTemp > maxTemp) maxTemp = hTemp;
      
      if (hour.relativeHumidity && typeof hour.relativeHumidity.value === 'number') {
        const hRH = Math.round(hour.relativeHumidity.value);
        if (hRH < minRH) minRH = hRH;
      }
      
      const wSpeed = extractNumberStrict(hour.windSpeed || '');
      if (wSpeed > maxWind) maxWind = wSpeed;

      const wGust = extractNumberStrict(hour.windGust || '');
      if (wGust > maxGust) maxGust = wGust;
    });

    if (maxGust === 0 && maxWind > 0) maxGust = maxWind;
    if (minRH === 999) minRH = 25; 
    if (maxTemp === -999) maxTemp = 65; 

    const calculatedFDFM = calculateFDFM(maxTemp, minRH);
    
    // Matrix Evaluation
    const tiers = evaluateThreatTier(maxTemp, minRH, maxGust, calculatedFDFM);
    const blockThreatSeverity = tiers.max;
    const threatDef = THREAT_LEVELS[blockThreatSeverity];

    // Behavior Text Routing Generation (4-part)
    const behaviorTextHtml = generateSynthesisText(tiers, currentFuelType);

    // Parsing Time Label
    const startTimeStamp = new Date(chunk[0].startTime);
    const endTimeStamp = new Date(chunk[chunk.length-1].endTime);
    const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hour12: false });
    const blockTitle = `${dayFormatter.format(startTimeStamp)} - ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false }).format(endTimeStamp)}`;

    const card = document.createElement('div');
    // We add 'expanded' strictly to index 0 dynamically rendering opened
    card.className = `block-card hazard-${threatDef.id} ${i === 0 ? 'expanded' : ''}`;
    
    const template = `
      <div class="block-header">
        <div class="block-header-title">
          <span>${blockTitle.toUpperCase()}</span>
          ${ICONS.chevron}
        </div>
        <span>${threatDef.label}</span>
      </div>
      <div class="block-row"><span class="block-label">TEMP MAX</span> <span class="block-value text-tier-${tiers.temp}">${maxTemp}F</span></div>
      <div class="block-row"><span class="block-label">RH MIN</span> <span class="block-value text-tier-${tiers.rh}">${minRH}%</span></div>
      <div class="block-row"><span class="block-label">GUST MAX</span> <span class="block-value text-tier-${tiers.gust}">${maxGust}MPH</span></div>
      <div class="block-row"><span class="block-label">1-HR FDFM</span> <span class="block-value text-tier-${tiers.fdfm}">${calculatedFDFM}%</span></div>
      
      <div class="expected-behavior">
        <strong style="color:var(--text-active); display:block; margin-bottom: 0.5rem; text-transform:uppercase; border-bottom:1px solid var(--border-muted); padding-bottom:0.25rem;">SYNTHESIS (${currentFuelType})</strong>
        ${behaviorTextHtml}
      </div>
    `;
    
    card.innerHTML = template;

    // Accordion interaction
    card.addEventListener('click', () => {
      const isExpanded = card.classList.contains('expanded');
      document.querySelectorAll('.block-card').forEach(c => c.classList.remove('expanded'));
      if (!isExpanded) {
        card.classList.add('expanded');
      }
    });

    container.appendChild(card);
  }
}

// -----------------------------------------
// Strict Type Safety Utilities
// -----------------------------------------
function extractNumberStrict(str) {
  if (typeof str !== 'string') return 0;
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
