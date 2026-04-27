let currentPeriod = 'weekly';
let allSessions = [];

document.addEventListener('DOMContentLoaded', async () => {
  // Load sessions from chrome storage
  try {
    const result = await chrome.storage.local.get('guestSessions');
    allSessions = result.guestSessions || [];
    
    console.log('Loaded guest sessions:', allSessions.length);
    
    // Update stats grid with all sessions
    updateStatsGrid(allSessions);
    
    // Set up tab buttons
    setupTabButtons();
    
    if (allSessions.length > 0) {
      try {
        renderCharts(allSessions, currentPeriod);
      } catch (chartErr) {
        console.error('Failed to render charts:', chartErr);
        const chartsSection = document.getElementById('chartsSection');
        chartsSection.innerHTML = `
          <div class="empty-state">
            <div class="emoji">⚠️</div>
            <div>Could not render charts. Insights are still available below.</div>
          </div>
        `;
      }
      
      renderInsights(allSessions);
      document.getElementById('insightsSection').style.display = 'block';
    }
  } catch (err) {
    console.error('Error loading guest sessions:', err);
  }
  
  // Set up event listeners
  document.getElementById('backButton').addEventListener('click', () => {
    window.close();
  });
});

function setupTabButtons() {
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active class from all buttons
      tabButtons.forEach(btn => btn.classList.remove('active'));
      
      // Add active class to clicked button
      button.classList.add('active');
      
      // Update current period
      currentPeriod = button.getAttribute('data-period');
      
      // Re-render charts with new period
      if (allSessions.length > 0) {
        renderCharts(allSessions, currentPeriod);
      }
    });
  });
}

function updateStatsGrid(sessions) {
  const totalSessions = sessions.length;
  const totalTime = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const totalTimeDisplay = Number(totalTime.toFixed(1));
  const avgFatigue = totalSessions > 0 ? (sessions.reduce((sum, s) => sum + (s.fatigueScore || 0), 0) / totalSessions).toFixed(1) : 0;
  const avgBlinkRate = totalSessions > 0 ? (sessions.reduce((sum, s) => sum + (s.blinkRate || 0), 0) / totalSessions).toFixed(1) : 0;
  
  // Update DOM elements
  document.getElementById('avgFatigue').textContent = avgFatigue;
  document.getElementById('avgBlinkRate').textContent = avgBlinkRate;
  document.getElementById('totalSessions').textContent = totalSessions;
  document.getElementById('totalTime').textContent = totalTimeDisplay;
  
  // Calculate fatigue change (simple trend)
  if (totalSessions >= 2) {
    const recentSessions = sessions.slice(-3); // Last 3 sessions
    const recentAvgFatigue = (recentSessions.reduce((sum, s) => sum + (s.fatigueScore || 0), 0) / recentSessions.length).toFixed(1);
    const change = (recentAvgFatigue - avgFatigue).toFixed(1);
    const fatigueChangeEl = document.getElementById('fatigueChange');
    
    if (change > 0) {
      fatigueChangeEl.innerHTML = `<span class="change-negative">↑ ${Math.abs(change)}% vs recent</span>`;
    } else if (change < 0) {
      fatigueChangeEl.innerHTML = `<span class="change-positive">↓ ${Math.abs(change)}% vs recent</span>`;
    } else {
      fatigueChangeEl.innerHTML = `<span>No change</span>`;
    }
  }
}

function renderCharts(sessions, period = 'weekly') {
  const chartsSection = document.getElementById('chartsSection');
  
  // Filter sessions by period
  const now = new Date();
  const filteredSessions = sessions.filter(session => {
    const sessionDate = new Date(session.timestamp);
    if (period === 'weekly') {
      // Last 7 days
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return sessionDate >= sevenDaysAgo;
    } else {
      // Last 30 days
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return sessionDate >= thirtyDaysAgo;
    }
  });
  
  if (filteredSessions.length === 0) {
    chartsSection.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📊</div>
        <div>No session data available for the selected period.</div>
        <div style="font-size: 12px; margin-top: 8px; color: var(--text-tertiary);">
          Try selecting a different time period or start new sessions.
        </div>
      </div>
    `;
    return;
  }
  
  // Prepare data for charts
  const dates = filteredSessions.map(s => new Date(s.timestamp));
  const blinkRates = filteredSessions.map(s => s.blinkRate || 0);
  const fatigueScores = filteredSessions.map(s => s.fatigueScore || 0);
  const durations = filteredSessions.map(s => s.durationMinutes || 0);

  // Create charts container
  chartsSection.innerHTML = `
    <div class="chart-container">
      <h3>Blink Rate Over Time</h3>
      <div class="chart-wrapper">
        <canvas id="blinkRateChart"></canvas>
      </div>
    </div>
    <div class="chart-container">
      <h3>Fatigue Score Over Time</h3>
      <div class="chart-wrapper">
        <canvas id="fatigueChart"></canvas>
      </div>
    </div>
    <div class="chart-container">
      <h3>Session Duration Over Time</h3>
      <div class="chart-wrapper">
        <canvas id="durationChart"></canvas>
      </div>
    </div>
  `;

  // Format dates for chart labels
  const labels = dates.map(date => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '\n' +
           date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  });

  // Blink Rate Chart
  const blinkRateCtx = document.getElementById('blinkRateChart').getContext('2d');
  new Chart(blinkRateCtx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Blink Rate (BPM)',
        data: blinkRates,
        borderColor: 'rgba(16, 185, 129, 1)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: false,
          min: 5,
          max: 30,
          title: {
            display: true,
            text: 'Blinks Per Minute'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Session Time'
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      }
    }
  });

  // Fatigue Score Chart
  const fatigueCtx = document.getElementById('fatigueChart').getContext('2d');
  new Chart(fatigueCtx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Fatigue Score (%)',
        data: fatigueScores,
        borderColor: 'rgba(239, 68, 68, 1)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: {
            display: true,
            text: 'Fatigue Score (%)'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Session Time'
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      }
    }
  });

  // Duration Chart
  const durationCtx = document.getElementById('durationChart').getContext('2d');
  new Chart(durationCtx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Duration (minutes)',
        data: durations,
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Duration (minutes)'
          }
        },
        x: {
          title: {
            display: true,
            text: 'Session Time'
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top'
        }
      }
    }
  });
}

function renderInsights(sessions) {
  // Calculate various metrics for insights
  const totalBlinkRates = sessions.reduce((sum, s) => sum + (s.blinkRate || 0), 0);
  const avgBlinkRate = (totalBlinkRates / sessions.length).toFixed(1);

  const totalFatigueScores = sessions.reduce((sum, s) => sum + (s.fatigueScore || 0), 0);
  const avgFatigueScore = (totalFatigueScores / sessions.length).toFixed(1);

  const totalDuration = sessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const avgDuration = (totalDuration / sessions.length).toFixed(1);

  // Find best and worst sessions
  const bestSession = sessions.reduce((best, s) => (
    (s.blinkRate || 0) > (best.blinkRate || 0) ? s : best
  ), sessions[0]);

  const worstSession = sessions.reduce((worst, s) => (
    (s.fatigueScore || 0) > (worst.fatigueScore || 0) ? s : worst
  ), sessions[0]);

  // Calculate trends
  const recentSessions = sessions.slice(-3); // Last 3 sessions
  const recentAvgBlink = (recentSessions.reduce((sum, s) => sum + (s.blinkRate || 0), 0) / recentSessions.length).toFixed(1);
  const blinkTrend = recentAvgBlink > avgBlinkRate ? 'improving' : recentAvgBlink < avgBlinkRate ? 'declining' : 'stable';

  const insightsGrid = document.getElementById('insightsGrid');
  insightsGrid.innerHTML = `
    <div class="insight-card">
      <h4>📊 Average Performance</h4>
      <div class="content">
        <strong>Blink Rate:</strong> ${avgBlinkRate} BPM<br>
        <strong>Fatigue Score:</strong> ${avgFatigueScore}%<br>
        <strong>Session Duration:</strong> ${avgDuration} minutes
      </div>
    </div>
    <div class="insight-card">
      <h4>🏆 Best Session</h4>
      <div class="content">
        <strong>Date:</strong> ${new Date(bestSession.timestamp).toLocaleString()}<br>
        <strong>Blink Rate:</strong> ${bestSession.blinkRate || 'N/A'} BPM<br>
        <strong>Fatigue Score:</strong> ${bestSession.fatigueScore || 'N/A'}%
      </div>
    </div>
    <div class="insight-card">
      <h4>⚠️ Most Fatigued Session</h4>
      <div class="content">
        <strong>Date:</strong> ${new Date(worstSession.timestamp).toLocaleString()}<br>
        <strong>Fatigue Score:</strong> ${worstSession.fatigueScore || 'N/A'}%<br>
        <strong>Blink Rate:</strong> ${worstSession.blinkRate || 'N/A'} BPM
      </div>
    </div>
    <div class="insight-card">
      <h4>📈 Blink Rate Trend</h4>
      <div class="content">
        Your blink rate is <strong>${blinkTrend}</strong>.
        ${blinkTrend === 'improving' ? 'Keep up the good work!' : 
         blinkTrend === 'declining' ? 'Consider taking more breaks.' : 
         'Your blink rate has been consistent.'}
      </div>
    </div>
  `;
}
