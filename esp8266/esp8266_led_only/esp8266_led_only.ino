/*
 * MiniBlynk IoT - โค้ด ESP8266 ควบคุม LED อย่างเดียว (แบบง่ายสุด ไม่ต้องลง Library เพิ่ม!)
 * รองรับทั้ง Cloud (https://xxxx.onrender.com) และเครื่องคอม (http://192.168.x.x:3000)
 *
 * การทำงาน:
 * - กดปุ่ม V0 บนหน้าเว็บ Dashboard เพื่อเปิด-ปิดไฟ LED บนบอร์ด (LED_BUILTIN)
 * - และเปิด-ปิด LED ภายนอกที่ต่อกับขา D1 (GPIO5) ไปพร้อมกัน
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>

// ==================== แก้แค่ 4 บรรทัดนี้ ====================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";      // ชื่อ WiFi (ต้องเป็น 2.4GHz)
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";  // รหัสผ่าน WiFi

// ใส่ URL ของ Server (จาก Render เช่น "https://mini-blynk-iot.onrender.com"
// หรือถ้าใช้ในเครื่องคอม เช่น "http://192.168.89.108:3000")
const char* SERVER_URL    = "https://mini-blynk-iot.onrender.com";

// Auth Token จากหน้า Dashboard
const char* AUTH_TOKEN    = "esp8266_demo_token_1234";
// ===========================================================

const int EXTERNAL_LED_PIN = D1; // ขา D1 สำหรับต่อ LED ภายนอก (ถ้ามี)

void setup() {
  Serial.begin(115200);

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH); // LED บนบอร์ด ESP8266 เป็น Active LOW (HIGH = ปิด)

  pinMode(EXTERNAL_LED_PIN, OUTPUT);
  digitalWrite(EXTERNAL_LED_PIN, LOW); // LED ภายนอก (LOW = ปิด)

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("กำลังเชื่อมต่อ WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nเชื่อมต่อ WiFi สำเร็จ!");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    WiFiClientSecure secureClient;
    WiFiClient plainClient;
    String url = String(SERVER_URL) + "/api/external/get?token=" + AUTH_TOKEN + "&pin=V0";

    if (url.startsWith("https://")) {
      secureClient.setInsecure(); // ข้ามการตรวจใบรับรอง SSL สำหรับงานเรียน
      http.begin(secureClient, url);
    } else {
      http.begin(plainClient, url);
    }

    int httpCode = http.GET();
    if (httpCode == HTTP_CODE_OK) {
      String val = http.getString();
      val.trim();

      if (val == "1") {
        digitalWrite(LED_BUILTIN, LOW);       // เปิด LED บนบอร์ด
        digitalWrite(EXTERNAL_LED_PIN, HIGH); // เปิด LED ขา D1
      } else {
        digitalWrite(LED_BUILTIN, HIGH);      // ปิด LED บนบอร์ด
        digitalWrite(EXTERNAL_LED_PIN, LOW);  // ปิด LED ขา D1
      }
      Serial.println("V0 = " + val);
    } else {
      Serial.printf("เชื่อมต่อ Server ไม่สำเร็จ (HTTP %d)\n", httpCode);
    }
    http.end();
  }

  delay(800); // เช็กสถานะปุ่มทุก 0.8 วินาที
}
