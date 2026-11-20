# MiniBlynk IoT Server (สำหรับ ESP8266 & เรียนวิชา IoT)

เซิร์ฟเวอร์ IoT จำลองหลักการทำงานของ **Blynk Server** แบบรันเองบนเครื่องคอมพิวเตอร์ (Self-hosted) ไม่จำกัดจำนวนอุปกรณ์และ Virtual Pin ออกแบบมาให้เข้าใจง่ายสำหรับใช้เรียนวิชา IoT โดยเฉพาะ

## ฟีเจอร์หลัก
- **Virtual Pins (`V0` - `V99`)**: ควบคุมอุปกรณ์และรับค่าเซนเซอร์เหมือน Blynk
- **รองรับ 2 โปรโตคอล**:
  - **WebSocket (`/ws`)**: สื่อสารสองทางแบบ Real-time ตอบสนองทันที (< 50ms)
  - **HTTP REST API (`/api/external/...`)**: ใช้งานง่ายกับ ESP8266 โดยไม่ต้องลง Library เพิ่ม
- **Web Dashboard แบบ Real-time**: ปุ่ม Switch, Slider, หน้าปัด Gauge, กราฟแสดงผลย้อนหลัง และเพิ่ม/ลบ Widget เองได้
- **Protocol Inspector**: หน้าต่างดูแพ็กเก็ตการสื่อสาร `RX` / `TX` แบบสดๆ เหมาะสำหรับเรียนรู้หลักการทำงานของ IoT
- **Virtual ESP8266 Simulator**: กดจำลองบอร์ดจากหน้าเว็บได้เลย หรือรันผ่าน Terminal ด้วย `npm run sim`

---

## วิธีติดตั้งและรัน Server

**วิธีที่ง่ายที่สุดบน Windows:** ดับเบิลคลิกไฟล์ `start-server.bat` ได้เลย! (จะติดตั้งแพ็กเกจและรัน Server ให้อัตโนมัติ)

หรือรันผ่าน Terminal (CMD / PowerShell):
1. เปิด Terminal ในโฟลเดอร์โปรเจกต์ แล้วติดตั้งแพ็กเกจ:
   ```bash
   npm.cmd install
   ```
2. รันเซิร์ฟเวอร์:
   ```bash
   node server.js
   ```
3. เปิดเบราว์เซอร์ไปที่: `http://localhost:3000`

### ทดลองเล่นทันที (ยังไม่ต้องต่อบอร์ดจริง)
- กดปุ่ม **⚡ จำลองบอร์ด ESP8266** บนหน้าเว็บ Dashboard เพื่อจำลองบอร์ดส่งค่าอุณหภูมิ (`V3`), ความชื้น (`V4`), Analog (`V5`) และลองกดสวิตช์ `V0` / `V1` หรือเลื่อน Slider `V2`
- หรือเปิด Terminal อีกหน้าต่างแล้วรัน:
  ```bash
  npm run sim
  ```

---

## วิธีเชื่อมต่อกับบอร์ด ESP8266 จริง

มีโค้ดตัวอย่างให้ 2 แบบในโฟลเดอร์ `esp8266/`:

### แบบที่ 1: HTTP พื้นฐาน (แนะนำสำหรับเริ่มต้น — ไม่ต้องลง Library เพิ่ม)
เปิดไฟล์ `esp8266/esp8266_http_basic/esp8266_http_basic.ino` ใน Arduino IDE แล้วแก้ไขค่า 4 บรรทัดนี้:
```cpp
const char* WIFI_SSID     = "ชื่อ_WiFi_2.4GHz";
const char* WIFI_PASSWORD = "รหัสผ่าน_WiFi";
const char* SERVER_HOST   = "192.168.x.x"; // ดูได้จากมุมซ้ายล่างของหน้า Dashboard
const char* AUTH_TOKEN    = "esp8266_demo_token_1234";
```

### แบบที่ 2: WebSocket Real-time (คล้าย Blynk จริง กดปุ๊บติดปั๊บ)
1. ติดตั้ง Library ใน Arduino IDE (Library Manager):
   - **WebSockets** by Markus Sattler
   - **ArduinoJson** by Benoit Blanchon
2. เปิดไฟล์ `esp8266/esp8266_websocket_realtime/esp8266_websocket_realtime.ino` แก้ไข WiFi, `SERVER_HOST`, `AUTH_TOKEN` แล้วอัปโหลดลงบอร์ด

> **หมายเหตุสำหรับ Windows:** คอมพิวเตอร์และ ESP8266 ต้องต่อ WiFi วงเดียวกัน (2.4GHz) หาก ESP8266 เชื่อมต่อไม่ได้ ให้ตรวจสอบ Windows Firewall ว่าเปิดรับพอร์ต `3000` (TCP) แล้วหรือยัง

---

## สรุป API สำหรับทำรายงานวิชา IoT

### 1. HTTP REST API
- **อ่านค่า Pin**:
  `GET /api/external/get?token=<AUTH_TOKEN>&pin=V0`
- **ส่งค่า Pin ขึ้น Server**:
  `GET /api/external/update?token=<AUTH_TOKEN>&pin=V3&value=28.5`
- **ส่งหลาย Pin พร้อมกัน**:
  `POST /api/external/batch?token=<AUTH_TOKEN>`
  Body JSON: `{ "V3": 28.5, "V4": 65.0, "V5": 512 }`

### 2. WebSocket Protocol
- **เชื่อมต่อฝั่ง ESP8266**:
  `ws://<SERVER_HOST>:3000/ws?role=device&token=<AUTH_TOKEN>`
- **ESP8266 ส่งค่าขึ้น Server**:
  ```json
  { "type": "virtual_write", "pin": "V3", "value": 28.5 }
  ```
- **Server ส่งคำสั่งลงมาที่ ESP8266**:
  ```json
  { "type": "pin_update", "pin": "V0", "value": 1 }
  ```
