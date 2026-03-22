// Fire Weather Hazard Thresholds
const hazardCriteria = {
  windSustained: { threshold: 20 }, // mph
  windGust: { threshold: 25 },      // mph (critical for spot fires)
  temp: { threshold: 65 },          // °F
  rh: { threshold: 20 }             // %
};

// Scalable Configuration for San Luis Valley Counties
const regions = {
  "Costilla": [
    { name: "San Luis", lat: 37.1995, lon: -105.4236 },
    { name: "Garcia", lat: 37.0001, lon: -105.6000 },
    { name: "Fort Garland", lat: 37.5111, lon: -105.4381 },
    { name: "Blanca", lat: 37.4395, lon: -105.5192 }
  ],
  "Alamosa": [
    { name: "Alamosa (City)", lat: 37.4694, lon: -105.8700 },
    { name: "Great Sand Dunes", lat: 37.7328, lon: -105.5121 },
    { name: "Hooper", lat: 37.7419, lon: -105.8761 }
  ],
  "Conejos": [
    { name: "Conejos (Town)", lat: 37.0886, lon: -106.0189 },
    { name: "Antonito", lat: 37.0789, lon: -106.0086 },
    { name: "Manassa", lat: 37.1728, lon: -105.9372 },
    { name: "Platoro", lat: 37.3514, lon: -106.5361 }
  ],
  "Rio Grande": [
    { name: "Del Norte", lat: 37.6789, lon: -106.3531 },
    { name: "Monte Vista", lat: 37.5794, lon: -106.1464 },
    { name: "South Fork", lat: 37.6706, lon: -106.6397 }
  ],
  "Saguache": [
    { name: "Saguache (Town)", lat: 38.0872, lon: -106.1420 },
    { name: "Center", lat: 37.7525, lon: -106.1086 },
    { name: "Crestone", lat: 37.9958, lon: -105.6997 }
  ],
  "Mineral": [
    { name: "Creede", lat: 37.8494, lon: -106.9255 },
    { name: "Wolf Creek Pass", lat: 37.4722, lon: -106.7995 }
  ]
};

document.addEventListener('DOMContentLoaded', () => {
  setupRegionSelect();
  setupChecklistToggle();

  // Load Costilla -> San Luis as default starting point
  const defaultRegion = "Costilla";
  const defaultLocation = regions[defaultRegion][0];
  document.getElementById('county-select').value = defaultRegion;
  populateLocationList(defaultRegion, defaultLocation);
});

function setupChecklistToggle() {
  const toggleBtn = document.getElementById('toggle-checklist-btn');
  const checklist = document.getElementById('burn-checklist');
  toggleBtn.addEventListener('click', () => {
    const isHidden = checklist.classList.contains('hidden');
    if (isHidden) {
      checklist.classList.remove('hidden');
      toggleBtn.innerText = 'Hide Checklist';
    } else {
      checklist.classList.add('hidden');
      toggleBtn.innerText = 'Safety Checklist';
    }
  });
}

function setupRegionSelect() {
  const select = document.getElementById('county-select');
  Object.keys(regions).forEach(county => {
    const opt = document.createElement('option');
    opt.value = county;
    opt.innerHTML = `${county} County`;
    select.appendChild(opt);
  });

  select.addEventListener('change', (e) => {
    const county = e.target.value;
    populateLocationList(county, regions[county][0]);
  });
}

function populateLocationList(county, defaultLocToSelect) {
  const locList = document.getElementById('location-list');
  locList.innerHTML = '';

  regions[county].forEach(loc => {
    const btn = document.createElement('div');
    btn.className = 'location-item';
    btn.innerHTML = `<span>${loc.name}</span> <span style="font-size:0.8em; color:var(--text-secondary)">Load ➔</span>`;
    btn.onclick = () => {
      // Set active state styling
      document.querySelectorAll('.location-item').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      selectLocation(loc);
    };
    locList.appendChild(btn);
  });

  // Auto-select first/default location
  const firstChild = locList.firstChild;
  if(firstChild) {
    firstChild.classList.add('active');
    selectLocation(defaultLocToSelect);
  }
}

async function selectLocation(loc) {
  document.getElementById('selected-town-name').innerText = `${loc.name} Forecast Area`;
  
  const blocksGrid = document.getElementById('blocks-grid');
  blocksGrid.innerHTML = `
    <div style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; padding: 2rem;">
      <div class="loading-spinner"></div>
      <span style="margin-left: 1rem;">Resolving NWS Fire Weather Zone & Data...</span>
    </div>
  `;

  document.getElementById('burn-advisory-banner').className = 'burn-advisory-banner hidden';
  document.getElementById('nws-alerts-container').innerHTML = '';
  document.getElementById('toggle-checklist-btn').classList.add('hidden');

  try {
    // 1. Fetch NWS Point Data to find the exact Fire Weather Zone ID and Hourly URL
    const pointRes = await fetch(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
    const pointData = await pointRes.json();
    const hourlyUrl = pointData.properties.forecastHourly;
    const fwzUrl = pointData.properties.fireWeatherZone; // e.g., "https://api.weather.gov/zones/fire/COZ229"

    // Extract Zone ID (e.g. COZ229) from the URL
    const zoneId = fwzUrl ? fwzUrl.split('/').pop() : null;

    // 2. Fetch Zone-based Alerts (Much more accurate than Point-based)
    let isRedFlag = false;
    let alertsContainer = document.getElementById('nws-alerts-container');
    
    if (zoneId) {
      const alertsRes = await fetch(`https://api.weather.gov/alerts/active/zone/${zoneId}`);
      const alertsData = await alertsRes.json();
      const alerts = alertsData.features || [];

      const fireAlerts = alerts.filter(f => {
        const event = (f.properties.event || '').toLowerCase();
        return event.includes('red flag') || 
               event.includes('fire weather') ||
               event.includes('wind') ||
               event.includes('extreme') ||
               event.includes('burn ban') ||
               event.includes('fire warning');
      });

      isRedFlag = fireAlerts.some(f => f.properties.event.toLowerCase().includes('red flag'));

      fireAlerts.forEach(alert => {
        const div = document.createElement('div');
        div.className = 'nws-alert';
        div.innerHTML = `⚠️ <span>${alert.properties.event}</span>`;
        div.title = alert.properties.instruction || alert.properties.description || '';
        alertsContainer.appendChild(div);
      });
    }

    // 3. Fetch Hourly Forecast
    const hourlyRes = await fetch(hourlyUrl);
    const hourlyData = await hourlyRes.json();
    
    // 4. Process into 3-hour blocks
    const periods = hourlyData.properties.periods;
    const blocks = processThreeHourBlocks(periods);

    // Analyze next 12 hours (4 blocks) for base advisory logic
    const nearTerm = blocks.slice(0, 4);
    let highestNearWind = 0;
    let highestNearGust = 0;
    let lowestNearRH = 100;
    let highestNearTemp = 0;
    let hasNearTermThunderstorms = false;

    nearTerm.forEach(b => {
      if (b.maxWind > highestNearWind) highestNearWind = b.maxWind;
      if (b.maxGust > highestNearGust) highestNearGust = b.maxGust;
      if (b.minRH < lowestNearRH) lowestNearRH = b.minRH;
      if (b.maxTemp > highestNearTemp) highestNearTemp = b.maxTemp;
      if (b.hasThunderstorms) hasNearTermThunderstorms = true;
    });

    // Advisory Logic
    let advisoryLevel = 'safe';
    let advisoryTitle = 'Conditions appear generaly safe.';
    let advisoryMessage = 'Burn with caution. Ensure you have clearance from dispatch.';

    // Base conditions checks
    const hasTemperatureAndRH = (lowestNearRH <= hazardCriteria.rh.threshold && highestNearTemp >= hazardCriteria.temp.threshold);
    const hasHighSustainedWinds = highestNearWind >= hazardCriteria.windSustained.threshold;
    const hasDangerousGusts = highestNearGust >= hazardCriteria.windGust.threshold;

    if (isRedFlag) {
      advisoryLevel = 'danger';
      advisoryTitle = 'CRITICAL DANGER: DO NOT BURN';
      advisoryMessage = 'A Red Flag Warning is active for this Fire Weather Zone. Open burning is highly dangerous and prohibited. Do not ignite any fires.';
    } else if (hasHighSustainedWinds || hasTemperatureAndRH || hasDangerousGusts || hasNearTermThunderstorms) {
      advisoryLevel = 'danger';
      advisoryTitle = 'DANGER: DO NOT BURN';
      advisoryMessage = `Hazardous fire behavior expected. `;
      if (hasDangerousGusts) advisoryMessage += `Gusts up to ${highestNearGust} mph expected. `;
      else if (hasHighSustainedWinds) advisoryMessage += `Sustained winds up to ${highestNearWind} mph expected. `;
      if (hasNearTermThunderstorms) advisoryMessage += `Dry lightning and erratic downdraft winds likely from expected thunderstorms. `;
      if (hasTemperatureAndRH) advisoryMessage += `Critical fuel drying conditions (RH ${lowestNearRH}%, ${highestNearTemp}°F). `;
      
      advisoryMessage += 'Burning is strongly discouraged.';
    } else if (highestNearWind >= 15 || highestNearGust >= 20 || lowestNearRH <= 25) {
      advisoryLevel = 'caution';
      advisoryTitle = 'ELEVATED RISK: Use Extreme Caution';
      advisoryMessage = `Conditions are marginal (Winds ${highestNearWind}mph, Gusts ${highestNearGust}mph). If you must burn, monitor the wind closely and keep tools/water ready. Call dispatch prior to ignition.`;
    }

    renderAdvisoryBanner(advisoryLevel, advisoryTitle, advisoryMessage);
    renderBlocksGrid(blocks);

  } catch (error) {
    console.error("Error fetching data:", error);
    blocksGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2rem; color: #fca5a5; text-align: center;">
        <p>⚠️ Failed to load weather data from the National Weather Service.</p>
        <p style="font-size: 0.85rem;">Please check your connection or try again later.</p>
      </div>
    `;
  }
}

function processThreeHourBlocks(periods) {
  const maxHours = Math.min(periods.length, 48);
  const blocks = [];
  
  for (let i = 0; i < maxHours; i += 3) {
    const chunk = periods.slice(i, i + 3);
    if (chunk.length === 0) break;
    
    // Initial Block Date/Time string
    const startTime = new Date(chunk[0].startTime);
    const endTime = new Date(chunk[chunk.length - 1].endTime);
    
    const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
    const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });
    
    const isToday = startTime.toDateString() === new Date().toDateString();
    const dayStr = isToday ? 'Today' : dayFormatter.format(startTime);
    const timeStr = `${timeFormatter.format(startTime).replace(' ', '').toLowerCase()} - ${timeFormatter.format(endTime).replace(' ', '').toLowerCase()}`;
    const blockTitle = `${dayStr}  ${timeStr}`;

    let maxTemp = -999;
    let minRH = 999;
    let maxWind = 0;
    let maxGust = 0;
    let maxPoP = 0;
    let hasThunderstorms = false;

    chunk.forEach(hour => {
      // Temp
      if (hour.temperature > maxTemp) maxTemp = hour.temperature;
      
      // RH
      if (hour.relativeHumidity && hour.relativeHumidity.value !== null) {
        if (hour.relativeHumidity.value < minRH) {
          minRH = hour.relativeHumidity.value;
        }
      }

      // PoP
      if (hour.probabilityOfPrecipitation && hour.probabilityOfPrecipitation.value !== null) {
        if (hour.probabilityOfPrecipitation.value > maxPoP) {
          maxPoP = hour.probabilityOfPrecipitation.value;
        }
      }

      // Thunderstorms in Forecast?
      if (hour.shortForecast && hour.shortForecast.toLowerCase().includes('thunderstorm')) {
        hasThunderstorms = true;
      }
      
      // Wind Speed ("15 mph" or "10 to 15 mph")
      const windSpeedStr = hour.windSpeed || "0";
      const wMatches = windSpeedStr.match(/\d+/g);
      if (wMatches) {
        wMatches.forEach(m => {
          const val = parseInt(m, 10);
          if (val > maxWind) maxWind = val;
        });
      }

      // Wind Gusts
      const windGustStr = hour.windGust || "0";
      const gMatches = windGustStr.match(/\d+/g);
      if (gMatches) {
        gMatches.forEach(m => {
          const val = parseInt(m, 10);
          if (val > maxGust) maxGust = val;
        });
      }
    });

    // If API didn't provide gusts, but sustained winds are high, assume gust is at least sustained
    if (maxGust < maxWind) maxGust = maxWind;

    const isDangerous = (maxWind >= hazardCriteria.windSustained.threshold) || 
                        (maxGust >= hazardCriteria.windGust.threshold) ||
                        (minRH <= hazardCriteria.rh.threshold && maxTemp >= hazardCriteria.temp.threshold);
    
    const isExtreme = hasThunderstorms || (maxGust >= 35); // Add an extreme tier for visuals

    blocks.push({
      title: blockTitle,
      maxTemp,
      minRH: minRH === 999 ? 'N/A' : minRH,
      maxWind,
      maxGust,
      maxPoP,
      hasThunderstorms,
      isDangerous,
      isExtreme
    });
  }

  return blocks;
}

function renderAdvisoryBanner(level, title, message) {
  const banner = document.getElementById('burn-advisory-banner');
  const icon = document.getElementById('advisory-icon');
  const titleEl = document.getElementById('advisory-title');
  const msgEl = document.getElementById('advisory-message');
  const checklistBtn = document.getElementById('toggle-checklist-btn');

  banner.className = `burn-advisory-banner status-${level}`;
  
  if (level === 'danger') {
    icon.innerText = '🚫';
    checklistBtn.classList.add('hidden'); 
    document.getElementById('burn-checklist').classList.add('hidden');
    checklistBtn.innerText = 'Safety Checklist';
  } else if (level === 'caution') {
    icon.innerText = '⚠️';
    checklistBtn.classList.remove('hidden');
  } else {
    icon.innerText = '✅';
    checklistBtn.classList.remove('hidden');
  }

  titleEl.innerText = title;
  msgEl.innerText = message;
}

function renderBlocksGrid(blocks) {
  const grid = document.getElementById('blocks-grid');
  grid.innerHTML = '';

  blocks.forEach(block => {
    const minRhVal = block.minRH;
    const tempDanger = block.maxTemp >= hazardCriteria.temp.threshold;
    const rhDanger = minRhVal !== 'N/A' && minRhVal <= hazardCriteria.rh.threshold;
    const windDanger = block.maxWind >= hazardCriteria.windSustained.threshold;
    const gustDanger = block.maxGust >= hazardCriteria.windGust.threshold;

    const div = document.createElement('div');
    
    let blockClass = 'forecast-block';
    if (block.isExtreme) blockClass += ' block-extreme';
    else if (block.isDangerous) blockClass += ' block-danger';
    div.className = blockClass;
    
    let html = `
      <div class="block-time">${block.title} ${block.isExtreme ? '⚡' : (block.isDangerous ? '🔥' : '')}</div>
      
      <div class="block-stat">
        <span class="stat-label">Max Temp</span>
        <span class="stat-val ${tempDanger ? 'val-danger' : ''}">${block.maxTemp}°F</span>
      </div>
      
      <div class="block-stat">
        <span class="stat-label">Min RH</span>
        <span class="stat-val ${rhDanger ? 'val-danger' : ''}">${minRhVal}%</span>
      </div>
      
      <div class="block-stat" title="Sustained Wind">
        <span class="stat-label">Sustained</span>
        <span class="stat-val ${windDanger ? 'val-danger' : (block.maxWind >= 15 ? 'val-caution' : '')}">${block.maxWind} mph</span>
      </div>

      <div class="block-stat" title="Wind Gusts">
        <span class="stat-label">Gusts up to</span>
        <span class="stat-val ${gustDanger ? 'val-danger' : (block.maxGust >= 20 ? 'val-caution' : '')}">${block.maxGust} mph</span>
      </div>
      
      <div class="block-stat">
        <span class="stat-label">Precip Chance</span>
        <span class="stat-val" style="color: #60a5fa">${block.maxPoP}%</span>
      </div>
    `;

    if (block.hasThunderstorms) {
      html += `
        <div class="thunderstorm-indicator">
          ⚡ Thunderstorms Expected
        </div>
      `;
    }

    div.innerHTML = html;
    grid.appendChild(div);
  });
}
