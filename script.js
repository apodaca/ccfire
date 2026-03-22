// Flexible Criteria for Stakeholder Requirements
const hazardCriteria = {
  wind: { threshold: 20 },  // Wind threshold in mph
  temp: { threshold: 65 },  // Temperature threshold in °F
  rh: { threshold: 20 }     // RH threshold in %
};

// Town coordinates and marker IDs
const towns = [
  { name: 'Garcia', lat: 37.0001, lon: -105.6000, id: 'garcia-marker' },
  { name: 'San Luis', lat: 37.1995, lon: -105.4236, id: 'san-luis-marker' },
  { name: 'Fort Garland', lat: 37.5111, lon: -105.4381, id: 'fort-garland-marker' }
];

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  setupMarkers();
  
  // Toggle Safety Checklist
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

  // Select San Luis by default
  selectTown(towns.find(t => t.name === 'San Luis'));
});

function setupMarkers() {
  towns.forEach(town => {
    const marker = document.getElementById(town.id);
    if(marker) {
      marker.addEventListener('click', () => {
        selectTown(town);
      });
    }
  });
}

async function selectTown(town) {
  // Update UI selection state
  document.getElementById('selected-town-name').innerText = `${town.name} Forecast`;
  
  const blocksGrid = document.getElementById('blocks-grid');
  blocksGrid.innerHTML = `
    <div style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; padding: 2rem;">
      <div class="loading-spinner"></div>
      <span style="margin-left: 1rem;">Fetching NWS data...</span>
    </div>
  `;

  // Provide realistic visual feedback on the map by hiding the advisory momentarily
  document.getElementById('burn-advisory-banner').className = 'burn-advisory-banner hidden';
  document.getElementById('nws-alerts-container').innerHTML = '';
  document.getElementById('toggle-checklist-btn').classList.add('hidden');

  try {
    // 1. Fetch NWS Alerts for this point
    const alertsRes = await fetch(`https://api.weather.gov/alerts/active?point=${town.lat},${town.lon}`);
    const alertsData = await alertsRes.json();
    const alerts = alertsData.features || [];

    // Filter for fire-weather related alerts
    const fireAlerts = alerts.filter(f => {
      const event = f.properties.event || '';
      return event.toLowerCase().includes('red flag') || 
             event.toLowerCase().includes('fire weather') ||
             event.toLowerCase().includes('wind advisory') ||
             event.toLowerCase().includes('high wind');
    });

    const isRedFlag = fireAlerts.some(f => f.properties.event.toLowerCase().includes('red flag'));

    // Render Alerts
    const alertsContainer = document.getElementById('nws-alerts-container');
    fireAlerts.forEach(alert => {
      const div = document.createElement('div');
      div.className = 'nws-alert';
      div.innerHTML = `⚠️ <span>${alert.properties.event}</span>`;
      div.title = alert.properties.instruction || alert.properties.description || '';
      alertsContainer.appendChild(div);
    });

    // 2. Fetch Forecast Points
    const pointRes = await fetch(`https://api.weather.gov/points/${town.lat},${town.lon}`);
    const pointData = await pointRes.json();
    const hourlyUrl = pointData.properties.forecastHourly;

    // 3. Fetch Hourly Forecast
    const hourlyRes = await fetch(hourlyUrl);
    const hourlyData = await hourlyRes.json();
    
    // 4. Process into 3-hour blocks
    const periods = hourlyData.properties.periods;
    const blocks = processThreeHourBlocks(periods);

    // Analyze next 12 hours (4 blocks) for base advisory logic
    const nearTerm = blocks.slice(0, 4);
    let highestNearTermWind = 0;
    let lowestNearTermRH = 100;
    let highestNearTermTemp = 0;

    nearTerm.forEach(b => {
      if (b.maxWind > highestNearTermWind) highestNearTermWind = b.maxWind;
      if (b.minRH < lowestNearTermRH) lowestNearTermRH = b.minRH;
      if (b.maxTemp > highestNearTermTemp) highestNearTermTemp = b.maxTemp;
    });

    // Logic: If there is a Red Flag Warning -> CRITICAL DANGER
    // Else If wind >= 20 OR (RH <= 20 AND Temp >= 65) -> DANGER
    // Else If wind >= 15 OR RH <= 25 -> CAUTION
    // Else -> SAFE
    let advisoryLevel = 'safe';
    let advisoryTitle = 'Conditions appear safe.';
    let advisoryMessage = 'Burn with caution. Ensure you have clearance from dispatch.';

    if (isRedFlag) {
      advisoryLevel = 'danger';
      advisoryTitle = 'CRITICAL DANGER: DO NOT BURN';
      advisoryMessage = 'A Red Flag Warning is active. Open burning is highly dangerous and likely prohibited. Do not ignite any fires.';
    } else if (highestNearTermWind >= hazardCriteria.wind.threshold || (lowestNearTermRH <= hazardCriteria.rh.threshold && highestNearTermTemp >= hazardCriteria.temp.threshold)) {
      advisoryLevel = 'danger';
      advisoryTitle = 'DANGER: DO NOT BURN';
      advisoryMessage = `Hazardous conditions ahead (Wind up to ${highestNearTermWind}mph, RH down to ${lowestNearTermRH}%). Burning is strongly discouraged.`;
    } else if (highestNearTermWind >= 15 || lowestNearTermRH <= 25) {
      advisoryLevel = 'caution';
      advisoryTitle = 'ELEVATED RISK: Use Extreme Caution';
      advisoryMessage = 'Conditions are marginal. If you must burn, monitor the wind closely and keep tools/water ready. Call dispatch prior to ignition.';
    }

    renderAdvisoryBanner(advisoryLevel, advisoryTitle, advisoryMessage);
    renderBlocksGrid(blocks);

  } catch (error) {
    console.error("Error fetching data:", error);
    blocksGrid.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 2rem; color: #fca5a5; text-align: center;">
        <p>⚠️ Failed to load weather data from the National Weather Service.</p>
        <p style="font-size: 0.85rem;">Please try again later or check weather.gov directly.</p>
      </div>
    `;
  }
}

function processThreeHourBlocks(periods) {
  // Take up to 48 hours (if available) -> 16 blocks
  const maxHours = Math.min(periods.length, 48);
  const blocks = [];
  
  for (let i = 0; i < maxHours; i += 3) {
    const chunk = periods.slice(i, i + 3);
    if (chunk.length === 0) break;
    
    // Initial Block Date/Time string
    const startTime = new Date(chunk[0].startTime);
    const endTime = new Date(chunk[chunk.length - 1].endTime);
    
    // Formatting: "Today 12pm - 3pm" or "Mon 3pm - 6pm"
    const dayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
    const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });
    
    // Helper to determine if it's "Today"
    const isToday = startTime.toDateString() === new Date().toDateString();
    const dayStr = isToday ? 'Today' : dayFormatter.format(startTime);
    
    const timeStr = `${timeFormatter.format(startTime).replace(' ', '').toLowerCase()} - ${timeFormatter.format(endTime).replace(' ', '').toLowerCase()}`;
    const blockTitle = `${dayStr} ${timeStr}`;

    let maxTemp = -999;
    let minRH = 999;
    let maxWind = 0;
    let summaryIcon = chunk[0].shortForecast; // just a rough baseline

    chunk.forEach(hour => {
      // Temp
      if (hour.temperature > maxTemp) maxTemp = hour.temperature;
      
      // RH
      if (hour.relativeHumidity && hour.relativeHumidity.value !== undefined) {
        if (hour.relativeHumidity.value < minRH) {
          minRH = hour.relativeHumidity.value;
        }
      }
      
      // Wind speed parsing (usually e.g., "10 to 15 mph")
      const windSpeedStr = hour.windSpeed;
      // Extract numbers and take the max
      const matches = windSpeedStr.match(/\d+/g);
      if (matches) {
        matches.forEach(m => {
          const val = parseInt(m, 10);
          if (val > maxWind) maxWind = val;
        });
      }
    });

    // Check if this block is hazardous
    const isDangerous = (maxWind >= hazardCriteria.wind.threshold) || 
                        (minRH <= hazardCriteria.rh.threshold && maxTemp >= hazardCriteria.temp.threshold);

    blocks.push({
      title: blockTitle,
      maxTemp,
      minRH: minRH === 999 ? 'N/A' : minRH,
      maxWind,
      isDangerous
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
    checklistBtn.classList.add('hidden'); // No checklist if they shouldn't burn
    // Ensure checklist is hidden too
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
    const windDanger = block.maxWind >= hazardCriteria.wind.threshold;

    const div = document.createElement('div');
    div.className = `forecast-block ${block.isDangerous ? 'block-danger' : ''}`;
    
    div.innerHTML = `
      <div class="block-time">${block.title} ${block.isDangerous ? '🔥' : ''}</div>
      
      <div class="block-stat">
        <span class="stat-label">Max Temp</span>
        <span class="stat-val ${tempDanger ? 'val-danger' : ''}">${block.maxTemp}°F</span>
      </div>
      
      <div class="block-stat">
        <span class="stat-label">Min RH</span>
        <span class="stat-val ${rhDanger ? 'val-danger' : ''}">${minRhVal}%</span>
      </div>
      
      <div class="block-stat">
        <span class="stat-label">Peak Wind</span>
        <span class="stat-val ${windDanger ? 'val-danger' : ''}">${block.maxWind} mph</span>
      </div>
    `;
    
    grid.appendChild(div);
  });
}
