// Flexible Criteria for Stakeholder Requirements
const hazardCriteria = {
  wind: { threshold: 20 },  // Wind threshold in mph
  temp: { threshold: 65 },  // Temperature threshold in °F
  rh: { threshold: 20 }     // RH threshold in %
};

// Define which conditions trigger a red flag
const redFlagConditions = {
  requireWind: true,
  requireTempAndRh: false,  // Temp and RH both required
  requireAnyTwo: false     // Any two hazards trigger red flag
};

// Town definitions
const towns = [
  { name: 'Garcia', lat: 37.0001, lon: -105.6000, el: document.getElementById('garcia-box') },
  { name: 'San Luis', lat: 37.1995, lon: -105.4236, el: document.getElementById('san-luis-box') },
  { name: 'Fort Garland', lat: 37.5111, lon: -105.4381, el: document.getElementById('fort-garland-box') }
];

// Check for red flag based on active hazards and chosen criteria
function checkRedFlag(hazards) {
  const { wind, temp, rh } = hazards;

  if (redFlagConditions.requireWind && wind) return true;
  if (redFlagConditions.requireTempAndRh && temp && rh) return true;
  
  const activeHazardsCount = [wind, temp, rh].filter(Boolean).length;
  if (redFlagConditions.requireAnyTwo && activeHazardsCount >= 2) return true;

  return false;
}

// Fetch weather data for each town
towns.forEach(town => {
  fetch(`https://api.weather.gov/points/${town.lat},${town.lon}`)
    .then(res => res.json())
    .then(data => {
      if (!data.properties || !data.properties.forecastHourly) {
        throw new Error(`Missing forecast data for ${town.name}`);
      }
      town.hourlyURL = data.properties.forecastHourly;
      return fetch(town.hourlyURL);
    })
    .then(res => res.json())
    .then(forecast => {
      const periods = forecast.properties.periods.slice(0, 12);
      town.periods = periods;
      const firstHour = periods[0];

      let icons = "";
      periods.forEach(p => {
        const windSpeed = parseInt(p.windSpeed);
        const hazards = {
          wind: !isNaN(windSpeed) && windSpeed >= hazardCriteria.wind.threshold,
          temp: p.temperature >= hazardCriteria.temp.threshold,
          rh: p.relativeHumidity && p.relativeHumidity.value !== undefined && p.relativeHumidity.value <= hazardCriteria.rh.threshold
        };

        if (hazards.wind && !icons.includes('💨')) icons += '💨';
        if (hazards.temp && !icons.includes('🔥')) icons += '🔥';
        if (hazards.rh && !icons.includes('🔻')) icons += '🔻';
      });

      // Check for red flag using flexible criteria
      const hazardsDetected = {
        wind: icons.includes('💨'),
        temp: icons.includes('🔥'),
        rh: icons.includes('🔻')
      };
      const isRedFlag = checkRedFlag(hazardsDetected);
      town.el.style.backgroundColor = isRedFlag ? 'red' : 'gold';

      town.el.innerHTML = `${town.name}<br>
        Temp: ${firstHour.temperature}°F<br>
        Wind: ${firstHour.windSpeed}<br>
        RH: ${firstHour.relativeHumidity && firstHour.relativeHumidity.value !== undefined ? firstHour.relativeHumidity.value + '%' : 'N/A'}<br>
        ${icons}`;

      // Hazard bar and messages
      const hazardBar = document.getElementById('hazard-bar');
      hazardBar.innerHTML = '';

      const addHazardIcon = (id, icon, label, isActive) => {
        const div = document.createElement('div');
        div.className = `hazard ${isActive ? 'active' : ''}`;
        div.id = id;
        div.innerHTML = `${icon}<span>${label}</span>`;
        hazardBar.appendChild(div);
      };

      addHazardIcon('tempIcon', '🌡️', 'High Temp', hazardsDetected.temp);
      addHazardIcon('rhIcon', '🔻', 'Low RH', hazardsDetected.rh);
      addHazardIcon('windIcon', '💨', 'Strong Wind', hazardsDetected.wind);

      const hazardMessage = document.getElementById('hazard-message');
      const burnAdvisory = document.getElementById('burn-advisory');
      let messages = [];

      if (hazardsDetected.wind) {
        messages.push(`💨 Strong Winds forecasted (> ${hazardCriteria.wind.threshold} mph).`);
      }
      if (hazardsDetected.temp) {
        messages.push(`🔥 High Temperature forecasted (> ${hazardCriteria.temp.threshold}°F).`);
      }
      if (hazardsDetected.rh) {
        messages.push(`🔻 Low RH forecasted (< ${hazardCriteria.rh.threshold}%).`);
      }

      if (isRedFlag) {
        messages.push('⚠️ Critical fire hazards detected—DO NOT BURN.');
        burnAdvisory.style.display = 'none';
      } else {
        burnAdvisory.style.display = 'block';
      }

      hazardMessage.innerHTML = messages.join('<br>');
    })
    .catch(err => {
      town.el.innerText = `${town.name}: Weather unavailable`;
      console.error(`Failed to load weather for ${town.name}`, err);
    });
});

// Forecast table
const tableContainer = document.createElement('div');
tableContainer.id = 'forecast-table';
tableContainer.style.marginTop = '1rem';
document.body.appendChild(tableContainer);

towns.forEach(town => {
  town.el.style.cursor = 'pointer';
  town.el.addEventListener('click', () => {
    if (!town.periods) return;
    const rows = town.periods.map(p => {
      const date = new Date(p.startTime);
      const time = date.toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
      const windSpeed = parseInt(p.windSpeed);
      const rhValue = p.relativeHumidity?.value;
      const windDanger = windSpeed >= hazardCriteria.wind.threshold;
      const tempDanger = p.temperature >= hazardCriteria.temp.threshold;
      const rhDanger = rhValue !== undefined && rhValue <= hazardCriteria.rh.threshold;

      return `<tr>
        <td>${time}</td>
        <td style="${tempDanger ? 'background-color: #ffcccc;' : ''}">${p.temperature}°F ${tempDanger ? '🔥' : ''}</td>
        <td style="${windDanger ? 'background-color: #ffcccc;' : ''}">${p.windSpeed} ${windDanger ? '💨' : ''}</td>
        <td style="${rhDanger ? 'background-color: #ffcccc;' : ''}">${rhValue !== undefined ? rhValue + '%' : 'N/A'} ${rhDanger ? '🔻' : ''}</td>
        <td>${p.shortForecast}</td>
      </tr>`;
    }).join('');

    tableContainer.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2>${town.name} - 12 Hour Forecast</h2>
        <button onclick="tableContainer.innerHTML = ''">✖ Close</button>
      </div>
      <table style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr>
            <th>Time</th><th>Temp</th><th>Wind</th><th>RH</th><th>Forecast</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  });
});

// Toggle Checklist
function toggleChecklist(event) {
  const checklist = document.getElementById('burn-checklist');
  const button = event.target;
  checklist.style.display = checklist.style.display === 'none' ? 'block' : 'none';
  button.innerText = checklist.style.display === 'none' ? 'Show Burn Checklist' : 'Hide Burn Checklist';
}
