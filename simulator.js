/**
 * Virtual ESP8266 Simulator
 * ใช้จำลองบอร์ด ESP8266 เชื่อมต่อกับ MiniBlynk Server ผ่าน WebSocket
 * เหมาะสำหรับทดลองเรียนหรือทดสอบระบบก่อนต่อบอร์ดจริง!
 *
 * วิธีรัน: npm run sim
 */

const WebSocket = require('ws');

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'esp8266_demo_token_1234';

let ledState = 0;
let relayState = 0;
let pwmValue = 0;
let temp = 27.5;
let humidity = 62.0;
let analogA0 = 512;

function connect() {
  const wsUrl = `${SERVER_URL}/ws?role=device&token=${AUTH_TOKEN}`;
  console.log(`[SIM] กำลังเชื่อมต่อ ESP8266 จำลองไปที่ ${wsUrl} ...`);

  const ws = new WebSocket(wsUrl);
  let sensorTimer = null;

  ws.on('open', () => {
    console.log('[SIM] ✅ เชื่อมต่อ MiniBlynk Server สำเร็จ!');
    console.log('[SIM] กำลังส่งค่าจำลอง V3 (อุณหภูมิ), V4 (ความชื้น), V5 (A0) ทุก 2 วินาที...\n');

    sensorTimer = setInterval(() => {
      // จำลองค่าเซนเซอร์ให้ขยับขึ้นลงอย่างเป็นธรรมชาติ
      temp = Number(Math.max(20, Math.min(40, temp + (Math.random() - 0.48) * 0.8)).toFixed(1));
      humidity = Number(Math.max(30, Math.min(90, humidity + (Math.random() - 0.5) * 2.0)).toFixed(1));
      analogA0 = Math.round(Math.max(0, Math.min(1023, analogA0 + (Math.random() - 0.5) * 80)));

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'virtual_write', pin: 'V3', value: temp }));
        ws.send(JSON.stringify({ type: 'virtual_write', pin: 'V4', value: humidity }));
        ws.send(JSON.stringify({ type: 'virtual_write', pin: 'V5', value: analogA0 }));
        console.log(`[TX] V3=${temp}°C | V4=${humidity}% | V5=${analogA0}  (LED=${ledState}, Relay=${relayState}, PWM=${pwmValue})`);
      }
    }, 2000);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'sync_all') {
        ledState = Number(msg.pins.V0 || 0);
        relayState = Number(msg.pins.V1 || 0);
        pwmValue = Number(msg.pins.V2 || 0);
        console.log(`[SYNC] ซิงค์สถานะเริ่มต้น: V0(LED)=${ledState}, V1(Relay)=${relayState}, V2(PWM)=${pwmValue}`);
      } else if (msg.type === 'pin_update') {
        if (msg.pin === 'V0') ledState = Number(msg.value);
        if (msg.pin === 'V1') relayState = Number(msg.value);
        if (msg.pin === 'V2') pwmValue = Number(msg.value);
        console.log(`[RX] 🔔 ได้รับคำสั่งจาก Dashboard -> ${msg.pin} = ${msg.value}`);
      }
    } catch (err) {
      console.error('[ERR]', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[SIM] ❌ ขาดการเชื่อมต่อ กำลังเชื่อมต่อใหม่ใน 3 วินาที...');
    if (sensorTimer) clearInterval(sensorTimer);
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[SIM] ข้อผิดพลาด:', err.message);
  });
}

connect();
