/**
 * MiniBlynk IoT Server
 * เซิร์ฟเวอร์ IoT จำลองหลักการทำงานของ Blynk สำหรับเรียนวิชา IoT และใช้งานกับ ESP8266
 * รองรับทั้ง WebSocket (Real-time) และ HTTP REST API
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_HISTORY_POINTS = 40;
const HTTP_ONLINE_TIMEOUT_MS = 10000; // ถือว่า Online หากมี HTTP request ภายใน 10 วินาที

// ==================== ระบบจัดเก็บข้อมูล (JSON Database) ====================
function createDefaultWidgets() {
  return [
    { id: 'w-v0', pin: 'V0', type: 'switch', label: 'ไฟ LED บนบอร์ด (LED_BUILTIN)', unit: '', min: 0, max: 1 },
    { id: 'w-v1', pin: 'V1', type: 'switch', label: 'Relay / ไฟขา D2', unit: '', min: 0, max: 1 },
    { id: 'w-v2', pin: 'V2', type: 'slider', label: 'ปรับความสว่าง PWM (ขา D1)', unit: '', min: 0, max: 1023 },
    { id: 'w-v3', pin: 'V3', type: 'gauge', label: 'อุณหภูมิ (Temperature)', unit: '°C', min: 0, max: 50 },
    { id: 'w-v4', pin: 'V4', type: 'gauge', label: 'ความชื้น (Humidity)', unit: '%', min: 0, max: 100 },
    { id: 'w-v5', pin: 'V5', type: 'gauge', label: 'เซนเซอร์ Analog (ขา A0)', unit: '', min: 0, max: 1023 }
  ];
}

function createInitialDb() {
  return {
    devices: [
      {
        id: 'dev-esp8266-demo',
        name: 'ESP8266 Lab Board',
        board: 'ESP8266 (NodeMCU / Wemos D1)',
        token: 'esp8266_demo_token_1234',
        pins: { V0: 0, V1: 0, V2: 0, V3: 27.5, V4: 60.0, V5: 512 },
        widgets: createDefaultWidgets(),
        history: {
          V3: [],
          V4: [],
          V5: []
        },
        createdAt: new Date().toISOString()
      }
    ]
  };
}

function loadDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.devices)) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('[DB] โหลดไฟล์ข้อมูลไม่สำเร็จ จะใช้ค่าเริ่มต้น:', err.message);
  }
  const initial = createInitialDb();
  saveDbNow(initial);
  return initial;
}

let saveTimer = null;
function saveDbNow(data = db) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] บันทึกข้อมูลไม่สำเร็จ:', err.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveDbNow();
  }, 500);
}

const db = loadDb();

// ==================== สถานะการเชื่อมต่อแบบ Real-time ====================
// เก็บ WebSocket ของบอร์ด ESP8266 แต่ละตัว: Map<deviceId, Set<WebSocket>>
const deviceSockets = new Map();
// เก็บเวลาล่าสุดที่บอร์ดติดต่อเข้ามาทาง HTTP: Map<deviceId, number>
const httpLastSeen = new Map();
// เก็บ WebSocket ของหน้าเว็บ Dashboard ทั้งหมด
const dashboardSockets = new Set();

function findDeviceByToken(token) {
  return db.devices.find((d) => d.token === token);
}

function findDeviceById(id) {
  return db.devices.find((d) => d.id === id);
}

function getDeviceStatus(deviceId) {
  const wsSet = deviceSockets.get(deviceId);
  if (wsSet && wsSet.size > 0) {
    return { online: true, mode: 'WebSocket' };
  }
  const lastHttp = httpLastSeen.get(deviceId);
  if (lastHttp && Date.now() - lastHttp < HTTP_ONLINE_TIMEOUT_MS) {
    return { online: true, mode: 'HTTP' };
  }
  return { online: false, mode: 'Offline' };
}

function serializeDevice(device) {
  const status = getDeviceStatus(device.id);
  return {
    ...device,
    online: status.online,
    connectionMode: status.mode
  };
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

function broadcastToDashboards(payload) {
  const data = JSON.stringify(payload);
  for (const ws of dashboardSockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function sendToDeviceSockets(deviceId, payload) {
  const wsSet = deviceSockets.get(deviceId);
  if (!wsSet) return;
  const data = JSON.stringify(payload);
  for (const ws of wsSet) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function emitProtocolLog(direction, protocol, deviceName, message) {
  broadcastToDashboards({
    type: 'protocol_log',
    timestamp: new Date().toLocaleTimeString('th-TH', { hour12: false }),
    direction, // 'RX' | 'TX' | 'SYS'
    protocol,  // 'WS' | 'HTTP' | 'SYS'
    deviceName,
    message
  });
}

/**
 * อัปเดตค่า Virtual Pin และกระจายข้อมูลไปยัง Dashboard + บอร์ด ESP8266
 */
function updateVirtualPin(device, pin, rawValue, source) {
  const normalizedPin = String(pin).toUpperCase().trim();
  if (!/^V\d{1,2}$/.test(normalizedPin)) {
    return null;
  }

  // แปลงเป็นตัวเลขถ้าแปลงได้
  const numVal = Number(rawValue);
  const value = rawValue !== '' && !Number.isNaN(numVal) ? numVal : String(rawValue);

  device.pins[normalizedPin] = value;

  // เก็บประวัติสำหรับกราฟ (เฉพาะค่าที่เป็นตัวเลข)
  if (typeof value === 'number') {
    if (!device.history) device.history = {};
    if (!Array.isArray(device.history[normalizedPin])) {
      device.history[normalizedPin] = [];
    }
    const point = {
      t: new Date().toLocaleTimeString('th-TH', { hour12: false }),
      v: value
    };
    device.history[normalizedPin].push(point);
    if (device.history[normalizedPin].length > MAX_HISTORY_POINTS) {
      device.history[normalizedPin].shift();
    }
  }

  scheduleSave();

  const updateMsg = {
    type: 'pin_update',
    deviceId: device.id,
    pin: normalizedPin,
    value,
    source,
    timestamp: new Date().toLocaleTimeString('th-TH', { hour12: false })
  };

  // แจ้งหน้าเว็บ Dashboard ทุกเครื่อง
  broadcastToDashboards(updateMsg);

  // ถ้าคำสั่งมาจากหน้า Dashboard ให้ส่งต่อไปยังบอร์ด ESP8266 ที่ต่อ WebSocket อยู่ทันที
  if (source === 'dashboard') {
    sendToDeviceSockets(device.id, {
      type: 'pin_update',
      pin: normalizedPin,
      value
    });
  }

  return { pin: normalizedPin, value };
}

// ==================== ตั้งค่า Express & HTTP API ====================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API สำหรับหน้า Web Dashboard ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/info', (req, res) => {
  res.json({
    port: PORT,
    ips: getLocalIPs()
  });
});

app.get('/api/devices', (req, res) => {
  res.json(db.devices.map(serializeDevice));
});

app.post('/api/devices', (req, res) => {
  const name = (req.body.name || '').trim() || `ESP8266 Device ${db.devices.length + 1}`;
  const board = (req.body.board || 'ESP8266 (NodeMCU / Wemos D1)').trim();
  const token = 'iot_' + crypto.randomBytes(8).toString('hex');

  const newDevice = {
    id: 'dev-' + crypto.randomBytes(4).toString('hex'),
    name,
    board,
    token,
    pins: { V0: 0, V1: 0, V2: 0, V3: 0, V4: 0, V5: 0 },
    widgets: createDefaultWidgets(),
    history: { V3: [], V4: [], V5: [] },
    createdAt: new Date().toISOString()
  };

  db.devices.push(newDevice);
  scheduleSave();
  broadcastToDashboards({ type: 'devices_changed', devices: db.devices.map(serializeDevice) });
  emitProtocolLog('SYS', 'SYS', newDevice.name, `สร้างอุปกรณ์ใหม่ (Token: ${newDevice.token})`);
  res.status(201).json(serializeDevice(newDevice));
});

app.delete('/api/devices/:id', (req, res) => {
  const idx = db.devices.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'ไม่พบอุปกรณ์' });

  const [removed] = db.devices.splice(idx, 1);
  const wsSet = deviceSockets.get(removed.id);
  if (wsSet) {
    for (const ws of wsSet) ws.close();
    deviceSockets.delete(removed.id);
  }
  httpLastSeen.delete(removed.id);

  scheduleSave();
  broadcastToDashboards({ type: 'devices_changed', devices: db.devices.map(serializeDevice) });
  emitProtocolLog('SYS', 'SYS', removed.name, 'ลบอุปกรณ์ออกจากระบบ');
  res.json({ ok: true });
});

app.post('/api/devices/:id/widgets', (req, res) => {
  const device = findDeviceById(req.params.id);
  if (!device) return res.status(404).json({ error: 'ไม่พบอุปกรณ์' });

  const pin = String(req.body.pin || '').toUpperCase().trim();
  if (!/^V\d{1,2}$/.test(pin)) {
    return res.status(400).json({ error: 'ชื่อ Pin ต้องอยู่ในรูปแบบ V0 - V99' });
  }

  const type = ['switch', 'slider', 'gauge'].includes(req.body.type) ? req.body.type : 'gauge';
  const widget = {
    id: 'w-' + crypto.randomBytes(4).toString('hex'),
    pin,
    type,
    label: (req.body.label || `Pin ${pin}`).trim(),
    unit: (req.body.unit || '').trim(),
    min: Number.isFinite(Number(req.body.min)) ? Number(req.body.min) : 0,
    max: Number.isFinite(Number(req.body.max)) ? Number(req.body.max) : (type === 'switch' ? 1 : 100)
  };

  device.widgets.push(widget);
  if (device.pins[pin] === undefined) {
    device.pins[pin] = 0;
  }
  scheduleSave();
  broadcastToDashboards({ type: 'devices_changed', devices: db.devices.map(serializeDevice) });
  res.status(201).json(widget);
});

app.delete('/api/devices/:id/widgets/:widgetId', (req, res) => {
  const device = findDeviceById(req.params.id);
  if (!device) return res.status(404).json({ error: 'ไม่พบอุปกรณ์' });

  device.widgets = device.widgets.filter((w) => w.id !== req.params.widgetId);
  scheduleSave();
  broadcastToDashboards({ type: 'devices_changed', devices: db.devices.map(serializeDevice) });
  res.json({ ok: true });
});

app.post('/api/devices/:id/pin', (req, res) => {
  const device = findDeviceById(req.params.id);
  if (!device) return res.status(404).json({ error: 'ไม่พบอุปกรณ์' });

  const result = updateVirtualPin(device, req.body.pin, req.body.value, 'dashboard');
  if (!result) return res.status(400).json({ error: 'Pin ไม่ถูกต้อง' });

  emitProtocolLog('TX', 'HTTP', device.name, `Dashboard สั่ง ${result.pin} = ${result.value}`);
  res.json({ ok: true, ...result });
});

// --- External HTTP API สำหรับ ESP8266 (คล้าย Blynk HTTP REST API) ---

// อ่านค่า Pin จาก Server: GET /api/external/get?token=...&pin=V0
app.get('/api/external/get', (req, res) => {
  const { token, pin } = req.query;
  const device = findDeviceByToken(token);
  if (!device) return res.status(401).send('Invalid auth token');

  markHttpOnline(device);
  const normalizedPin = String(pin || '').toUpperCase().trim();
  const value = device.pins[normalizedPin] ?? 0;
  res.type('text/plain').send(String(value));
});

// ส่งค่า Pin จาก ESP8266 ขึ้น Server: GET /api/external/update?token=...&pin=V3&value=28.5
app.get('/api/external/update', (req, res) => {
  const { token, pin, value } = req.query;
  const device = findDeviceByToken(token);
  if (!device) return res.status(401).send('Invalid auth token');

  markHttpOnline(device);
  const result = updateVirtualPin(device, pin, value, 'device');
  if (!result) return res.status(400).send('Invalid pin format (use V0-V99)');

  emitProtocolLog('RX', 'HTTP', device.name, `ESP8266 ส่ง ${result.pin} = ${result.value}`);
  res.json({ ok: true, pin: result.pin, value: result.value });
});

// ส่งหลาย Pin พร้อมกัน: POST /api/external/batch?token=...  Body: { "V3": 28.5, "V4": 65 }
app.post('/api/external/batch', (req, res) => {
  const token = req.query.token || req.body.token;
  const device = findDeviceByToken(token);
  if (!device) return res.status(401).json({ error: 'Invalid auth token' });

  markHttpOnline(device);
  const updated = {};
  for (const [key, val] of Object.entries(req.body)) {
    if (key === 'token') continue;
    const result = updateVirtualPin(device, key, val, 'device');
    if (result) updated[result.pin] = result.value;
  }

  emitProtocolLog('RX', 'HTTP', device.name, `Batch update: ${JSON.stringify(updated)}`);
  res.json({ ok: true, updated });
});

function markHttpOnline(device) {
  const prevStatus = getDeviceStatus(device.id);
  httpLastSeen.set(device.id, Date.now());
  if (!prevStatus.online) {
    broadcastToDashboards({
      type: 'device_status',
      deviceId: device.id,
      online: true,
      connectionMode: 'HTTP'
    });
    emitProtocolLog('SYS', 'HTTP', device.name, 'อุปกรณ์เชื่อมต่อเข้ามาผ่าน HTTP');
  }
}

// ตรวจสอบอุปกรณ์ HTTP ที่หยุดส่งข้อมูลเกินเวลาที่กำหนด
setInterval(() => {
  const now = Date.now();
  for (const [deviceId, lastTime] of httpLastSeen.entries()) {
    if (now - lastTime >= HTTP_ONLINE_TIMEOUT_MS) {
      httpLastSeen.delete(deviceId);
      const status = getDeviceStatus(deviceId);
      if (!status.online) {
        const device = findDeviceById(deviceId);
        broadcastToDashboards({
          type: 'device_status',
          deviceId,
          online: false,
          connectionMode: 'Offline'
        });
        if (device) {
          emitProtocolLog('SYS', 'HTTP', device.name, 'อุปกรณ์หยุดส่งข้อมูล (Offline)');
        }
      }
    }
  }
}, 3000);

// ==================== ตั้งค่า WebSocket Server (/ws) ====================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role') || 'dashboard';

  // กรณี 1: หน้าเว็บ Dashboard เชื่อมต่อเข้ามา
  if (role === 'dashboard') {
    dashboardSockets.add(ws);
    ws.send(JSON.stringify({
      type: 'init',
      serverInfo: { port: PORT, ips: getLocalIPs() },
      devices: db.devices.map(serializeDevice)
    }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'virtual_write') {
          const device = findDeviceById(msg.deviceId);
          if (!device) return;
          const result = updateVirtualPin(device, msg.pin, msg.value, 'dashboard');
          if (result) {
            emitProtocolLog('TX', 'WS', device.name, `Dashboard สั่ง ${result.pin} = ${result.value}`);
          }
        }
      } catch (err) {
        // ข้ามข้อความที่ไม่ใช่ JSON
      }
    });

    ws.on('close', () => {
      dashboardSockets.delete(ws);
    });
    return;
  }

  // กรณี 2: บอร์ด ESP8266 (หรือ Simulator) เชื่อมต่อเข้ามา
  if (role === 'device') {
    const token = url.searchParams.get('token');
    const device = findDeviceByToken(token);

    if (!device) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid auth token' }));
      ws.close(1008, 'Invalid auth token');
      return;
    }

    if (!deviceSockets.has(device.id)) {
      deviceSockets.set(device.id, new Set());
    }
    deviceSockets.get(device.id).add(ws);

    // แจ้ง Dashboard ว่าอุปกรณ์ Online แล้ว
    broadcastToDashboards({
      type: 'device_status',
      deviceId: device.id,
      online: true,
      connectionMode: 'WebSocket'
    });
    emitProtocolLog('SYS', 'WS', device.name, 'เชื่อมต่อ WebSocket สำเร็จ (Online)');

    // ส่งค่า Pin ปัจจุบันทั้งหมดให้บอร์ดซิงค์ (คล้าย BLYNK_CONNECTED -> Blynk.syncAll())
    ws.send(JSON.stringify({
      type: 'sync_all',
      pins: device.pins
    }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'virtual_write') {
          const result = updateVirtualPin(device, msg.pin, msg.value, 'device');
          if (result) {
            emitProtocolLog('RX', 'WS', device.name, `ESP8266 ส่ง ${result.pin} = ${result.value}`);
          }
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON format' }));
      }
    });

    ws.on('close', () => {
      const wsSet = deviceSockets.get(device.id);
      if (wsSet) {
        wsSet.delete(ws);
        if (wsSet.size === 0) {
          deviceSockets.delete(device.id);
          const status = getDeviceStatus(device.id);
          broadcastToDashboards({
            type: 'device_status',
            deviceId: device.id,
            online: status.online,
            connectionMode: status.mode
          });
          emitProtocolLog('SYS', 'WS', device.name, 'ตัดการเชื่อมต่อ WebSocket (Offline)');
        }
      }
    });
  }
});

// ==================== เริ่มต้นรัน Server ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log('  🚀 MiniBlynk IoT Server พร้อมใช้งานแล้ว!');
  console.log('======================================================');
  console.log(`  เปิดหน้า Dashboard: http://localhost:${PORT}`);
  const ips = getLocalIPs();
  if (ips.length > 0) {
    console.log('\n  IP สำหรับใส่ในโค้ด ESP8266 (SERVER_HOST):');
    ips.forEach((ip) => {
      console.log(`   - http://${ip.address}:${PORT}  (${ip.name})`);
    });
  }
  console.log('======================================================\n');
});
