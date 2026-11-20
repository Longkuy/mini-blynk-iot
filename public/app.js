/**
 * MiniBlynk IoT Dashboard Client
 * เชื่อมต่อกับ Server ผ่าน WebSocket เพื่อแสดงผลและควบคุม ESP8266 แบบ Real-time
 */

let devices = [];
let activeDeviceId = null;
let selectedChartPin = 'V3';
let serverInfo = { port: 3000, ips: [] };
let dashboardWs = null;

// Browser-based Virtual ESP8266 Simulator state
let simWs = null;
let simTimer = null;
let simDeviceId = null;

// DOM Elements
const deviceListEl = document.getElementById('deviceList');
const serverIpListEl = document.getElementById('serverIpList');
const activeDeviceNameEl = document.getElementById('activeDeviceName');
const activeDeviceStatusEl = document.getElementById('activeDeviceStatus');
const activeDeviceBoardEl = document.getElementById('activeDeviceBoard');
const activeDeviceTokenEl = document.getElementById('activeDeviceToken');
const widgetGridEl = document.getElementById('widgetGrid');
const chartPinSelectEl = document.getElementById('chartPinSelect');
const chartContainerEl = document.getElementById('chartContainer');
const protocolLogEl = document.getElementById('protocolLog');
const httpExampleUrlEl = document.getElementById('httpExampleUrl');
const btnSimToggle = document.getElementById('btnSimToggle');
const toastEl = document.getElementById('toast');

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2400);
}

function getActiveDevice() {
  return devices.find((d) => d.id === activeDeviceId) || devices[0] || null;
}

// ==================== WebSocket Connection ====================
function connectDashboardWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  dashboardWs = new WebSocket(`${proto}://${location.host}/ws?role=dashboard`);

  dashboardWs.onopen = () => {
    appendLog({
      timestamp: new Date().toLocaleTimeString('th-TH', { hour12: false }),
      direction: 'SYS',
      protocol: 'WS',
      deviceName: 'Dashboard',
      message: 'เชื่อมต่อกับ MiniBlynk Server สำเร็จ'
    });
  };

  dashboardWs.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'init') {
      serverInfo = msg.serverInfo || serverInfo;
      devices = msg.devices || [];
      if (!activeDeviceId && devices.length > 0) {
        activeDeviceId = devices[0].id;
      }
      renderServerInfo();
      renderAll();
    } else if (msg.type === 'devices_changed') {
      devices = msg.devices || [];
      if (!devices.some((d) => d.id === activeDeviceId)) {
        activeDeviceId = devices[0] ? devices[0].id : null;
      }
      renderAll();
    } else if (msg.type === 'device_status') {
      const dev = devices.find((d) => d.id === msg.deviceId);
      if (dev) {
        dev.online = msg.online;
        dev.connectionMode = msg.connectionMode;
        renderDeviceList();
        renderHeader();
      }
    } else if (msg.type === 'pin_update') {
      const dev = devices.find((d) => d.id === msg.deviceId);
      if (dev) {
        dev.pins[msg.pin] = msg.value;
        if (typeof msg.value === 'number') {
          if (!dev.history) dev.history = {};
          if (!dev.history[msg.pin]) dev.history[msg.pin] = [];
          dev.history[msg.pin].push({ t: msg.timestamp, v: msg.value });
          if (dev.history[msg.pin].length > 40) dev.history[msg.pin].shift();
        }
        if (dev.id === activeDeviceId) {
          updateWidgetDom(msg.pin, msg.value);
          if (msg.pin === selectedChartPin) {
            renderChart();
          }
        }
      }
    } else if (msg.type === 'protocol_log') {
      appendLog(msg);
    }
  };

  dashboardWs.onclose = () => {
    setTimeout(connectDashboardWs, 2000);
  };
}

function sendVirtualWrite(deviceId, pin, value) {
  if (dashboardWs && dashboardWs.readyState === WebSocket.OPEN) {
    dashboardWs.send(JSON.stringify({ type: 'virtual_write', deviceId, pin, value }));
  } else {
    fetch(`/api/devices/${deviceId}/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, value })
    });
  }
}

// ==================== Render Functions ====================
function renderServerInfo() {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || /^192\.168\.|^10\.|^172\./.test(location.hostname);
  if (!isLocal) {
    serverIpListEl.innerHTML = `<div class="ip-item"><code>${location.host}</code><span style="font-size:0.7rem;color:#23c48e;">Cloud (SSL 443)</span></div>`;
    return;
  }
  if (!serverInfo.ips || serverInfo.ips.length === 0) {
    serverIpListEl.innerHTML = `<div class="ip-item"><code>localhost:${serverInfo.port}</code></div>`;
    return;
  }
  serverIpListEl.innerHTML = serverInfo.ips
    .map(
      (ip) => `
      <div class="ip-item">
        <code>${ip.address}:${serverInfo.port}</code>
        <span style="font-size:0.7rem;color:#64748b;">${ip.name}</span>
      </div>`
    )
    .join('');
}

function renderAll() {
  renderDeviceList();
  renderHeader();
  renderWidgets();
  renderChartPinOptions();
  renderChart();
}

function renderDeviceList() {
  if (devices.length === 0) {
    deviceListEl.innerHTML = '<div style="font-size:0.82rem;color:#94a3b8;">ยังไม่มีอุปกรณ์ กด + เพื่อสร้าง</div>';
    return;
  }
  deviceListEl.innerHTML = devices
    .map((d) => {
      const isActive = d.id === activeDeviceId;
      return `
        <div class="device-item ${isActive ? 'active' : ''}" data-id="${d.id}">
          <div class="device-item-top">
            <span>${escapeHtml(d.name)}</span>
            <span class="dot ${d.online ? 'online' : 'offline'}" title="${d.connectionMode}"></span>
          </div>
          <div class="device-item-sub">${d.online ? `Online (${d.connectionMode})` : 'Offline'}</div>
        </div>
      `;
    })
    .join('');

  deviceListEl.querySelectorAll('.device-item').forEach((el) => {
    el.addEventListener('click', () => {
      activeDeviceId = el.dataset.id;
      renderAll();
    });
  });
}

function renderHeader() {
  const dev = getActiveDevice();
  if (!dev) {
    activeDeviceNameEl.textContent = 'ไม่มีอุปกรณ์ที่เลือก';
    activeDeviceTokenEl.textContent = '-';
    return;
  }
  activeDeviceId = dev.id;
  activeDeviceNameEl.textContent = dev.name;
  activeDeviceBoardEl.textContent = dev.board;
  activeDeviceTokenEl.textContent = dev.token;

  activeDeviceStatusEl.textContent = dev.online ? `Online • ${dev.connectionMode}` : 'Offline';
  activeDeviceStatusEl.className = `status-pill ${dev.online ? 'online' : 'offline'}`;

  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const baseUrl = isLocal && serverInfo.ips && serverInfo.ips[0]
    ? `http://${serverInfo.ips[0].address}:${serverInfo.port || 3000}`
    : location.origin;
  httpExampleUrlEl.textContent = `${baseUrl}/api/external/update?token=${dev.token}&pin=V3&value=29.5`;

  // Update simulator button state
  if (simWs && simDeviceId === dev.id) {
    btnSimToggle.textContent = '⏹ หยุดจำลองบอร์ด';
    btnSimToggle.classList.add('sim-active');
  } else {
    btnSimToggle.textContent = '⚡ จำลองบอร์ด ESP8266';
    btnSimToggle.classList.remove('sim-active');
  }
}

function renderWidgets() {
  const dev = getActiveDevice();
  if (!dev) {
    widgetGridEl.innerHTML = '';
    return;
  }

  widgetGridEl.innerHTML = dev.widgets
    .map((w) => {
      const val = dev.pins[w.pin] ?? 0;

      if (w.type === 'switch') {
        const isOn = Number(val) === 1;
        return `
          <div class="widget-card" data-pin="${w.pin}" data-type="switch">
            <div class="widget-top">
              <span class="pin-badge">${w.pin}</span>
              <button class="widget-delete" data-wid="${w.id}" title="ลบ Widget">✕</button>
            </div>
            <div class="widget-label">${escapeHtml(w.label)}</div>
            <div class="switch-wrap">
              <span class="switch-state ${isOn ? 'on' : ''}">${isOn ? 'ON' : 'OFF'}</span>
              <button class="toggle-btn ${isOn ? 'on' : ''}" data-pin="${w.pin}">
                <span class="toggle-knob"></span>
              </button>
            </div>
          </div>`;
      }

      if (w.type === 'slider') {
        return `
          <div class="widget-card" data-pin="${w.pin}" data-type="slider">
            <div class="widget-top">
              <span class="pin-badge">${w.pin}</span>
              <button class="widget-delete" data-wid="${w.id}" title="ลบ Widget">✕</button>
            </div>
            <div class="widget-label">${escapeHtml(w.label)}</div>
            <div class="slider-wrap">
              <div class="slider-val">${val}${escapeHtml(w.unit)}</div>
              <input class="slider-input" type="range" min="${w.min}" max="${w.max}" value="${val}" data-pin="${w.pin}" data-unit="${escapeHtml(w.unit)}" />
              <div class="slider-bounds"><span>${w.min}</span><span>${w.max}</span></div>
            </div>
          </div>`;
      }

      // Default: gauge
      const pct = Math.max(0, Math.min(1, (Number(val) - w.min) / ((w.max - w.min) || 1)));
      const dashTotal = 157;
      const dashOffset = dashTotal * (1 - pct);
      return `
        <div class="widget-card" data-pin="${w.pin}" data-type="gauge" data-min="${w.min}" data-max="${w.max}" data-unit="${escapeHtml(w.unit)}">
          <div class="widget-top">
            <span class="pin-badge">${w.pin}</span>
            <button class="widget-delete" data-wid="${w.id}" title="ลบ Widget">✕</button>
          </div>
          <div class="widget-label">${escapeHtml(w.label)}</div>
          <div class="gauge-wrap">
            <svg class="gauge-svg" viewBox="0 0 120 70">
              <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#263248" stroke-width="10" stroke-linecap="round"/>
              <path class="gauge-arc" d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="#23c48e" stroke-width="10" stroke-linecap="round"
                stroke-dasharray="${dashTotal}" stroke-dashoffset="${dashOffset.toFixed(1)}"/>
            </svg>
            <div class="gauge-val">${val}${escapeHtml(w.unit)}</div>
          </div>
        </div>`;
    })
    .join('');

  // Bind Switch events
  widgetGridEl.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pin = btn.dataset.pin;
      const nextVal = btn.classList.contains('on') ? 0 : 1;
      sendVirtualWrite(dev.id, pin, nextVal);
    });
  });

  // Bind Slider events
  widgetGridEl.querySelectorAll('.slider-input').forEach((input) => {
    input.addEventListener('input', () => {
      const card = input.closest('.widget-card');
      card.querySelector('.slider-val').textContent = `${input.value}${input.dataset.unit}`;
    });
    input.addEventListener('change', () => {
      sendVirtualWrite(dev.id, input.dataset.pin, Number(input.value));
    });
  });

  // Bind Delete widget
  widgetGridEl.querySelectorAll('.widget-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/devices/${dev.id}/widgets/${btn.dataset.wid}`, { method: 'DELETE' });
      showToast('ลบ Widget แล้ว');
    });
  });
}

function updateWidgetDom(pin, value) {
  widgetGridEl.querySelectorAll(`.widget-card[data-pin="${pin}"]`).forEach((card) => {
    const type = card.dataset.type;
    if (type === 'switch') {
      const isOn = Number(value) === 1;
      const stateEl = card.querySelector('.switch-state');
      const btnEl = card.querySelector('.toggle-btn');
      stateEl.textContent = isOn ? 'ON' : 'OFF';
      stateEl.classList.toggle('on', isOn);
      btnEl.classList.toggle('on', isOn);
    } else if (type === 'slider') {
      const input = card.querySelector('.slider-input');
      input.value = value;
      card.querySelector('.slider-val').textContent = `${value}${input.dataset.unit}`;
    } else if (type === 'gauge') {
      const min = Number(card.dataset.min);
      const max = Number(card.dataset.max);
      const unit = card.dataset.unit || '';
      const pct = Math.max(0, Math.min(1, (Number(value) - min) / ((max - min) || 1)));
      const dashTotal = 157;
      card.querySelector('.gauge-arc').setAttribute('stroke-dashoffset', (dashTotal * (1 - pct)).toFixed(1));
      card.querySelector('.gauge-val').textContent = `${value}${unit}`;
    }
  });
}

function renderChartPinOptions() {
  const dev = getActiveDevice();
  if (!dev) return;

  const gaugePins = dev.widgets.filter((w) => w.type === 'gauge' || w.type === 'slider');
  const pins = gaugePins.length > 0 ? gaugePins : dev.widgets;

  if (!pins.some((w) => w.pin === selectedChartPin) && pins.length > 0) {
    selectedChartPin = pins[0].pin;
  }

  chartPinSelectEl.innerHTML = pins
    .map((w) => `<option value="${w.pin}" ${w.pin === selectedChartPin ? 'selected' : ''}>${w.pin} — ${escapeHtml(w.label)}</option>`)
    .join('');
}

function renderChart() {
  const dev = getActiveDevice();
  if (!dev) return;

  const points = (dev.history && dev.history[selectedChartPin]) || [];
  if (points.length < 2) {
    chartContainerEl.innerHTML =
      '<div class="empty-chart">ยังไม่มีข้อมูลเพียงพอสำหรับกราฟ (กด "⚡ จำลองบอร์ด ESP8266" เพื่อดูกราฟทันที)</div>';
    return;
  }

  const values = points.map((p) => Number(p.v));
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const pad = (maxVal - minVal) * 0.15 || 1;
  const lo = minVal - pad;
  const hi = maxVal + pad;

  const W = 500;
  const H = 155;
  const coords = points.map((p, idx) => {
    const x = (idx / (points.length - 1)) * W;
    const y = H - ((Number(p.v) - lo) / (hi - lo)) * (H - 16) - 8;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const areaPoints = `0,${H} ${coords.join(' ')} ${W},${H}`;
  const latest = points[points.length - 1];

  chartContainerEl.innerHTML = `
    <div class="chart-stats">
      <span>ต่ำสุด: <strong>${minVal}</strong></span>
      <span>สูงสุด: <strong>${maxVal}</strong></span>
      <span>ล่าสุด (${latest.t}): <strong style="color:#23c48e">${latest.v}</strong></span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:170px;">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#23c48e" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="#23c48e" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <polygon points="${areaPoints}" fill="url(#chartGrad)" />
      <polyline points="${coords.join(' ')}" fill="none" stroke="#23c48e" stroke-width="2.5" stroke-linejoin="round" />
    </svg>
  `;
}

function appendLog({ timestamp, direction, protocol, deviceName, message }) {
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `
    <span class="log-time">[${timestamp}]</span>
    <span class="log-tag ${direction}">[${protocol} ${direction}]</span>
    <span><strong>${escapeHtml(deviceName)}:</strong> ${escapeHtml(message)}</span>
  `;
  protocolLogEl.appendChild(div);
  while (protocolLogEl.children.length > 80) {
    protocolLogEl.removeChild(protocolLogEl.firstChild);
  }
  protocolLogEl.scrollTop = protocolLogEl.scrollHeight;
}

// ==================== Browser Virtual ESP8266 Simulator ====================
function stopBrowserSim() {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  if (simWs) simWs.close();
  simWs = null;
  simDeviceId = null;
  renderHeader();
}

function toggleBrowserSim() {
  const dev = getActiveDevice();
  if (!dev) return;

  if (simWs && simDeviceId === dev.id) {
    stopBrowserSim();
    showToast('หยุดจำลองบอร์ด ESP8266 แล้ว');
    return;
  }

  stopBrowserSim();
  simDeviceId = dev.id;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  simWs = new WebSocket(`${proto}://${location.host}/ws?role=device&token=${encodeURIComponent(dev.token)}`);

  let temp = 27.2;
  let humi = 61.5;
  let analog = 520;

  simWs.onopen = () => {
    showToast(`เริ่มจำลองบอร์ด ${dev.name} แล้ว!`);
    renderHeader();

    simTimer = setInterval(() => {
      if (!simWs || simWs.readyState !== WebSocket.OPEN) return;
      temp = Number(Math.max(21, Math.min(39, temp + (Math.random() - 0.48) * 0.7)).toFixed(1));
      humi = Number(Math.max(35, Math.min(88, humi + (Math.random() - 0.5) * 1.8)).toFixed(1));
      analog = Math.round(Math.max(0, Math.min(1023, analog + (Math.random() - 0.5) * 90)));

      simWs.send(JSON.stringify({ type: 'virtual_write', pin: 'V3', value: temp }));
      simWs.send(JSON.stringify({ type: 'virtual_write', pin: 'V4', value: humi }));
      simWs.send(JSON.stringify({ type: 'virtual_write', pin: 'V5', value: analog }));
    }, 2000);
  };

  simWs.onclose = () => {
    if (simTimer) clearInterval(simTimer);
    simTimer = null;
    simWs = null;
    simDeviceId = null;
    renderHeader();
  };
}

// ==================== UI Event Listeners ====================
document.getElementById('btnCopyToken').addEventListener('click', () => {
  const dev = getActiveDevice();
  if (!dev) return;
  navigator.clipboard.writeText(dev.token);
  showToast('คัดลอก Auth Token แล้ว!');
});

document.getElementById('btnCopyApi').addEventListener('click', () => {
  navigator.clipboard.writeText(httpExampleUrlEl.textContent);
  showToast('คัดลอกลิงก์ HTTP API แล้ว!');
});

document.getElementById('btnClearLog').addEventListener('click', () => {
  protocolLogEl.innerHTML = '';
});

chartPinSelectEl.addEventListener('change', () => {
  selectedChartPin = chartPinSelectEl.value;
  renderChart();
});

btnSimToggle.addEventListener('click', toggleBrowserSim);

// Modals
document.getElementById('btnAddDevice').addEventListener('click', () => {
  document.getElementById('modalDevice').classList.remove('hidden');
});

document.getElementById('btnAddWidget').addEventListener('click', () => {
  if (!getActiveDevice()) return;
  document.getElementById('modalWidget').classList.remove('hidden');
});

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.close).classList.add('hidden');
  });
});

document.getElementById('formAddDevice').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('inputDeviceName').value.trim();
  const board = document.getElementById('inputDeviceBoard').value.trim();
  const res = await fetch('/api/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, board })
  });
  if (res.ok) {
    const created = await res.json();
    activeDeviceId = created.id;
    document.getElementById('inputDeviceName').value = '';
    document.getElementById('modalDevice').classList.add('hidden');
    showToast(`สร้างอุปกรณ์ "${created.name}" สำเร็จ!`);
  }
});

document.getElementById('formAddWidget').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dev = getActiveDevice();
  if (!dev) return;

  const payload = {
    pin: document.getElementById('inputWidgetPin').value.trim().toUpperCase(),
    type: document.getElementById('inputWidgetType').value,
    label: document.getElementById('inputWidgetLabel').value.trim(),
    min: Number(document.getElementById('inputWidgetMin').value),
    max: Number(document.getElementById('inputWidgetMax').value),
    unit: document.getElementById('inputWidgetUnit').value.trim()
  };

  const res = await fetch(`/api/devices/${dev.id}/widgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    document.getElementById('inputWidgetPin').value = '';
    document.getElementById('inputWidgetLabel').value = '';
    document.getElementById('modalWidget').classList.add('hidden');
    showToast(`เพิ่ม Widget ${payload.pin} แล้ว!`);
  } else {
    const err = await res.json();
    showToast(err.error || 'เกิดข้อผิดพลาด');
  }
});

document.getElementById('btnDeleteDevice').addEventListener('click', async () => {
  const dev = getActiveDevice();
  if (!dev) return;
  if (!confirm(`ต้องการลบอุปกรณ์ "${dev.name}" ใช่หรือไม่?`)) return;
  if (simDeviceId === dev.id) stopBrowserSim();
  await fetch(`/api/devices/${dev.id}`, { method: 'DELETE' });
  showToast('ลบอุปกรณ์แล้ว');
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Start
connectDashboardWs();
