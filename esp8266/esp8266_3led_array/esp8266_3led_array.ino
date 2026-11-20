#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>

// ==================== ตั้งค่า WiFi และ Server ====================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";      // ชื่อ WiFi (2.4GHz)
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";  // รหัสผ่าน WiFi
const char* SERVER_URL    = "https://mini-blynk-iot.onrender.com"; // ลิงก์จาก Render (หรือ http://IPคอม:3000)
const char* AUTH_TOKEN    = "esp8266_demo_token_1234";             // Auth Token จากหน้า Dashboard
// ===============================================================

int x[3] = {D5, D6, D7}; // D5=V0, D6=V1, D7=V2
int i;

// ฟังก์ชันอ่านค่าจาก MiniBlynk Server (คืนค่า 1 = เปิด, 0 = ปิด, -1 = ติดต่อไม่ได้)
int readVirtualPin(String pin) {
  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;

  String url = String(SERVER_URL) + "/api/external/get?token=" + AUTH_TOKEN + "&pin=" + pin;

  if (url.startsWith("https://")) {
    secureClient.setInsecure();
    http.begin(secureClient, url);
  } else {
    http.begin(plainClient, url);
  }

  int state = -1;
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String val = http.getString();
    val.trim();
    state = (val == "1") ? 1 : 0;
  }
  http.end();
  return state;
}

void setup() {
  Serial.begin(115200);

  for (i = 0; i <= 2; i++) {
    pinMode(x[i], OUTPUT);
    digitalWrite(x[i], 0);
  }

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("กำลังเชื่อมต่อ WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nเชื่อมต่อ WiFi สำเร็จ!");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    delay(500);
    return;
  }

  // เช็กปุ่ม V3: โหมดไฟวิ่งอัตโนมัติ (1 = เปิดโหมดไฟวิ่ง, 0 = คุมเองทีละดวง)
  int autoMode = readVirtualPin("V3");

  if (autoMode == 1) {
    Serial.println("[AUTO] โหมดไฟวิ่ง D5 -> D6 -> D7");
    for (i = 0; i <= 2; i++) {
      // ปิดทุกดวงก่อน แล้วเปิดทีละดวงตามโค้ดเดิม
      digitalWrite(x[i], 1);
      delay(500);
      digitalWrite(x[i], 0);
      delay(300);

      // เช็กซ้ำเผื่อผู้ใช้กดปิด V3 กลางคัน จะได้หยุดทันที
      if (readVirtualPin("V3") == 0) {
        break;
      }
    }
  } else {
    // โหมดคุมเอง: อ่านค่า V0 -> D5, V1 -> D6, V2 -> D7
    for (i = 0; i <= 2; i++) {
      String pinName = "V" + String(i);
      int state = readVirtualPin(pinName);

      if (state != -1) {
        digitalWrite(x[i], state);
        Serial.printf("%s (LED %d) = %d\n", pinName.c_str(), i + 1, state);
      }
    }
    delay(500);
  }
}
