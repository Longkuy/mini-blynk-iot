/*
 * MiniBlynk IoT - โค้ด ESP8266 สำหรับเชื่อมต่อ Server บน Cloud (HTTPS / WSS พอร์ต 443)
 * ใช้คู่กับ Server ที่ Deploy บน Render / Railway / Cloudflare Tunnel
 *
 * Library ที่ต้องติดตั้งเพิ่มใน Arduino IDE (Library Manager):
 * 1. WebSockets by Markus Sattler
 * 2. ArduinoJson by Benoit Blanchon
 */

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ==================== ตั้งค่า WiFi และ Cloud Server ====================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";      // ชื่อ WiFi (2.4GHz)
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";  // รหัสผ่าน WiFi

// ใส่โดเมน Cloud ที่ได้หลัง Deploy (ไม่ต้องใส่ https:// นำหน้า)
const char* SERVER_HOST   = "mini-blynk-iot.onrender.com";
const int   SERVER_PORT   = 443;

// Auth Token ของอุปกรณ์
const char* AUTH_TOKEN    = "esp8266_demo_token_1234";
// =====================================================================

const int RELAY_PIN = D2; // GPIO4
const int PWM_PIN   = D1; // GPIO5

WebSocketsClient webSocket;
unsigned long lastSensorSend = 0;
const unsigned long SENSOR_INTERVAL = 2500;

void sendVirtualPin(const char* pin, float value) {
  JsonDocument doc;
  doc["type"] = "virtual_write";
  doc["pin"] = pin;
  doc["value"] = value;

  String json;
  serializeJson(doc, json);
  webSocket.sendTXT(json);
}

void onVirtualPinChanged(String pin, String value) {
  Serial.printf("[RX] %s = %s\n", pin.c_str(), value.c_str());

  if (pin == "V0") {
    digitalWrite(LED_BUILTIN, value == "1" ? LOW : HIGH);
  } else if (pin == "V1") {
    digitalWrite(RELAY_PIN, value == "1" ? HIGH : LOW);
  } else if (pin == "V2") {
    analogWrite(PWM_PIN, constrain(value.toInt(), 0, 1023));
  }
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WSS] ขาดการเชื่อมต่อ กำลังลองใหม่...");
      break;
    case WStype_CONNECTED:
      Serial.println("[WSS] เชื่อมต่อ Cloud Server สำเร็จ!");
      break;
    case WStype_TEXT: {
      JsonDocument doc;
      if (deserializeJson(doc, payload, length)) return;
      const char* msgType = doc["type"] | "";

      if (strcmp(msgType, "sync_all") == 0) {
        JsonObject pins = doc["pins"].as<JsonObject>();
        for (JsonPair kv : pins) {
          onVirtualPinChanged(String(kv.key().c_str()), kv.value().as<String>());
        }
      } else if (strcmp(msgType, "pin_update") == 0) {
        onVirtualPinChanged(doc["pin"].as<String>(), doc["value"].as<String>());
      }
      break;
    }
    default:
      break;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  pinMode(PWM_PIN, OUTPUT);
  analogWriteRange(1023);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("กำลังเชื่อมต่อ WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nเชื่อมต่อ WiFi สำเร็จ!");

  // เชื่อมต่อแบบ SSL (wss://) ไปยัง Cloud Server
  String wsPath = String("/ws?role=device&token=") + AUTH_TOKEN;
  webSocket.beginSSL(SERVER_HOST, SERVER_PORT, wsPath);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000, 3000, 2);
}

void loop() {
  webSocket.loop();

  if (millis() - lastSensorSend >= SENSOR_INTERVAL) {
    lastSensorSend = millis();
    sendVirtualPin("V5", analogRead(A0));
    sendVirtualPin("V3", 27.0 + (random(-15, 25) / 10.0));
    sendVirtualPin("V4", 62.0 + (random(-40, 40) / 10.0));
  }
}
