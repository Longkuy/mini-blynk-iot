/*
 * MiniBlynk IoT - ตัวอย่างโค้ด ESP8266 แบบ HTTP (ไม่ต้องลง Library เพิ่ม!)
 * เหมาะสำหรับเริ่มต้นเรียนวิชา IoT
 *
 * การทำงาน:
 * - อ่านค่า Virtual Pin V0 จาก Server เพื่อสั่งเปิด-ปิดไฟ LED บนบอร์ด (LED_BUILTIN)
 * - อ่านค่า Virtual Pin V2 (0-1023) เพื่อปรับความสว่าง PWM (ถ้าต่อ LED ที่ขา D1 / GPIO5)
 * - ส่งค่าขา Analog A0 ขึ้นไปยัง Virtual Pin V5 และส่งค่าจำลองอุณหภูมิ/ความชื้นไปยัง V3, V4
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>

// ==================== ตั้งค่า WiFi และ Server ====================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";      // ชื่อ WiFi (ต้องเป็น 2.4GHz)
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";  // รหัสผ่าน WiFi

// ใส่ IP เครื่องคอมพิวเตอร์ที่รัน Server (เช็กด้วยคำสั่ง ipconfig)
const char* SERVER_HOST   = "192.168.1.100";
const int   SERVER_PORT   = 3000;

// Auth Token ของอุปกรณ์ (คัดลอกจากหน้า Web Dashboard)
const char* AUTH_TOKEN    = "esp8266_demo_token_1234";
// ===============================================================

const int PWM_PIN = D1; // GPIO5 (ต่อ LED ภายนอกเพื่อลอง Slider V2)

unsigned long lastSyncTime = 0;
const unsigned long SYNC_INTERVAL = 1500; // ซิงค์ทุกๆ 1.5 วินาที

WiFiClient wifiClient;

// ฟังก์ชันส่งค่าจาก ESP8266 ขึ้น Server (Virtual Write)
void virtualWrite(const char* pin, String value) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + SERVER_PORT +
               "/api/external/update?token=" + AUTH_TOKEN +
               "&pin=" + pin + "&value=" + value;

  http.begin(wifiClient, url);
  int httpCode = http.GET();
  if (httpCode > 0) {
    Serial.printf("[TX] %s = %s (HTTP %d)\n", pin, value.c_str(), httpCode);
  } else {
    Serial.printf("[ERR] ส่งค่า %s ไม่สำเร็จ: %s\n", pin, http.errorToString(httpCode).c_str());
  }
  http.end();
}

// ฟังก์ชันอ่านค่าจาก Server ลงมาที่ ESP8266 (Virtual Read)
String virtualRead(const char* pin) {
  if (WiFi.status() != WL_CONNECTED) return "";

  HTTPClient http;
  String url = String("http://") + SERVER_HOST + ":" + SERVER_PORT +
               "/api/external/get?token=" + AUTH_TOKEN + "&pin=" + pin;

  http.begin(wifiClient, url);
  int httpCode = http.GET();
  String payload = "";
  if (httpCode == HTTP_CODE_OK) {
    payload = http.getString();
    payload.trim();
  }
  http.end();
  return payload;
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH); // ESP8266 LED_BUILTIN เป็น Active LOW (HIGH = ดับ)

  pinMode(PWM_PIN, OUTPUT);
  analogWriteRange(1023);

  Serial.println("\n=== MiniBlynk ESP8266 HTTP Client ===");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("กำลังเชื่อมต่อ WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nเชื่อมต่อ WiFi สำเร็จ!");
  Serial.print("IP ของ ESP8266: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (millis() - lastSyncTime >= SYNC_INTERVAL) {
    lastSyncTime = millis();

    // 1. รับคำสั่งควบคุม LED จากปุ่ม V0 บน Dashboard
    String v0 = virtualRead("V0");
    if (v0 == "1") {
      digitalWrite(LED_BUILTIN, LOW);  // เปิดไฟ LED บนบอร์ด
    } else if (v0 == "0") {
      digitalWrite(LED_BUILTIN, HIGH); // ปิดไฟ LED บนบอร์ด
    }

    // 2. รับค่า Slider จาก V2 (0 - 1023) เพื่อปรับความสว่าง PWM
    String v2 = virtualRead("V2");
    if (v2.length() > 0) {
      int pwmVal = constrain(v2.toInt(), 0, 1023);
      analogWrite(PWM_PIN, pwmVal);
    }

    // 3. อ่านค่าเซนเซอร์ Analog A0 ส่งขึ้น V5
    int analogVal = analogRead(A0);
    virtualWrite("V5", String(analogVal));

    // 4. ตัวอย่างส่งค่าอุณหภูมิ (V3) และความชื้น (V4)
    // (หากต่อ DHT11/DHT22 ให้เปลี่ยนมาใช้ dht.readTemperature() / dht.readHumidity())
    float temp = 26.0 + (random(-20, 35) / 10.0);
    float humi = 60.0 + (random(-50, 50) / 10.0);
    virtualWrite("V3", String(temp, 1));
    virtualWrite("V4", String(humi, 1));
  }
}
