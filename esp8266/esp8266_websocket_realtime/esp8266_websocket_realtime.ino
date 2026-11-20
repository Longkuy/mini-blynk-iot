/*
 * MiniBlynk IoT - ตัวอย่างโค้ด ESP8266 แบบ WebSocket Real-time (คล้าย Blynk จริงๆ!)
 * ตอบสนองทันทีเมื่อกดปุ่มบนหน้าเว็บ (< 50ms)
 *
 * Library ที่ต้องติดตั้งเพิ่มใน Arduino IDE (Library Manager):
 * 1. WebSockets by Markus Sattler
 * 2. ArduinoJson by Benoit Blanchon (เวอร์ชัน 7.x หรือ 6.x)
 */

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ==================== ตั้งค่า WiFi และ Server ====================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";      // ชื่อ WiFi (ต้องเป็น 2.4GHz)
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";  // รหัสผ่าน WiFi

// ใส่ IP เครื่องคอมพิวเตอร์ที่รัน Server (เช็กด้วยคำสั่ง ipconfig)
const char* SERVER_HOST   = "192.168.1.100";
const int   SERVER_PORT   = 3000;

// Auth Token ของอุปกรณ์ (คัดลอกจากหน้า Web Dashboard)
const char* AUTH_TOKEN    = "esp8266_demo_token_1234";
// ===============================================================

const int RELAY_PIN = D2; // GPIO4 (ต่อ Relay หรือ LED เพิ่มเติมสำหรับ V1)
const int PWM_PIN   = D1; // GPIO5 (ต่อ LED สำหรับ Slider V2)

WebSocketsClient webSocket;
unsigned long lastSensorSend = 0;
const unsigned long SENSOR_INTERVAL = 2000; // ส่งค่าเซนเซอร์ทุก 2 วินาที

// ส่งค่า Virtual Pin ขึ้นไปยัง Server
void sendVirtualPin(const char* pin, float value) {
  JsonDocument doc;
  doc["type"] = "virtual_write";
  doc["pin"] = pin;
  doc["value"] = value;

  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
}

// ฟังก์ชันจัดการเมื่อได้รับคำสั่งจาก Server (คล้าย BLYNK_WRITE)
void onVirtualPinChanged(String pin, String value) {
  Serial.printf("[RX] รับคำสั่ง %s = %s\n", pin.c_str(), value.c_str());

  if (pin == "V0") {
    // ควบคุม LED บนบอร์ด ESP8266 (Active LOW: LOW = ติด, HIGH = ดับ)
    digitalWrite(LED_BUILTIN, value == "1" ? LOW : HIGH);
  } else if (pin == "V1") {
    // ควบคุม Relay / LED ที่ขา D2
    digitalWrite(RELAY_PIN, value == "1" ? HIGH : LOW);
  } else if (pin == "V2") {
    // ปรับความสว่าง PWM ที่ขา D1 (0 - 1023)
    int pwmVal = constrain(value.toInt(), 0, 1023);
    analogWrite(PWM_PIN, pwmVal);
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WS] ขาดการเชื่อมต่อจาก Server กำลังลองใหม่...");
      break;

    case WStype_CONNECTED:
      Serial.println("[WS] เชื่อมต่อ MiniBlynk Server สำเร็จ!");
      break;

    case WStype_TEXT: {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, payload, length);
      if (err) {
        Serial.printf("[WS] JSON Error: %s\n", err.c_str());
        return;
      }

      const char* msgType = doc["type"] | "";

      // เมื่อเชื่อมต่อครั้งแรก Server จะส่งสถานะ Pin ทั้งหมดมาให้ซิงค์
      if (strcmp(msgType, "sync_all") == 0) {
        JsonObject pins = doc["pins"].as<JsonObject>();
        for (JsonPair kv : pins) {
          onVirtualPinChanged(String(kv.key().c_str()), kv.value().as<String>());
        }
      }
      // เมื่อผู้ใช้กดปุ่ม/เลื่อน Slider บนหน้า Dashboard
      else if (strcmp(msgType, "pin_update") == 0) {
        String pin = doc["pin"].as<String>();
        String value = doc["value"].as<String>();
        onVirtualPinChanged(pin, value);
      }
      break;
    }

    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH); // ปิดไฟเริ่มต้น

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  pinMode(PWM_PIN, OUTPUT);
  analogWriteRange(1023);

  Serial.println("\n=== MiniBlynk ESP8266 WebSocket Client ===");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("กำลังเชื่อมต่อ WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nเชื่อมต่อ WiFi สำเร็จ! IP: " + WiFi.localIP().toString());

  // เชื่อมต่อ WebSocket ไปยัง MiniBlynk Server
  String wsPath = String("/ws?role=device&token=") + AUTH_TOKEN;
  webSocket.begin(SERVER_HOST, SERVER_PORT, wsPath);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  webSocket.loop();

  if (millis() - lastSensorSend >= SENSOR_INTERVAL) {
    lastSensorSend = millis();

    // อ่านค่า Analog A0 ส่งขึ้น V5
    int analogVal = analogRead(A0);
    sendVirtualPin("V5", analogVal);

    // ตัวอย่างส่งค่าอุณหภูมิ (V3) และความชื้น (V4)
    float temp = 27.0 + (random(-15, 25) / 10.0);
    float humi = 62.0 + (random(-40, 40) / 10.0);
    sendVirtualPin("V3", temp);
    sendVirtualPin("V4", humi);
  }
}
