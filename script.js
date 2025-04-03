// Define danger thresholds globally so they are available everywhere
const windThreshold = 10;
const tempThreshold = 75;
const rhThreshold = 15;

const towns = [
  { name: 'Garcia', lat: 37.0001, lon: -105.6000, el: document.getElementById('garcia-box') },
  { name: 'San Luis', lat: 37.1995, lon: -105.4236, el: document.getElementById('san-luis-box') },
  { name: 'Fort Garland', lat: 37.5111, lon: -105.4381, el: document.getElementById('fort-garland-box') }
];

towns.forEach(town => {
  console.log(`Fetching point data for ${town.name} at ${town.lat}, ${town.lon}`);
  fetch(`https://api.weather.gov/points/${town.lat},${town.lon}`)
    .then(res => res.json())
    .then(data => {
      if (!data.properties || !data.properties.forecast || !data.properties.forecastHourly) {
        throw new Error(`Missing forecast data for ${town.name}`);
      }
      town.forecastURL = data.properties.forecast;
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
        const windMatch = !isNaN(windSpeed) && windSpeed >= windThreshold;
        const tempMatch = p.temperature >= tempThreshold;
        const rhMatch = p.relativeHumidity && p.relativeHumidity.value !== undefined && p.relativeHumidity.value <= rhThreshold;

        if (windMatch && !icons.includes('💨')) icons += '💨';
        if (tempMatch && !icons.includes('🔥')) icons += '🔥';
        if (rhMatch && !icons.includes('🔻')) icons += '🔻';
      });

      let boxColor = icons.includes('💨') || icons.includes('🔥') ? 'red' : 'gold';
      town.el.style.backgroundColor = boxColor;

      town.el.innerHTML = `${town.name}<br>
        Temp: ${firstHour.temperature}°F<br>
        Wind: ${firstHour.windSpeed}<br>
        RH: ${firstHour.relativeHumidity && firstHour.relativeHumidity.value !== undefined ? firstHour.relativeHumidity.value + '%' : 'N/A'}<br>
        ${icons}`;

      const hazardBar = document.getElementById('hazard-bar');
      hazardBar.innerHTML = '';
      const addHazardIcon = (id, icon, label, isActive) => {
        const div = document.createElement('div');
        div.className = 'hazard';
        div.id = id;
        div.innerHTML = `${icon}<span>${label}</span>`;
        if (isActive) {
          div.classList.add('active');
        }
        hazardBar.appendChild(div);
      };

      addHazardIcon('tempIcon', '🌡️', 'High Temp', icons.includes('🔥'));
      addHazardIcon('rhIcon', '💧', 'Low RH', icons.includes('🔻'));
      addHazardIcon('windIcon', '💨', 'Strong Wind', icons.includes('💨'));

      const hazardMessage = document.getElementById('hazard-message');
      let messages = [];
      const burnAdvisory = document.getElementById('burn-advisory');
      if (icons.includes('💨')) {
        messages.push(`💨 Strong Winds forecasted today. Winds faster than ${windThreshold} mph can be dangerous and lead to uncontrolled fires.`);
      }
      if (icons.includes('🔥')) {
        messages.push(`🔥 High temperatures expected today. Heat above ${tempThreshold}°F increases fire risk.`);
      }
      if (icons.includes('🔻')) {
        messages.push(`🔻 Low Relative Humidity detected. RH below ${rhThreshold}% can dry fuels and increase fire danger.`);
      }
      if (messages.length > 1) {
        messages.push(`⚠️ Multiple critical fire weather hazards detected. Conditions are unsafe for burning.`);
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

const tableContainer = document.createElement('div');
tableContainer.id = 'forecast-table';
tableContainer.style.marginTop = '1rem';
document.body.appendChild(tableContainer);

towns.forEach(town => {
  town.el.style.cursor = 'pointer';
  town.el.addEventListener('click', () => {
    if (!town.periods) return;
    const rows = town.periods.map(p => {
      const timeObj = new Date(p.startTime);
      const hours = timeObj.getHours();
      const minutes = timeObj.getMinutes().toString().padStart(2, '0');
      const suffix = hours >= 12 ? 'PM' : 'AM';
      const hours12 = ((hours + 11) % 12 + 1);
      const time = `${hours12}:${minutes} ${suffix}`;
      const temp = `${p.temperature}°F`;
      const wind = p.windSpeed;
      const rhVal = p.relativeHumidity && p.relativeHumidity.value !== undefined ? p.relativeHumidity.value : null;
      const rh = rhVal !== null ? rhVal + '%' : 'N/A';
      const shortForecast = p.shortForecast || '';

      const windSpeed = parseInt(p.windSpeed);
      const windDanger = !isNaN(windSpeed) && windSpeed >= windThreshold;
      const tempDanger = p.temperature >= tempThreshold;
      const rhDanger = rhVal !== null && rhVal <= rhThreshold;

      const tempIcon = tempDanger ? ' 🔥' : '';
      const windIcon = windDanger ? ' 💨' : '';
      const rhIcon = rhDanger ? ' 🔻' : '';

      const tempStyle = tempDanger ? "background-color: #ffcccc;" : "";
      const windStyle = windDanger ? "background-color: #ffcccc;" : "";
      const rhStyle = rhDanger ? "background-color: #ffcccc;" : "";

      return `<tr>
        <td style='padding: 4px; border: 1px solid #ccc; text-align: center;'>${time}</td>` +
             `<td style='padding: 4px; border: 1px solid #ccc; text-align: center; ${tempStyle}'>${temp}${tempIcon}</td>` +
             `<td style='padding: 4px; border: 1px solid #ccc; text-align: center; ${windStyle}'>${wind}${windIcon}</td>` +
             `<td style='padding: 4px; border: 1px solid #ccc; text-align: center; ${rhStyle}'>${rh}${rhIcon}</td>` +
             `<td style='padding: 4px; border: 1px solid #ccc; text-align: center;'>${shortForecast}</td></tr>`;
    }).join('');

    tableContainer.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0;">${town.name} - 12 Hour Forecast</h2>
        <button onclick="document.getElementById('forecast-table').innerHTML = ''" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">✖ Close</button>
      </div>
      <table style="border-collapse: collapse; width: 100%; font-size: 0.85rem; margin-top: 0.5rem; border: 1px solid #ccc;">
        <thead>
          <tr>
            <th style='padding: 4px; border: 1px solid #ccc;'>Time</th>
            <th style='padding: 4px; border: 1px solid #ccc;'>Temp</th>
            <th style='padding: 4px; border: 1px solid #ccc;'>Wind</th>
            <th style='padding: 4px; border: 1px solid #ccc;'>RH</th>
            <th style='padding: 4px; border: 1px solid #ccc;'>Forecast</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  });
});

function toggleChecklist() {
  const checklist = document.getElementById('burn-checklist');
  const button = event.target;
  if (checklist.style.display === 'none') {
    checklist.style.display = 'block';
    button.innerText = 'Hide Burn Checklist';
  } else {
    checklist.style.display = 'none';
    button.innerText = 'Show Burn Checklist';
  }
}
