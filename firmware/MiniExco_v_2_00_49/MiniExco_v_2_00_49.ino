#include <Arduino.h>
#include <ArduinoJson.h>
#include <FS.h>
#include <SD.h>
#include <SPI.h>
#include <ESPAsyncWebServer.h>  //change in lib  src/ESPAsyncWebServer.h stroke 1102 to tcp_state state() {
#include <AsyncTCP.h> // by dvarrel
#include <WiFi.h>
#include "esp_wifi.h"
#include <Preferences.h> // NEW!
#include <ESPmDNS.h>  // <- mDNS library for ESP32
#include <ElegantOTA.h> // change in lib src/ElegantOTA.h stroke 27 to #define ELEGANTOTA_USE_ASYNC_WEBSERVER 1 also tweak cpp and h files like this:
#include <iostream>
#include <sstream>
#include <HTTPClient.h>
#include "driver/ledc.h"
#include <vector>
#include "esp_camera.h"
#include <Adafruit_NeoPixel.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_BNO055.h>
#include <driver/i2s.h>
#include "esp_task_wdt.h"
#include <Audio.h>
#include "driver/i2s.h"
#include <time.h>
#include <sys/stat.h>
#include <utime.h>
#include "esp_sntp.h"


#define FIRMWARE_VERSION "v2.0.49"

#define S3_ID "MINIEXCO_S3_V1_01"

int myTimezone = +3; // For US Eastern (UTC-5)
long gmtOffset_sec = myTimezone * 3600;
bool timeIsValid = false;
unsigned long lastTimeCheck = 0;

//--------------------------------Audio Globals-------------------------------------------------------------------

Audio audio;

// ---- Folders to scan for music----
// --- Supported audio file extensions ---
const char* supportedExtensions[] = {
  ".mp3", ".wav", ".aac", ".flac", ".ogg", ".mod", ".mid", ".midi", ".opus"
};
const int numSupportedExtensions = sizeof(supportedExtensions)/sizeof(supportedExtensions[0]);

// Helper to check file extension
bool hasSupportedExtension(const String& name) {
  for (int i = 0; i < numSupportedExtensions; ++i) {
    if (name.endsWith(supportedExtensions[i])) return true;
  }
  return false;
}

// --- Folders to scan for audio files ---
std::vector<const char*> mediaFolders = {
  "/media/mp3",
};

/*
std::vector<const char*> mediaFolders = {
  "/", 
  "/media", 
  "/media/mp3", 
  "/media/wav"
};
*/

bool loopMode = false;
bool shuffleMode = false;
int lastPausedTime = 0;         // in seconds
bool isPaused = false;
bool playbackStarted = false;

//------------------------------------Reindex globals-----------------------------------------------------------

int reindexTotal = 0;
bool reindexCounting = false; // true while counting files
bool reindexReadyToIndex = false; // true when ready to start indexing

volatile bool pendingReindex = false;
String reindexPath = "/";
File reindexDir;
File reindexIdx;
int reindexCount = 0;

//----------------------------------------------------------------------------------------------------------------


volatile bool micStreamActive = false;
volatile bool micCleanupPending = false;

#define LED_PIN 21
#define NEO_COUNT 12

Adafruit_SSD1306 display(128, 64, &Wire, -1);
Adafruit_NeoPixel pixels(NEO_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// --- I2S config for MSM261S mic ---

#define MY_I2S_PORT I2S_NUM_1   // instead of I2S_NUM_0

#define I2S_MIC_WS    40
#define I2S_MIC_SD    38
#define I2S_MIC_SCK   39

// --- I2S config for NS4168 speaker ---
#define I2S_SPK_SD    9
#define I2S_SPK_BCLK  10
#define I2S_SPK_LRCK  45
#define I2S_SPK_PA    46  // Optional: amp enable

#define I2S_SAMPLE_RATE     16000
#define I2S_SAMPLE_BITS     I2S_BITS_PER_SAMPLE_16BIT
#define I2S_READ_LEN        1024

// Track current I2S state
enum I2SMode { I2S_NONE, I2S_MIC, I2S_SPEAKER };
I2SMode currentI2SMode = I2S_NONE;


// PWM channel mapping summary
#define CH_RIGHT_MOTOR_IN1 0
#define CH_RIGHT_MOTOR_IN2 1
#define CH_LEFT_MOTOR_IN1  2
#define CH_LEFT_MOTOR_IN2  3
#define CH_ARM_MOTOR_IN1   4
#define CH_ARM_MOTOR_IN2   5
#define CH_BUCKET_SERVO    6
#define CH_AUX_SERVO       7

//------CAMERA-------------------
#define PWDN_GPIO_NUM    -1
#define RESET_GPIO_NUM   -1
#define XCLK_GPIO_NUM    33    // ✅ From MCLK
#define SIOD_GPIO_NUM    37    // ✅ From schematic SDA
#define SIOC_GPIO_NUM    36    // ✅ From schematic SCK

#define Y9_GPIO_NUM      47
#define Y8_GPIO_NUM      48
#define Y7_GPIO_NUM      42
#define Y6_GPIO_NUM      8
#define Y5_GPIO_NUM      6
#define Y4_GPIO_NUM      4
#define Y3_GPIO_NUM      5
#define Y2_GPIO_NUM      7

#define VSYNC_GPIO_NUM   35
#define HREF_GPIO_NUM    34
#define PCLK_GPIO_NUM    41

#define PWM_RES_BITS 14
#define PWM_PERIOD_US 20000

#define SCREEN_WIDTH 128   // or whatever your actual OLED width is
#define SCREEN_HEIGHT 64   // or whatever your OLED height is

// Pin defines
#define SD_CS   2
#define SD_SCK  11
#define SD_MOSI 3
#define SD_MISO 12


#define BNO_SDA   15      // Use your actual I2C SDA pin for ESP32-S3!
#define BNO_SCL   14      // Use your actual I2C SCL pin for ESP32-S3!
Adafruit_BNO055 bno055 = Adafruit_BNO055(55, 0x28);  // 0x28 is default addr


volatile bool isSdUploadInProgress = false;
volatile bool isStreaming = true;
volatile int frameCount = 0;  // For FPS counting, used in loop()

//-----------------------Neopixel Globals------------------------------
bool beaconOn = false;
bool emergencyOn = false;
bool leftSignalActive = false;
bool rightSignalActive = false;

uint8_t beaconPhase = 0;
bool blinkState = false;  // For emergency and turn signals
unsigned long lastAnimUpdate = 0;
const unsigned long beaconInterval = 180;
const unsigned long blinkInterval = 400;

//----------------------------------------------------------------------

bool hasPsram = false;  // Global declaration

float lastHeadingDeg = 0.0;  //Path chasing global variable

bool shouldReboot = false;
bool otaValid = false;

int wifiRetryCount = 5;  // Default fallback value

// Non-blocking auto-detach tracking
unsigned long auxDetachTime = 0;
bool auxAttached = false;

// Non-blocking auto-detach tracking
unsigned long bucketDetachTime = 0;
bool bucketAttached = false;


struct MotorState {
  int currentSpeed;
  int targetSpeed;
  int dirPin;
  int otherPin;
  int dirChannel;
  int otherChannel;
  unsigned long lastUpdateTime;
  bool dirForward;
};

// Struct for a path point
struct PathPoint {
  float x, y;
};

struct UploadCtx {
  File uploadFile;
  String uploadPath;
};

static String pendingUploadPath;

std::vector<PathPoint> pathPoints;    // Path received from frontend
int pathIndex = 0;                    // Current target point
bool pathFollowingActive = false;     // Following path state
float robotX = 0, robotY = 0;         // (Optional) Robot's estimated position

MotorState motorStates[3]; // RIGHT, LEFT, ARM
const int rampStep = 15;   // speed increment
const int rampDelay = 5;   // ms between each ramp step

//--------------WiFi Globals------------------------------------------

// Wi-Fi Connection State Machine Variables
enum WifiState {
  WIFI_STA_CONNECTED,
  WIFI_STA_CONNECTING,
  WIFI_STA_RETRYING,
  WIFI_AP_MODE
};
WifiState wifiState = WIFI_STA_CONNECTING; // or WIFI_AP_MODE

String wifiSSID = "";
String wifiPassword = "";

bool wifiConnecting = false;
unsigned long wifiConnectStartTime = 0;

unsigned long wifiLastCheck = 0;
unsigned long wifiRetryStepTime = 0;
unsigned long wifiRetryStart = 0;
unsigned long wifiApScanTime = 0;
uint8_t wifiAutoRetryCount = 0;
uint8_t wifiRetrySubState = 0;

// For OLED or UI feedback
unsigned long wifiOledLastMsg = 0;
String wifiOledLastStep = "";



//--------------------------------------------------------------------

int lastBucketValue = 140;  // Set to your safe init value
int lastAuxValue = 150;


// defines
#define BLevel 0
#define CSense 13
#define bucketServoPin  16
#define auxServoPin 17

#define UP 1
#define DOWN 2
#define LEFT 3
#define RIGHT 4
#define ARMUP 5
#define ARMDOWN 6
#define STOP 0
#define RIGHT_MOTOR 0
#define LEFT_MOTOR 1
#define ARM_MOTOR 2

#define FORWARD 1
#define BACKWARD -1
#define STOP 0


//Use a 10k + 4.7k divider — safe and very common. Let me know if yours is different.
unsigned long lastTelemetrySend = 0;
const float R1 = 10000.0; // 10k Ohm (top resistor)
const float R2 = 4700.0;  // 4.7k Ohm (bottom resistor)
const float MAX_BATTERY_VOLTAGE = 8.4; // 2S Li-ion full charge
const float MIN_BATTERY_VOLTAGE = 6.0; // 2S safe cutoff


bool darkMode = false;
bool horizontalScreen = false;
bool holdBucket = false;
bool holdAux = false;

volatile bool pendingCamRestart = false;

// global constants
const char* ap_ssid = "MiniExco_Setup";

// global variables
bool removeArmMomentum = false;
bool light = false;
Preferences uiPrefs; // NEW
Preferences camPrefs;
Preferences keymapPrefs;  // NEW for keyboard mappings
Preferences imuPrefs;
Preferences wifiPrefs;



struct MOTOR_PINS {
  int pinIN1;
  int pinIN2;
};

std::vector<MOTOR_PINS> motorPins = {
  {18, 19},  // RIGHT_MOTOR Pins
  {20, 43},  // LEFT_MOTOR Pins
  {44, 1}   // ARM_MOTOR pins
};


AsyncWebServer server(80);
AsyncWebSocket wsCarInput("/CarInput");

void startCameraServer();

void startCamera(){
   camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 10000000;
  config.frame_size = FRAMESIZE_UXGA;
  config.pixel_format = PIXFORMAT_JPEG; // for streaming
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  
  // if PSRAM IC present, init with UXGA resolution and higher JPEG quality
  //                      for larger pre-allocated frame buffer.
  if(config.pixel_format == PIXFORMAT_JPEG){
    if(psramFound()){
      config.jpeg_quality = 10;
      config.fb_count = 2;
      config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
      // Limit the frame size when PSRAM is not available
      config.frame_size = FRAMESIZE_SVGA;
      config.fb_location = CAMERA_FB_IN_DRAM;
    }
  } else {
    // Best option for face detection/recognition
    config.frame_size = FRAMESIZE_240X240;
  #if CONFIG_IDF_TARGET_ESP32S3
      config.fb_count = 2;
  #endif
  }

  // camera init
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x", err);
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  // initial sensors are flipped vertically and colors are a bit saturated
  if (s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1); // flip it back
    s->set_brightness(s, 1); // up the brightness just a bit
    s->set_saturation(s, -2); // lower the saturation
  }
  // drop down frame size for higher initial frame rate
  if(config.pixel_format == PIXFORMAT_JPEG){
    s->set_framesize(s, FRAMESIZE_QVGA);
  }

}

String cachedLine1 = "";
String cachedLine2 = "";
String cachedLine3 = "";
const String CLEAR_LINE = "~CLEAR~";

std::vector<String> playlist;
std::vector<int> folderIndex; // Indexes in playlist[] where each folder starts
int currentTrack = 0;
int currentVolume = 15;    // Default volume (0–21)
int currentFolder = 0;     // For nextfolder feature

// --- Add for media device progress tracking ---
String currentlyPlayingFile = "";
unsigned long lastMediaProgressSend = 0;

//----------------------------------------------------------NPT Tine sync------------------------------------------------------------------------
// Call this after WiFi connects
void startNtpSync() {
    configTime(gmtOffset_sec, 0, "pool.ntp.org", "time.nist.gov");
    // Do not block here!
}

// Non blocking NPT time sync
void pollTimeValid() {
    if (timeIsValid) return;
    if (millis() - lastTimeCheck < 1000) return;
    lastTimeCheck = millis();

    struct tm tm;
    if (getLocalTime(&tm) && (tm.tm_year + 1900) >= 2023) {
        timeIsValid = true;
        Serial.print("NTP time is valid: ");
        Serial.println(asctime(&tm));
      sntp_set_time_sync_notification_cb([](struct timeval *tv) {
          // This callback is called when time is updated via SNTP
          // No-op here, but required for FATFS to set time
      });        
    }
}
//------------------------------------------------------------Robot Lighting Controls---------------------------------------------------------

void updatePixels() {
    pixels.clear();

    // Highest priority: Emergency
    if (emergencyOn) {
        uint32_t col = blinkState ? pixels.Color(255, 180, 0) : 0;
        pixels.setPixelColor(0, col);
        pixels.setPixelColor(5, col);
        pixels.setPixelColor(6, col);
        pixels.setPixelColor(11, col);
        pixels.show();
        return;
    }

    // Beacon
    if (beaconOn) {
        for (int i = 0; i < NEO_COUNT; i++) {
            if (((i + beaconPhase) % 4) < 2)
                pixels.setPixelColor(i, pixels.Color(255, 0, 0));   // Red
            else
                pixels.setPixelColor(i, pixels.Color(0, 0, 255));   // Blue
        }
        pixels.show();
        return;
    }

    // Main LED white
    if (light) {
        for (int i = 0; i < NEO_COUNT; i++)
            pixels.setPixelColor(i, pixels.Color(255, 255, 255));
        pixels.show();
        return;
    }

    // Turn signals (blinkState toggles on/off)
    if (leftSignalActive && !rightSignalActive) {
        uint32_t col = blinkState ? pixels.Color(255, 180, 0) : 0;
        pixels.setPixelColor(0, col);
        pixels.setPixelColor(6, col);
        pixels.show();
        return;
    }
    if (rightSignalActive && !leftSignalActive) {
        uint32_t col = blinkState ? pixels.Color(255, 180, 0) : 0;
        pixels.setPixelColor(5, col);
        pixels.setPixelColor(11, col);
        pixels.show();
        return;
    }

    pixels.show();
}


void pixelStart(){
  pixels.begin();
  pixels.setBrightness(30);
  //pixels.setPixelColor(0, pixels.Color(255, 165, 0));  // Orange = Booting
  pixels.show();
}

void handleAnimationTimers() {
    static unsigned long lastAnimUpdate = 0;
    static unsigned long lastBlinkUpdate = 0;
    bool needsUpdate = false;

    // Beacon: chase phase update
    if (beaconOn && millis() - lastAnimUpdate > beaconInterval) {
        beaconPhase = (beaconPhase + 1) % 4;
        lastAnimUpdate = millis();
        needsUpdate = true;
    }

    // Emergency and turn signals: blink toggle update
    if ((emergencyOn || leftSignalActive || rightSignalActive) && millis() - lastBlinkUpdate > blinkInterval) {
        blinkState = !blinkState;
        lastBlinkUpdate = millis();
        needsUpdate = true;
    }

    if (needsUpdate) updatePixels();
}

//-----------------------------------------------------------------------OLED--------------------------------------------------------------------
/*screen is 128x64 I2C SSD1306 (“2-color” means 8 rows yellow, 56 blue; common for these displays).*/

void displayMessage(const String& line1 = "", const String& line2 = "", const String& line3 = "") {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);      // <--- CRITICAL LINE!

  if (line1 != "") {
    display.setCursor(0, 0);
    display.println(line1);
  }
  if (line2 != "") {
    display.setCursor(0, 16);
    display.println(line2);
  }
  if (line3 != "") {
    display.setCursor(0, 26);
    display.println(line3);
  }

  display.display();
}

void drawCenteredIP(const String& ip) {
  display.setTextColor(SSD1306_WHITE);
  display.fillRect(0, 0, 128, 16, SSD1306_BLACK); // Clear top
  int textSize = 2;
  int charW = 6 * textSize;
  int ipLen = ip.length();
  int maxChars = 128 / (charW); // e.g. 128/12 = 10

  if (ipLen > maxChars) textSize = 1, charW = 6;

  display.setTextSize(textSize);
  int x = (128 - ipLen * charW) / 2;
  if (x < 0) x = 0;
  display.setCursor(x, 0);
  display.print(ip);
  display.setTextSize(1); // Reset for other text
}

void showWiFiScreen(const String& ip, const String& body, int bodySize = 2) {
  display.clearDisplay();

  // Top row: IP, yellow color on 2-color OLED (SSD1306 lib: set first 8 rows)
  drawCenteredIP(ip);

  // Body: Wi-Fi status
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(bodySize);
  int bodyY = 18;
  display.setCursor(0, bodyY);

  if (bodySize == 2) {
    display.println(body); // Just one or two lines
  } else {
    // Split by \n for up to 3 lines
    int y = bodyY;
    int start = 0, idx;
    while ((idx = body.indexOf('\n', start)) != -1) {
      String line = body.substring(start, idx);
      display.setCursor(0, y);
      display.println(line);
      y += 8;
      start = idx + 1;
    }
    if (start < body.length()) {
      display.setCursor(0, y);
      display.println(body.substring(start));
    }
  }

  display.display();
}

void showWiFiStep(const String& msg, bool force = false) {
  String ipToShow = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "WiFi";
  int bodySize = (msg.length() < 18) ? 2 : 1;
  showWiFiScreen(ipToShow, msg, bodySize);
  wifiOledLastStep = msg;
  wifiOledLastMsg = millis();
}


//---------------------------------------------------------------I2C---------------------------------------------------------------------------------------

void i2cStart(){

  Wire.begin(BNO_SDA, BNO_SCL);  // I2C pins
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("❌ OLED init failed"));
  } else {
    displayMessage("", "🔋 MiniExco Booting", "Please wait");
  }

}

void initBNO055() {
  // Start I2C bus for BNO055 (custom pins if needed)
  Wire.begin(BNO_SDA, BNO_SCL);

  Serial.print("🔄 Initializing BNO055 IMU... ");
  if (!bno055.begin()) {
    Serial.println("❌ BNO055 not detected! Check wiring/address.");
    while (1) { delay(1000); }  // Stay here to indicate error
  }
  Serial.println("✅ Found BNO055!");

  // Use external 32kHz crystal for better stability (recommended!)
  bno055.setExtCrystalUse(true);

  // (Optional) Set operating mode, axis remap, etc, if needed
  delay(10);
}

void spiStart() {
    SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
    if (!SD.begin(SD_CS)) {
        Serial.println("SD Card initialization failed!");
    } else {
        Serial.println("SD Card initialized.");
        //SD.setTimeCallback(getFatTime);
        // Ensure /media exists
        if (!SD.exists("/media")) {
            SD.mkdir("/media");
            Serial.println("Created /media folder on SD card.");
        }

        // Media subfolders (inside /media)
        const char* mediaFolders[] = {"/capture", "/wav", "/video", "/mp3", "/anim"};
        for (size_t i = 0; i < sizeof(mediaFolders)/sizeof(mediaFolders[0]); ++i) {
            String subPath = String("/media") + String(mediaFolders[i]);
            if (!SD.exists(subPath)) {
                SD.mkdir(subPath.c_str());
                Serial.printf("Created %s folder on SD card.\n", subPath.c_str());
            }
        }

        // SD root folders
        if (!SD.exists("/web")) {
            SD.mkdir("/web");
            Serial.println("Created /web folder on SD card.");
        }
        if (!SD.exists("/firmware")) {
            SD.mkdir("/firmware");
            Serial.println("Created /firmware folder on SD card.");
        }
    }
}


//------------------------------------------------------------WiFi Stack Management-----------------------------------------------------------------

bool connectToWiFiWithRetries(const String& ssid, const String& password, int retries) {
  WiFi.begin(ssid.c_str(), password.c_str());

  for (int attempt = 1; attempt <= retries; attempt++) {
    Serial.printf("🔁 Attempt %d to connect to WiFi SSID: %s\n", attempt, ssid.c_str());
    unsigned long startAttemptTime = millis();

    while (millis() - startAttemptTime < 2000) {
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("✅ Connected to WiFi!");
        displayMessage("", "✅ WiFi Connected\n" + WiFi.localIP().toString());
        return true;
      }
      delay(200);
    }

    WiFi.disconnect();  // Reset for retry
    delay(100);
    WiFi.begin(ssid.c_str(), password.c_str());
  }

  Serial.println("❌ Failed to connect after retries.");
  return false;
}

bool startNonBlockingWiFiConnection() {
    Serial.println("🔍 Scanning for nearby Wi-Fi networks...");
    int n = WiFi.scanNetworks();
    bool found = false;

    // 1️⃣ Check if the last saved SSID is present
    if (wifiSSID != "") {
      Serial.println("🟡 Found saved Wi-Fi, trying to connect...");
      connectToWiFiWithRetries(wifiSSID, wifiPassword, wifiRetryCount);
    } else {
      Serial.println("🟠 No saved Wi-Fi, staying in AP mode for setup.");
      WiFi.mode(WIFI_AP);
      WiFi.softAP(ap_ssid);
      Serial.print("Started AP: ");
      Serial.println(ap_ssid);
      displayMessage("", "⚠️ AP Mode\n" + WiFi.softAPIP().toString());
    }

    // 2️⃣ If not found, look through all saved networks
    if (!found) {
        Serial.println("⚠️ Last saved Wi-Fi not found. Checking other saved networks...");

        String savedList = wifiPrefs.getString("networks", "");
        int lastIndex = 0, nextIndex;
        while ((nextIndex = savedList.indexOf(',', lastIndex)) != -1) {
            String ssid = normalizedSSID(savedList.substring(lastIndex, nextIndex));
            lastIndex = nextIndex + 1;

            for (int i = 0; i < n; i++) {
                if (ssid == WiFi.SSID(i)) {
                    Serial.println("✅ Found another saved SSID nearby: " + ssid);
                    wifiSSID = ssid;
                    wifiPassword = wifiPrefs.getString(("wifi_" + ssid).c_str(), "");
                    found = true;
                    break;
                }
            }
            if (found) break;
        }

        // Handle the last item in the list (if any)
        if (!found && lastIndex < savedList.length()) {
            String ssid = normalizedSSID(savedList.substring(lastIndex));
            for (int i = 0; i < n; i++) {
                if (ssid == WiFi.SSID(i)) {
                    Serial.println("✅ Found another saved SSID nearby: " + ssid);
                    wifiSSID = ssid;
                    wifiPassword = wifiPrefs.getString(("wifi_" + ssid).c_str(), "");
                    found = true;
                    break;
                }
            }
        }
    }

    // 3️⃣ If nothing is found, abort and stay in AP mode
    if (!found || wifiSSID == "") {
        Serial.println("❌ No saved networks are nearby. Staying in AP mode.");
        return false;
    }

      unsigned long waitStart = millis();

      Serial.println("✅ Wi-Fi credentials loaded, switching to STA mode...");

      // FULL cleanup before switching modes
      WiFi.disconnect(true, true);  // Disconnect + Erase flash config
      WiFi.softAPdisconnect(true);
      delay(200);
      WiFi.mode(WIFI_OFF);
      delay(500);  // Let stack fully reset

      Serial.println("✅ Wi-Fi stack fully reset, switching to STA mode...");
      WiFi.mode(WIFI_STA);
      WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());



      wifiConnecting = true;
      wifiConnectStartTime = millis();
      return true;
}

void handleWiFiSetup(AsyncWebServerRequest *request) {
  if (SD.exists("/WiFiPages.html")) {
    request->send(SD, "/WiFiPages.html", "text/html");
  } else {
    request->send(404, "text/plain", "WiFiPages.html not found on SD card");
  }
}

void handleListWiFi(AsyncWebServerRequest *request) {
  int n = WiFi.scanComplete();

  if (n == -2) {
    // No scan yet, start it
    WiFi.scanNetworks(true);
    request->send(202, "application/json", "[]");  // Accept request, but scanning now
    return;
  }

  if (n == -1) {
    // Scan ongoing
    request->send(202, "application/json", "[]");  // Accept request, still scanning
    return;
  }

  // Scan complete, return results
  String json = "[";
  for (int i = 0; i < n; ++i) {
    if (i) json += ",";
    json += "{\"ssid\":\"" + WiFi.SSID(i) + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
  }
  json += "]";

  WiFi.scanDelete();  // Free memory
  request->send(200, "application/json", json);
}

void handleSaveWiFi(AsyncWebServerRequest *request) {
  if (request->hasParam("ssid", true) && request->hasParam("password", true)) {
    String ssid = normalizedSSID(request->getParam("ssid", true)->value());
    String password = request->getParam("password", true)->value();
    if (request->hasParam("aRt", true)) {
      bool autoReconnect = request->getParam("aRt", true)->value() == "1";
      wifiPrefs.putBool(("aRt_" + ssid).c_str(), autoReconnect);
    }
   
    wifiPrefs.putString("ssid", ssid);
    wifiPrefs.putString("password", password);
    wifiPrefs.putString(("wifi_" + ssid).c_str(), password);

    String existingList = wifiPrefs.getString("networks", "");
    if (existingList.indexOf(ssid) == -1) {
      existingList += (existingList.length() > 0 ? "," : "") + ssid;
      wifiPrefs.putString("networks", existingList);
    }

    if (SD.exists("/wifi_success.html")) {
      request->send(SD, "/wifi_success.html", "text/html");
    } else {
      request->send(200, "text/html", "<html><body><h1>✅ Wi-Fi Credentials Saved</h1><p>Rebooting and trying to connect...</p></body></html>");
    }

    delay(3000);
    ESP.restart();
  } else {
    request->send(400, "text/html", "<html><body><h1>Missing SSID or Password</h1></body></html>");
  }
}

// 👇 Helper: Stop server + WebSocket cleanly before Wi-Fi switch
void stopWebServerAndWS() {
    wsCarInput.closeAll();  // Close all websocket clients
    server.end();           // Fully stop the HTTP server
    Serial.println("✅ WebServer + WebSocket stopped.");
}

void printWiFiInfo() {
  Serial.print("Connected to: "); Serial.println(WiFi.SSID());
  Serial.print("Wi-Fi Channel: "); Serial.println(WiFi.channel());
  Serial.print("RSSI: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");
  Serial.print("IP Address: "); Serial.println(WiFi.localIP());

  // Get protocol mask (actual used standard)
  uint8_t protocol = 0;
  esp_wifi_get_protocol(WIFI_IF_STA, &protocol);

  Serial.print("Wi-Fi Protocols (in use): ");
  if (protocol & WIFI_PROTOCOL_11B) Serial.print("802.11b ");
  if (protocol & WIFI_PROTOCOL_11G) Serial.print("802.11g ");
  if (protocol & WIFI_PROTOCOL_11N) Serial.print("802.11n ");
  #if defined(WIFI_PROTOCOL_LR)
    if (protocol & WIFI_PROTOCOL_LR) Serial.print("11LR ");
  #endif
  Serial.println();
}

void handleWifiStateMachine() {
  unsigned long now = millis();

  // Periodic status check (every 1s)
  if (now - wifiLastCheck > 1000) {
    wifiLastCheck = now;

    if (WiFi.getMode() == WIFI_STA && WiFi.status() == WL_CONNECTED) {
      if (wifiState != WIFI_STA_CONNECTED) {
        showWiFiStep("Connected:\n" + WiFi.localIP().toString(), true);
        wifiState = WIFI_STA_CONNECTED;
        wifiRetrySubState = 0;
      }
    } else if (WiFi.getMode() == WIFI_STA && WiFi.status() != WL_CONNECTED) {
      if (wifiState != WIFI_STA_RETRYING) {
        showWiFiStep("Wi-Fi lost!\nRetrying...");
        wifiState = WIFI_STA_RETRYING;
        wifiRetryStart = now;
        wifiAutoRetryCount = 0;
        wifiRetrySubState = 0;
      }
    }
  }

  // STA retry logic (non-blocking)
  if (wifiState == WIFI_STA_RETRYING) {
    switch (wifiRetrySubState) {
      case 0: // Start retry
        if (wifiAutoRetryCount < 3) {
          showWiFiStep("Retry STA...\n(" + String(wifiAutoRetryCount+1) + "/3)");
          WiFi.disconnect(true, true);
          wifiRetryStepTime = now;
          wifiRetrySubState = 1;
        } else {
          // All retries failed, go AP
          showWiFiStep("No Wi-Fi.\nAP Mode...");
          WiFi.disconnect(true, true);
          wifiRetryStepTime = now;
          wifiRetrySubState = 10;
        }
        break;
      case 1: // Wait 100ms, then start STA
        if (now - wifiRetryStepTime > 100) {
          WiFi.mode(WIFI_STA);
          WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());
          wifiAutoRetryCount++;
          wifiRetryStepTime = now;
          wifiRetrySubState = 2;
        }
        break;
      case 2: // Wait 500ms, then next retry
        if (now - wifiRetryStepTime > 500) {
          wifiRetrySubState = 0;
        }
        break;
      case 10: // Wait 100ms, then go AP mode
        if (now - wifiRetryStepTime > 100) {
          WiFi.mode(WIFI_AP);
          WiFi.softAP(ap_ssid);
          showWiFiStep("AP:\n" + WiFi.softAPIP().toString());
          wifiState = WIFI_AP_MODE;
          wifiOledLastStep = "";
          wifiApScanTime = now;
          wifiRetrySubState = 0;
        }
        break;
    }
  }

  // AP mode: scan for known networks every 15s (non-blocking)
  if (wifiState == WIFI_AP_MODE && now - wifiApScanTime > 15000) {
    wifiApScanTime = now;
    showWiFiStep("Scanning for\nknown Wi-Fi...");
    int n = WiFi.scanNetworks();
    String savedList = wifiPrefs.getString("networks", "");
    int lastIndex = 0, nextIndex;
    bool found = false;
    String foundSSID, foundPass;
    while ((nextIndex = savedList.indexOf(',', lastIndex)) != -1) {
      String ssid = normalizedSSID(savedList.substring(lastIndex, nextIndex));
      lastIndex = nextIndex + 1;
      bool autoReconnect = wifiPrefs.getBool(("aRt_" + ssid).c_str(), true);
      if (!autoReconnect) continue;
      for (int i = 0; i < n; i++) {
        if (ssid == WiFi.SSID(i)) {
          found = true;
          foundSSID = ssid;
          foundPass = wifiPrefs.getString(("wifi_" + ssid).c_str(), "");
          break;
        }
      }
      if (found) break;
    }
    if (!found && lastIndex < savedList.length()) {
      String ssid = normalizedSSID(savedList.substring(lastIndex));
      bool autoReconnect = wifiPrefs.getBool(("aRt_" + ssid).c_str(), true);
      if (autoReconnect) {
        for (int i = 0; i < n; i++) {
          if (ssid == WiFi.SSID(i)) {
            found = true;
            foundSSID = ssid;
            foundPass = wifiPrefs.getString(("wifi_" + ssid).c_str(), "");
            break;
          }
        }
      }
    }
    if (found && foundSSID.length()) {
      showWiFiStep("Found known AP:\n" + foundSSID + "\nConnecting...");
      WiFi.disconnect(true, true);
      wifiSSID = foundSSID;
      wifiPassword = foundPass;
      wifiState = WIFI_STA_CONNECTING;
      WiFi.mode(WIFI_STA);
      WiFi.begin(foundSSID.c_str(), foundPass.c_str());
      wifiRetryStart = now;
      wifiAutoRetryCount = 0;
      wifiRetrySubState = 0;
    } else {
      showWiFiStep("No known Wi-Fi\nStill in AP");
    }
  }
}


//------------------------------------------------------------SD File Management----------------------------------------------------------------------------

void handleRoot(AsyncWebServerRequest *request) {
  // 1. Check /web/index.html (new standard location)
  if (SD.exists("/web/index.html")) {
    request->send(SD, "/web/index.html", "text/html");
    return;
  }
  // 2. Fallback: check /index.html (legacy location)
  if (SD.exists("/index.html")) {
    request->send(SD, "/index.html", "text/html");
    return;
  }
  // 3. Nothing found, list SD files
  String message = "index.html not found on SD card.\n\nFiles on SD card:\n";
  File root = SD.open("/");
  File file = root.openNextFile();
  while (file) {
    message += String(file.name()) + "\n";
    file = root.openNextFile();
  }
  request->send(404, "text/plain", message);
}


String ensureUniqueFilename(String path) {
  if (!SD.exists(path.c_str())) return path;

  String base = path;
  String ext = "";
  int dot = path.lastIndexOf('.');
  if (dot > 0) {
    base = path.substring(0, dot);
    ext = path.substring(dot);
  }
  int i = 1;
  while (true) {
    String tryName = base + "(" + String(i) + ")" + ext;
    if (!SD.exists(tryName.c_str())) return tryName;
    i++;
  }
}

// Helper: generate unique name if /recycle/filename exists
String makeUniqueRecycleName(const String& recyclePath) {
  if (!SD.exists(recyclePath)) return recyclePath;
  String base, ext;
  int dot = recyclePath.lastIndexOf('.');
  if (dot > 0) {
    base = recyclePath.substring(0, dot);
    ext = recyclePath.substring(dot);
  } else {
    base = recyclePath;
    ext = "";
  }
  int n = 1;
  String candidate;
  do {
    candidate = base + "_" + String(n++) + ext;
  } while (SD.exists(candidate));
  return candidate;
}

void ensureFolderExists(const String& fullPath) {
  int lastSlash = fullPath.lastIndexOf('/');
  if (lastSlash > 0) {
    String folderPath = fullPath.substring(0, lastSlash);
    if (!SD.exists(folderPath)) SD.mkdir(folderPath.c_str());
  }
}

// When deleting a file, save its original path in .path file
void moveToRecycle(const String& srcPath) {
    String filename = srcPath.substring(srcPath.lastIndexOf('/') + 1);
    String recyclePath = "/recycle/" + filename;
    SD.rename(srcPath, recyclePath);
    // Save original path
    File f = SD.open("/recycle/" + filename + ".path", FILE_WRITE);
    if (f) {
        f.print(srcPath); // store full original path
        f.close();
    }
}

void processReindexTask() {
    static File dir, idx;
    static File f;
    static bool init = false;
    static unsigned lastBatch = 0;
    static File tmpDir;        // For counting

    if (!pendingReindex) return;

    if (!init) {
        // First, count files (async-friendly!)
        reindexCounting = true;
        reindexReadyToIndex = false;
        reindexTotal = 0;

        if (tmpDir) tmpDir.close();
        tmpDir = SD.open(reindexPath);
        if (!tmpDir || !tmpDir.isDirectory()) {
            pendingReindex = false;
            Serial.println("Failed to open dir for count!");
            reindexCounting = false;
            return;
        }
        File tf = tmpDir.openNextFile();
        while (tf) {
            String name = String(tf.name());
            if (!name.equalsIgnoreCase("System Volume Information") && name != "Thumbs.db") {
                reindexTotal++;
            }
            tf.close();
            tf = tmpDir.openNextFile();
        }
        tmpDir.close();
        Serial.printf("Counted %d files for indexing in %s\n", reindexTotal, reindexPath.c_str());
        reindexCounting = false;
        reindexReadyToIndex = true;
        // Do NOT return here, proceed to next step in next loop
        init = true; // Continue to actual indexing on next call
        return;
    }

    // Only start indexing after counting done
    if (reindexReadyToIndex && init) {
        if (dir) dir.close();
        if (idx) idx.close();
        dir = SD.open(reindexPath);
        idx = SD.open(reindexPath + "/.index", FILE_WRITE);
        if (!dir || !dir.isDirectory() || !idx) {
            pendingReindex = false;
            Serial.println("Failed to start reindex!");
            return;
        }
        f = dir.openNextFile();
        reindexCount = 0;
        reindexReadyToIndex = false; // Reset so doesn't re-enter
        Serial.printf("Begin background indexing for %s\n", reindexPath.c_str());
    }

    if (!dir || !idx) return; // Not ready yet

    int batchCount = 0;
    const int BATCH_SIZE = 50;
    while (f && batchCount < BATCH_SIZE) {
        String name = String(f.name());
        if (name.equalsIgnoreCase("System Volume Information") || name == "Thumbs.db") { 
            f.close(); f = dir.openNextFile(); continue; 
        }
        idx.printf("%s,%d,%u,%lu\n", name.c_str(), f.isDirectory() ? 1 : 0, (unsigned)f.size(), (unsigned long)f.getLastWrite());
        f.close();
        f = dir.openNextFile();
        batchCount++;
        reindexCount++;
    }

    if (!f) {
        if (reindexCount == 0) {
            idx.println("__EMPTY__");
        }
        idx.close();
        dir.close();
        pendingReindex = false;
        init = false;
        Serial.printf("Index for %s finished, %d files\n", reindexPath.c_str(), reindexCount);
    }
}



// Utility: read a batch from .index file
void readSdIndexBatch(const String& idxPath, int start, int count, JsonArray& arr, bool showSystem = false) {
    File idx = SD.open(idxPath);
    if (!idx) return;
    int idxLine = 0, added = 0;
    String line;
    bool isEmptyMarker = false;
    while (idx.available()) {
        line = idx.readStringUntil('\n');
        line.trim();
        if (line == "__EMPTY__") {
            isEmptyMarker = true;
            break;
        }
        if (idxLine++ < start) continue;

        // --- Updated file parsing logic ---
        int comma1 = line.indexOf(',');
        int comma2 = line.indexOf(',', comma1 + 1);
        int comma3 = line.indexOf(',', comma2 + 1); // New: check for date column

        if (comma1 < 0 || comma2 < 0) continue;
        String name = line.substring(0, comma1);
        bool isFolder = line.substring(comma1 + 1, comma2).toInt();
        uint32_t size = 0;
        uint32_t date = 0;
        if (comma3 > 0) {
            // Four columns: name,isFolder,size,date
            size = line.substring(comma2 + 1, comma3).toInt();
            date = line.substring(comma3 + 1).toInt();
        } else {
            // Old style: no date field
            size = line.substring(comma2 + 1).toInt();
        }

        // --- FILTER HERE! ---
        if (!showSystem && (
            name.endsWith(".path") ||
            name.endsWith(".bak") ||
            name.endsWith(".meta") ||
            name.startsWith(".") ||
            name.startsWith(".csv") ||
            name.equalsIgnoreCase("System Volume Information") ||
            name.startsWith("FOUND.") ||
            name == "Thumbs.db"
        )) continue;

        // --- Pagination ---
        if (added++ >= count) break;

        JsonObject obj = arr.createNestedObject();
        obj["name"] = name;
        obj["isFolder"] = isFolder;
        if (!isFolder) obj["size"] = size;
        obj["type"] = isFolder ? "folder" : "default";
        if (date > 0) obj["date"] = (uint32_t)date * 1000; // Convert to ms if in seconds
        // If your index is already in ms, just use: obj["date"] = date;
    }
    idx.close();

    // If marker found and nothing else was added, leave arr empty ([])
    if (isEmptyMarker && arr.size() == 0) {
        // leave arr empty!
    }
}


//------------------------------------------------------------------Robot Controls----------------------------------------------------------------------------
void handle_jpg_stream(AsyncWebServerRequest *request) {
  AsyncWebServerResponse *response = request->beginChunkedResponse(
    "multipart/x-mixed-replace; boundary=frame",
    [](uint8_t *buffer, size_t maxLen, size_t index) -> size_t {
      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) {
        return 0;
      }
      // Write multipart header
      size_t hlen = snprintf((char *)buffer, maxLen,
        "--frame\r\n"
        "Content-Type: image/jpeg\r\n"
        "Content-Length: %u\r\n\r\n",
        fb->len
      );
      size_t n = hlen;
      // Make sure there's enough space for frame and footer
      if (hlen + fb->len + 2 > maxLen) {
        esp_camera_fb_return(fb);
        return 0;
      }
      memcpy(buffer + hlen, fb->buf, fb->len);
      n += fb->len;
      // Add frame footer
      memcpy(buffer + n, "\r\n", 2);
      n += 2;
      esp_camera_fb_return(fb);
      return n;
    }
  );
  request->send(response);
}

void rotateMotor(int motorNumber, int motorDirection) {
  MotorState& m = motorStates[motorNumber];
  m.lastUpdateTime = millis();  // reset timing for ramp

  if (motorDirection == FORWARD) {
    m.targetSpeed = 255;
    m.currentSpeed = 0;  // reset ramp
    m.dirForward = true;

  } else if (motorDirection == BACKWARD) {
    m.targetSpeed = 255;
    m.currentSpeed = 0;
    m.dirForward = false;

  } else {
    if (removeArmMomentum && motorNumber == ARM_MOTOR) {
      //ledcWrite(m.dirChannel, 255);
      //ledcWrite(m.otherChannel, 0);
      delay(10);
    }

    //ledcWrite(m.dirChannel, 0);
    //ledcWrite(m.otherChannel, 0);
    m.currentSpeed = 0;
    m.targetSpeed = 0;
  }
}

/*
void rotateMotorS(int motorNumber, int motorDirection, int speed = 255) {
  MotorState &m = motorStates[motorNumber];
  m.lastUpdateTime = millis();
  m.targetSpeed = constrain(speed, 0, 255);
  m.currentSpeed = m.targetSpeed;

  if (motorDirection == FORWARD) {
    m.dirForward = true;
    digitalWrite(m.otherPin, LOW);
    ledcWrite(m.dirChannel, m.currentSpeed);
  } else if (motorDirection == BACKWARD) {
    m.dirForward = false;
    digitalWrite(m.dirPin, LOW);
    ledcWrite(m.otherChannel, m.currentSpeed);
  } else {
    /ledcWrite(m.dirChannel, 0);
    ledcWrite(m.otherChannel, 0);
    m.targetSpeed = 0;
  }
  if (motorDirection == STOP || speed == 0) {
    ledcWrite(m.dirChannel, 0);
    ledcWrite(m.otherChannel, 0);
    m.targetSpeed = 0;
    return;
  }
}
*/

void moveCar(int inputValue) {
  Serial.printf("Got value as %d\n", inputValue);
  if (!horizontalScreen) {
    switch (inputValue) {
      case UP:
      case DOWN:
        rotateMotor(RIGHT_MOTOR, FORWARD);
        rotateMotor(LEFT_MOTOR, BACKWARD);
        break;
      case LEFT:
        rotateMotor(RIGHT_MOTOR, BACKWARD);
        rotateMotor(LEFT_MOTOR, BACKWARD);
        break;
      case RIGHT:
        rotateMotor(RIGHT_MOTOR, FORWARD);
        rotateMotor(LEFT_MOTOR, FORWARD);
        break;
      case STOP:
        rotateMotor(ARM_MOTOR, STOP);
        rotateMotor(RIGHT_MOTOR, STOP);
        rotateMotor(LEFT_MOTOR, STOP);
        break;
      case ARMUP:
        rotateMotor(ARM_MOTOR, FORWARD);
        break;
      case ARMDOWN:
        rotateMotor(ARM_MOTOR, BACKWARD);
        removeArmMomentum = true;
        break;
      default:
        rotateMotor(ARM_MOTOR, STOP);
        rotateMotor(RIGHT_MOTOR, STOP);
        rotateMotor(LEFT_MOTOR, STOP);
        break;
    }
  } else {
    switch (inputValue) {
      case UP:
        rotateMotor(RIGHT_MOTOR, BACKWARD);
        rotateMotor(LEFT_MOTOR, BACKWARD);
        break;
      case DOWN:
        rotateMotor(RIGHT_MOTOR, FORWARD);
        rotateMotor(LEFT_MOTOR, FORWARD);
        break;
      case LEFT:
        rotateMotor(RIGHT_MOTOR, FORWARD);
        rotateMotor(LEFT_MOTOR, BACKWARD);
        break;
      case RIGHT:
        rotateMotor(RIGHT_MOTOR, BACKWARD);
        rotateMotor(LEFT_MOTOR, FORWARD);
        break;
      case STOP:
        rotateMotor(ARM_MOTOR, STOP);
        rotateMotor(RIGHT_MOTOR, STOP);
        rotateMotor(LEFT_MOTOR, STOP);
        break;
      case ARMUP:
        rotateMotor(ARM_MOTOR, FORWARD);
        break;
      case ARMDOWN:
        rotateMotor(ARM_MOTOR, BACKWARD);
        removeArmMomentum = true;
        break;
      default:
        rotateMotor(ARM_MOTOR, STOP);
        rotateMotor(RIGHT_MOTOR, STOP);
        rotateMotor(LEFT_MOTOR, STOP);
        break;
    }
  }
}

/*
void writeServo(ledc_channel_t channel, int angle) {
  angle = constrain(angle, 0, 180);
  int pulse_us = map(angle, 0, 180, 500, 2500);
  uint32_t duty = ((uint64_t)pulse_us << PWM_RES_BITS) / PWM_PERIOD_US;
  ledc_set_duty(LEDC_LOW_SPEED_MODE, channel, duty);
  ledc_update_duty(LEDC_LOW_SPEED_MODE, channel);
}

void bucketTilt(int bucketServoValue) {
  if (!bucketAttached) {
    // Use low-speed timer explicitly
    ledc_timer_config_t timer = {
      .speed_mode = LEDC_LOW_SPEED_MODE,
      .duty_resolution = LEDC_TIMER_14_BIT,
      .timer_num = LEDC_TIMER_2,  // 🔄 CHANGED from 0 → 2
      .freq_hz = 50,
      .clk_cfg = LEDC_AUTO_CLK
    };

    ledc_timer_config(&timer);

    ledc_channel_config_t ch = {
      .gpio_num = bucketServoPin,
      .speed_mode = LEDC_LOW_SPEED_MODE,
      .channel = (ledc_channel_t)CH_BUCKET_SERVO,
      .intr_type = LEDC_INTR_DISABLE,
      .timer_sel = LEDC_TIMER_2,
      .duty = 0,
      .hpoint = 0
    };
    ledc_channel_config(&ch);
    bucketAttached = true;
    Serial.println("🪣 Bucket PWM configured (low-speed)");
  }

  writeServo((ledc_channel_t)CH_BUCKET_SERVO, bucketServoValue);

  lastBucketValue = bucketServoValue;
  preferences.putInt("bucketAngle", lastBucketValue);
  if (!holdBucket) bucketDetachTime = millis() + 300;
}

void auxControl(int auxServoValue) {
  if (!auxAttached) {
    ledc_timer_config_t timer = {
      .speed_mode = LEDC_LOW_SPEED_MODE,
      .duty_resolution = LEDC_TIMER_14_BIT,
      .timer_num = LEDC_TIMER_3,  // 🔄 CHANGED from 1 → 3
      .freq_hz = 50,
      .clk_cfg = LEDC_AUTO_CLK
    };

    ledc_timer_config(&timer);

    ledc_channel_config_t ch = {
      .gpio_num = auxServoPin,
      .speed_mode = LEDC_LOW_SPEED_MODE,
      .channel = (ledc_channel_t)CH_AUX_SERVO,
      .intr_type = LEDC_INTR_DISABLE,
      .timer_sel = LEDC_TIMER_3,  // use a separate timer from bucket
      .duty = 0,
      .hpoint = 0
    };
    ledc_channel_config(&ch);
    auxAttached = true;
    Serial.println("🔧 AUX PWM configured (low-speed)");
  }

  writeServo((ledc_channel_t)CH_AUX_SERVO, auxServoValue);

  lastAuxValue = auxServoValue;
  preferences.putInt("auxAngle", lastAuxValue);
  if (!holdAux) auxDetachTime = millis() + 300;
}
*/

void controlMotorByDirection(const std::string& dir, int speed) {
  int rawSpeed = speed;
  speed = abs(speed);

  // Handle stopping
  if (speed == 0) {
    if (dir == "Arm" || dir == "ArmUp" || dir == "ArmDown") {
      //rotateMotorS(ARM_MOTOR, STOP);
      motorStates[ARM_MOTOR].targetSpeed = 0;
    } else {
      //rotateMotorS(RIGHT_MOTOR, STOP);
      //rotateMotorS(LEFT_MOTOR, STOP);
      motorStates[RIGHT_MOTOR].targetSpeed = 0;
      motorStates[LEFT_MOTOR].targetSpeed = 0;
    }
    // Always update timers and exit
    motorStates[LEFT_MOTOR].lastUpdateTime = millis();
    motorStates[RIGHT_MOTOR].lastUpdateTime = millis();
    return;
  }

  if (dir == "Forward") {
    rotateMotor(RIGHT_MOTOR, FORWARD);
    rotateMotor(LEFT_MOTOR, FORWARD);
    motorStates[RIGHT_MOTOR].targetSpeed = speed;
    motorStates[LEFT_MOTOR].targetSpeed = speed;

  } else if (dir == "Backward") {
    rotateMotor(RIGHT_MOTOR, BACKWARD);
    rotateMotor(LEFT_MOTOR, BACKWARD);
    motorStates[RIGHT_MOTOR].targetSpeed = speed;
    motorStates[LEFT_MOTOR].targetSpeed = speed;

  } else if (dir == "Left") {
    rotateMotor(RIGHT_MOTOR, FORWARD);
    rotateMotor(LEFT_MOTOR, BACKWARD);
    motorStates[RIGHT_MOTOR].targetSpeed = speed;
    motorStates[LEFT_MOTOR].targetSpeed = speed;

  } else if (dir == "Right") {
    rotateMotor(RIGHT_MOTOR, BACKWARD);
    rotateMotor(LEFT_MOTOR, FORWARD);
    motorStates[RIGHT_MOTOR].targetSpeed = speed;
    motorStates[LEFT_MOTOR].targetSpeed = speed;

  } else if (dir == "Arm") {
    if (rawSpeed > 0) {
      rotateMotor(ARM_MOTOR, FORWARD);
      motorStates[ARM_MOTOR].targetSpeed = speed;
    } else if (rawSpeed < 0) {
      rotateMotor(ARM_MOTOR, BACKWARD);
      motorStates[ARM_MOTOR].targetSpeed = speed;
    }
    // No "else" here, because zero is handled at the start
  }

  motorStates[LEFT_MOTOR].lastUpdateTime = millis();
  motorStates[RIGHT_MOTOR].lastUpdateTime = millis();
}

void lightControl() {
  if (!light) {
    //digitalWrite(lightPin1, HIGH);
    //digitalWrite(lightPin2, LOW);
    light = true;
    Serial.println("Lights ON");
  } else {
    //digitalWrite(lightPin1, LOW);
    //digitalWrite(lightPin2, LOW);
    light = false;
    Serial.println("Lights OFF");
  }
}

void onCarInputWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      Serial.printf("WebSocket client #%u connected from %s\n", client->id(), client->remoteIP().toString().c_str());
      client->text("HoldBucket," + String(holdBucket ? 1 : 0));
      client->text("HoldAux," + String(holdAux ? 1 : 0));
      client->text("Switch," + String(horizontalScreen ? 1 : 0)); // Optional: for HorizontalScreen checkbox too
      client->text("DarkMode," + String(darkMode ? 1 : 0));
      client->text("SliderInit,Forward,0");
      client->text("SliderInit,Backward,0");
      client->text("SliderInit,Left,0");
      client->text("SliderInit,Right,0");
      client->text("SliderInit,ArmUp,0");
      client->text("SliderInit,ArmDown,0");

      client->text("AUX," + String(lastAuxValue));
      client->text("Bucket," + String(lastBucketValue));
      client->text("Beacon," + String(beaconOn ? 1 : 0));
      client->text("Emergency," + String(emergencyOn ? 1 : 0));



      break;
    case WS_EVT_DISCONNECT:
      Serial.printf("WebSocket client #%u disconnected\n", client->id());
      moveCar(STOP);
      break;
    case WS_EVT_DATA:
      AwsFrameInfo *info;
      info = (AwsFrameInfo*)arg;
      if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
        std::string myData = "";
        myData.assign((char *)data, len);
        std::istringstream ss(myData);
        std::string key, value1, value2;
        std::getline(ss, key, ',');
        std::getline(ss, value1, ',');
        std::getline(ss, value2, ',');

        // --- Media control handlers---
        if (key == "MEDIA_PLAY") {
            Serial.printf("[WS] MEDIA_PLAY: %s\n", value1.c_str());
            String filename = value1.c_str();
            if (!filename.startsWith("/media/")) filename = "/media/" + filename;

            // Find the matching track index first!
            currentTrack = -1;
            for (int i = 0; i < playlist.size(); i++) {
                if (playlist[i] == filename || playlist[i].endsWith(filename.substring(filename.lastIndexOf('/') + 1))) {
                    currentTrack = i;
                    break;
                }
            }

            // If found, use playlist for playback (ensures controls & progress always work)
            if (currentTrack >= 0) {
                playCurrentTrack();
            } else {
                // If not found, fallback to playing the file directly
                playWavFileOnSpeaker(filename);
                playbackStarted = true;
                isPaused = false;                
            }

            Serial.printf("[WS] After play: currentTrack=%d, filename=%s\n", currentTrack, filename.c_str());
            wsCarInput.textAll("MEDIA_DEVICE_PLAYING," + filename);
            lastMediaProgressSend = millis();
        }


        else if (key == "MEDIA_NEXT") {
            Serial.println("[WS] MEDIA_NEXT");
            if (playlist.empty()) {
                Serial.println("[WS] Can't go to next: playlist empty");
                return;
            }
            nextTrack();
            // Only announce if a song is playing
            if (currentTrack >= 0 && currentTrack < playlist.size() && audio.isRunning()) {
                wsCarInput.textAll("MEDIA_DEVICE_PLAYING," + playlist[currentTrack]);
            }
        }

        else if (key == "MEDIA_STOP") {
          Serial.println("[WS] MEDIA_STOP");
          stopAudio();
          wsCarInput.textAll("MEDIA_DEVICE_STOPPED");
          isPaused = false;
        }
        else if (key == "MEDIA_PAUSE") {
          Serial.println("[WS] MEDIA_PAUSE");
          pauseAudio();
          wsCarInput.textAll("MEDIA_DEVICE_PAUSED");
        }
        else if (key == "MEDIA_RESUME") {
          Serial.println("[WS] MEDIA_RESUME");
          resumeAudio();
          wsCarInput.textAll("MEDIA_DEVICE_PLAYING," + playlist[currentTrack]);
        }
        else if (key == "MEDIA_PREV") {
          Serial.println("[WS] MEDIA_PREV");
          prevTrack();
          wsCarInput.textAll("MEDIA_DEVICE_PLAYING," + playlist[currentTrack]);
        }
        else if (key == "MEDIA_LOOP_ON") {
          Serial.println("[WS] MEDIA_LOOP_ON");
          loopMode = true;
        }
        else if (key == "MEDIA_LOOP_OFF") {
          Serial.println("[WS] MEDIA_LOOP_OFF");
          loopMode = false;
        }
        else if (key == "MEDIA_SHUFFLE_ON") {
          Serial.println("[WS] MEDIA_SHUFFLE_ON");
          shuffleMode = true;
        }
        else if (key == "MEDIA_SHUFFLE_OFF") {
          Serial.println("[WS] MEDIA_SHUFFLE_OFF");
          shuffleMode = false;
        }



        // --- MIC STREAM COMMANDS ---
        if (key == "START_MIC_STREAM") {
            micStreamActive = true;
            Serial.println("[MIC_STREAM] Client requested mic streaming ON.");
            client->text("MIC_STREAM_ON");
        } else if (key == "STOP_MIC_STREAM") {
            micStreamActive = false;
            Serial.println("[MIC_STREAM] Client requested mic streaming OFF.");
            client->text("MIC_STREAM_OFF");
        }

        // NEW: Turn Signal Handling
        if (key == "Slider") {
          String side = String(value1.c_str());
          int val = atoi(value2.c_str());

          if (side == "Left") {
            if (val > 5 && !leftSignalActive) {
              leftSignalActive = true;
              updatePixels(); // <--- Add this here
              wsCarInput.textAll("TURN_LEFT,1");
            } else if (val <= 5 && leftSignalActive) {
              leftSignalActive = false;
              updatePixels(); // <--- And here
              wsCarInput.textAll("TURN_LEFT,0");
            }
          }
          if (side == "Right") {
            if (val > 5 && !rightSignalActive) {
              rightSignalActive = true;
              updatePixels(); // <--- Add here
              wsCarInput.textAll("TURN_RIGHT,1");
            } else if (val <= 5 && rightSignalActive) {
              rightSignalActive = false;
              updatePixels(); // <--- And here
              wsCarInput.textAll("TURN_RIGHT,0");
            }
          }
        }

        // NEW: Beacon Toggle Button
        if (key == "Beacon") {
          beaconOn = !beaconOn;
          updatePixels(); // <--- Add here
          Serial.println(beaconOn ? "🟡 Beacon ON" : "⚫ Beacon OFF");
        }


        // NEW: Emergency Toggle Button
        if (key == "Emergency") {
          emergencyOn = !emergencyOn;
          updatePixels(); // <--- Add here
          Serial.println(emergencyOn ? "🟡 Emergency ON" : "⚪ Emergency OFF");
        }


        if (key == "Motor") {
          controlMotorByDirection(value1, atoi(value2.c_str()));
        }

        Serial.printf("Key [%s] Value1[%s] Value2[%s]\n", key.c_str(), value1.c_str(), value2.c_str());
        int valueInt = atoi(value1.c_str());

        if (key == "MoveCar") moveCar(valueInt);
        //else if (key == "AUX") auxControl(valueInt);
        //else if (key == "Bucket") bucketTilt(valueInt);
        else if (key == "Light") {
          lightControl();
          updatePixels();
          //all clients to update LED state
          wsCarInput.textAll("Light," + String(light ? 1 : 0));
        }

        else if (key == "Switch") {
          horizontalScreen = !horizontalScreen;
          uiPrefs.putBool("Switch", horizontalScreen);
        }
        else if (key == "HoldBucket") {
          holdBucket = (valueInt != 0);
          uiPrefs.putBool("HoldBucket", holdBucket);
        }
        else if (key == "HoldAux") {
          holdAux = (valueInt != 0);
          uiPrefs.putBool("HoldAux", holdAux);
        }
        else if (key == "DarkMode") {
          darkMode = (valueInt != 0);
          uiPrefs.putBool("darkMode", darkMode);
        }

      }
      break;
    default:
      break;
  }
}

//-----------------------------------------------------------------------Robot I2S Audio-----------------------------------------------------------------

void setupI2SMic() {
  static const i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = I2S_SAMPLE_RATE,
    .bits_per_sample = I2S_SAMPLE_BITS,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT, // Mic: usually mono
    .communication_format = I2S_COMM_FORMAT_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 4,
    .dma_buf_len = 256,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  static const i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_MIC_SCK,
    .ws_io_num = I2S_MIC_WS,
    .data_out_num = -1,         // Not used for input
    .data_in_num = I2S_MIC_SD
  };

  i2s_driver_install(MY_I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(MY_I2S_PORT, &pin_config);
  i2s_zero_dma_buffer(MY_I2S_PORT);
}

void enableMic() {
    if (currentI2SMode == I2S_MIC) {
        Serial.println("[I2S] Mic already enabled.");
        return;
    }
    Serial.println("[I2S] Switching to MIC: stopping audio, uninstalling I2S, and initializing mic...");
    audio.stopSong();
    esp_err_t res = i2s_driver_uninstall(MY_I2S_PORT);
    if (res == ESP_OK) {
        Serial.println("[I2S] I2S driver uninstalled successfully (for MIC).");
    } else {
        Serial.printf("[I2S] I2S driver uninstall for MIC returned code: %d\n", res);
    }
    setupI2SMic();
    currentI2SMode = I2S_MIC;
    Serial.println("[I2S] MIC enabled and ready.");
}


void disableMic() {
    if (currentI2SMode == I2S_MIC) {
        Serial.println("[I2S] Disabling MIC: uninstalling I2S driver...");
        esp_err_t res = i2s_driver_uninstall(MY_I2S_PORT);
        if (res == ESP_OK) {
            Serial.println("[I2S] I2S driver uninstalled successfully (MIC off).");
        } else {
            Serial.printf("[I2S] I2S driver uninstall for MIC returned code: %d\n", res);
        }
        currentI2SMode = I2S_NONE;
        Serial.println("[I2S] MIC disabled.");
    } else {
        Serial.println("[I2S] MIC not enabled, nothing to disable.");
    }
}

void streamMicToWebSocket() {
    if (!micStreamActive) return;

    size_t bytesRead = 0;
    int16_t buffer[I2S_READ_LEN]; // Or uint8_t, depending on your I2S sample format

    // Read from I2S (blocking, but fine if called from a dedicated task)
    esp_err_t res = i2s_read(MY_I2S_PORT, (void*)buffer, sizeof(buffer), &bytesRead, 20 / portTICK_RATE_MS);

    if (res == ESP_OK && bytesRead > 0) {
        // Send to all connected clients on your AsyncWebSocket
        if (wsCarInput.count() > 0) {
            wsCarInput.binaryAll((uint8_t*)buffer, bytesRead);
        }
    }
}

void playWavFileOnSpeaker(const String& filename) {
    Serial.printf("[AUDIO] playWavFileOnSpeaker: %s\n", filename.c_str());
    if (!SD.exists(filename.c_str())) {
        Serial.printf("[ERROR] File not found on SD: %s\n", filename.c_str());
        return;
    }
    disableMic();
    //stopAudio();
    enableSpeaker();
    audio.connecttoFS(SD, filename.c_str());
    currentlyPlayingFile = filename;           // <--- ADD THIS LINE!
    lastMediaProgressSend = 0;                 // <--- (reset progress timer)
    delay(50);
    if (!audio.isRunning()) Serial.println("[AUDIO] Playback did not start!");
    else Serial.println("[AUDIO] Playback started OK.");
}


void makeWavHeader(uint8_t* header, int sampleRate, int channels, int bitsPerSample, uint32_t dataLength) {
    // PCM WAV header
    uint32_t byteRate = sampleRate * channels * bitsPerSample / 8;
    uint16_t blockAlign = channels * bitsPerSample / 8;
    memcpy(header, "RIFF", 4);
    uint32_t chunkSize = 36 + dataLength;
    memcpy(header+4, &chunkSize, 4);
    memcpy(header+8, "WAVE", 4);
    memcpy(header+12, "fmt ", 4);
    uint32_t subChunk1Size = 16;
    memcpy(header+16, &subChunk1Size, 4);
    uint16_t audioFormat = 1;
    memcpy(header+20, &audioFormat, 2);
    memcpy(header+22, &channels, 2);
    memcpy(header+24, &sampleRate, 4);
    memcpy(header+28, &byteRate, 4);
    memcpy(header+32, &blockAlign, 2);
    memcpy(header+34, &bitsPerSample, 2);
    memcpy(header+36, "data", 4);
    memcpy(header+40, &dataLength, 4);
}

// This is your speaker setup from audio library
void enableSpeaker() {
    // Always ensure amp enable pin is set before playback
    pinMode(I2S_SPK_PA, OUTPUT);
    digitalWrite(I2S_SPK_PA, HIGH);  // Enable NS4168 PA

    if (currentI2SMode == I2S_SPEAKER) {
        Serial.println("[I2S] Speaker already enabled.");
        return;
    }
    Serial.println("[I2S] Switching to SPEAKER: stopping audio, uninstalling I2S, and initializing speaker...");

    // Always stop audio regardless of state
    audio.stopSong();

    // Only uninstall if previously MIC or SPEAKER was initialized
    if (currentI2SMode != I2S_NONE) {
        esp_err_t res = i2s_driver_uninstall(MY_I2S_PORT);
        delay(20); // Allow I2S peripheral to settle
        if (res == ESP_OK) {
            Serial.println("[I2S] I2S driver uninstalled successfully (for SPEAKER).");
        } else {
            Serial.printf("[I2S] I2S driver uninstall for SPEAKER returned code: %d\n", res);
        }
    }

    // Re-setup speaker I2S pinout and volume every time
    audio.setPinout(I2S_SPK_BCLK, I2S_SPK_LRCK, I2S_SPK_SD); // (10, 45, 9)
    audio.setVolume(15);  // Use your tested value (or 21 for max)
    currentI2SMode = I2S_SPEAKER;
    Serial.println("[I2S] SPEAKER enabled and ready.");
}

void sendDeviceMediaProgress() {
    // Only send if playing a file
    if (currentlyPlayingFile.length() > 0 && audio.isRunning()) {
        unsigned long now = millis();
        if (now - lastMediaProgressSend > 500) {  // Send progress update every 0.5s
            lastMediaProgressSend = now;
            // Duration and position may not be available in Audio.h; if so, just fake for now
            int duration = audio.getAudioFileDuration() / 1000; // seconds (implement this if not present)
            int pos = audio.getAudioCurrentTime() / 1000; // seconds (implement this if not present)
            wsCarInput.textAll("MEDIA_DEVICE_PROGRESS," + currentlyPlayingFile + "," + String(pos) + "," + String(duration));
        }
    }
}


//debug controls over serial---------------:
void stopAudio() {
  audio.stopSong();
  digitalWrite(I2S_SPK_PA, LOW);
  playbackStarted = false;
}

void pauseAudio() {
  if (audio.isRunning()) {
    audio.stopSong();
    isPaused = true;
    Serial.println("[AUDIO] Paused (returns to start on resume)");
  }
  playbackStarted = false;
}

void resumeAudio() {
  if (!isPaused || playlist.empty()) return;
  Serial.printf("[AUDIO] Resuming %s from start\n", playlist[currentTrack].c_str());
  enableSpeaker();
  audio.connecttoFS(SD, playlist[currentTrack].c_str());
  playbackStarted = true;
  isPaused = false;
}


void playCurrentTrack() {
    if (playlist.empty() || currentTrack < 0 || currentTrack >= playlist.size()) {
        Serial.println("[playCurrentTrack] Playlist empty or currentTrack invalid!");
        return;
    }
    String filename = playlist[currentTrack];
    if (!filename.startsWith("/media/")) filename = "/media/mp3/" + filename;

    playWavFileOnSpeaker(filename);
    playbackStarted = true;
    isPaused = false;
}

void nextTrack() {
    if (playlist.empty()) return;
    if (shuffleMode) {
        int nextIdx;
        do {
            nextIdx = random(0, playlist.size());
        } while (playlist.size() > 1 && nextIdx == currentTrack);
        currentTrack = nextIdx;
    } else {
        currentTrack++;
        if (currentTrack >= (int)playlist.size()) {
            if (loopMode) currentTrack = 0;
            else { audio.stopSong(); isPaused = false; return; }
        }
    }
    playCurrentTrack();
}


void prevTrack() {
  if (playlist.empty()) return;
  if (shuffleMode) {
    int prevIdx;
    do {
      prevIdx = random(0, playlist.size());
    } while (playlist.size() > 1 && prevIdx == currentTrack);
    currentTrack = prevIdx;
  } else {
    currentTrack--;
    if (currentTrack < 0) {
      if (loopMode) currentTrack = playlist.size() - 1;
      else { audio.stopSong(); isPaused = false; return; }
    }
  }
  playCurrentTrack();
}


void setVolume(int vol) {
  if (vol < 0) vol = 0;
  if (vol > 21) vol = 21;
  currentVolume = vol;
  audio.setVolume(currentVolume);
  Serial.printf("[VOLUME] %d\n", currentVolume);
}

void randomTrack() {
  if (playlist.empty()) return;
  currentTrack = random(0, playlist.size());
  Serial.printf("[RANDOM] %s (Volume: %d)\n", playlist[currentTrack].c_str(), currentVolume);
  playCurrentTrack();
}

void nextFolder() {
  if (folderIndex.size() <= 1) {
    Serial.println("Only one folder in list.");
    return;
  }
  // Find which folder currentTrack is in
  int folder = 0;
  for (int i = 0; i < (int)folderIndex.size(); ++i) {
    if (currentTrack < (i + 1 < (int)folderIndex.size() ? folderIndex[i + 1] : (int)playlist.size())) {
      folder = i;
      break;
    }
  }
  folder = (folder + 1) % folderIndex.size();
  currentTrack = folderIndex[folder];
  Serial.printf("[NEXTFOLDER] Now playing from folder %s\n", mediaFolders[folder]);
  playCurrentTrack();
}

void resetESP() {
  Serial.println("Resetting ESP32...");
  delay(200);
  ESP.restart();
}

bool loadPlaylistFromIndex(const char* folder) {
    playlist.clear();
    String indexPath = String(folder) + "/.index";
    File idx = SD.open(indexPath);
    if (!idx) {
        Serial.printf("[ERROR] Can't open index: %s\n", indexPath.c_str());
        return false;
    }
    while (idx.available()) {
        String line = idx.readStringUntil('\n');
        line.trim();
        if (line.length() > 0) {
            int firstComma = line.indexOf(',');
            String fileOnly = (firstComma > 0) ? line.substring(0, firstComma) : line;
            // Prepend folder if not absolute
            if (!fileOnly.startsWith("/")) {
                if (!String(folder).endsWith("/"))
                    playlist.push_back(String(folder) + "/" + fileOnly);
                else
                    playlist.push_back(String(folder) + fileOnly);
            } else {
                playlist.push_back(fileOnly);
            }
        }
    }
    idx.close();
    currentTrack = 0;
    return !playlist.empty();
}


//--------------------------------------------------------------------Robot Cam Settings----------------------------------------------------------------

void applySavedCamSettings() {
    sensor_t *s = esp_camera_sensor_get();
    if (!s) return;

    int res        = camPrefs.getInt("camRes", 6);
    int rot        = camPrefs.getInt("camRot", 0);
    int sat        = camPrefs.getInt("camSat", 0);
    int gray       = camPrefs.getInt("camGray", 0);
    int bright     = camPrefs.getInt("camBright", 0);
    int contrast   = camPrefs.getInt("camContrast", 0);
    int sharp      = camPrefs.getInt("camSharp", 2);
    int denoise    = camPrefs.getInt("camDenoise", 0);
    // int gamma   = camPrefs.getInt("camGamma", 0); // Not supported
    // int fps    = camPrefs.getInt("camFps", 15);   // Only on startup
    int compression= camPrefs.getInt("camCompression", 12);
    int quality    = camPrefs.getInt("camQuality", 10);
    int led        = camPrefs.getInt("camLed", 0);

    s->set_framesize(s, (framesize_t)res);
    s->set_hmirror(s, (rot == 1 || rot == 3));
    s->set_vflip(s,   (rot == 2 || rot == 3));
    s->set_saturation(s, sat);
    s->set_special_effect(s, gray ? 2 : 0);
    s->set_brightness(s, bright);
    s->set_contrast(s, contrast);
    if (s->id.PID == OV2640_PID) s->set_sharpness(s, sharp);
    if (s->id.PID == OV2640_PID && s->set_denoise) s->set_denoise(s, denoise);
    if (s->id.PID == OV2640_PID && s->set_quality) s->set_quality(s, compression); // Optional
    s->set_quality(s, quality);

    // Set LED/flash/torch brightness if you have an LED
    #ifdef LED_PIN
    analogWrite(LED_PIN, led);
    #endif
}

void stopCamera() {
    esp_camera_deinit();
}

//--------------------------------------------------------------Firmware OTA----------------------------------------------------------------------
void otaUpdate(){
    // OTA (unchanged)
  ElegantOTA.begin(&server);  // Works with AsyncWebServer
  Serial.println("OTA ready: http://<device_ip>/update");
  ElegantOTA.onEnd([](bool success) {
      Serial.println("ElegantOTA finished, restarting...");
      //keymapPrefs.end();
      //preferences.end();
      delay(500);
      ESP.restart();
  });
}


String urlDecode(String input) {
    String s = "";
    char a, b;
    for (size_t i = 0; i < input.length(); i++) {
        if ((input[i] == '%') && ((a = input[i + 1]) && (b = input[i + 2])) &&
            (isxdigit(a) && isxdigit(b))) {
            if (a >= 'a') a -= 'a' - 'A';
            if (a >= 'A') a = a - 'A' + 10;
            else a -= '0';
            if (b >= 'a') b -= 'a' - 'A';
            if (b >= 'A') b = b - 'A' + 10;
            else b -= '0';
            s += char(16 * a + b);
            i += 2;
        } else if (input[i] == '+') {
            s += ' ';
        } else {
            s += input[i];
        }
    }
    return s;
}

String normalizedSSID(const String& raw) {
  String out = raw;
  out.trim();
  return out;
}

String getContentType(const String& filename) {
    if (filename.endsWith(".mp3"))  return "audio/mpeg";
    if (filename.endsWith(".wav"))  return "audio/wav";
    if (filename.endsWith(".ogg"))  return "audio/ogg";
    if (filename.endsWith(".mp4"))  return "video/mp4";
    if (filename.endsWith(".webm")) return "video/webm";
    if (filename.endsWith(".mov"))  return "video/quicktime";
    return "application/octet-stream";
}

size_t countMediaFilesInIndex(const String& idxPath) {
    File idx = SD.open(idxPath);
    if (!idx) return 0;
    size_t total = 0;
    while (idx.available()) {
        String line = idx.readStringUntil('\n');
        // Filter out folders and system files (same as readSdIndexBatch logic)
        int comma1 = line.indexOf(',');
        int comma2 = line.indexOf(',', comma1 + 1);
        if (comma1 < 0 || comma2 < 0) continue;
        String name = line.substring(0, comma1);
        bool isFolder = line.substring(comma1 + 1, comma2).toInt();
        if (isFolder) continue;
        // Use global extension list!
        if (hasSupportedExtension(name)) {
            total++;
        }
    }
    idx.close();
    return total;
}



void serverStart(){
  
  wifiRetryCount = wifiPrefs.getInt("wifiRetryCount", 5);
  wifiSSID = wifiPrefs.getString("ssid", "");
  wifiPassword = wifiPrefs.getString("password", "");

  // --- Wi-Fi Logic ---
  bool wifiConnected = false;
  if (wifiSSID.length() > 0) {
    Serial.printf("🟡 Found saved Wi-Fi ('%s'), trying to connect...\n", wifiSSID.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSSID.c_str(), wifiPassword.c_str());

    // Try for up to 8 seconds (32x 250ms)
    unsigned long startAttemptTime = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 8000) {
      delay(250);
      Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
      wifiConnected = true;
      Serial.println("\n✅ Connected to WiFi!");
      Serial.print("STA IP: ");
      Serial.println(WiFi.localIP());
      //startCameraServer();
    } else {
      Serial.println("\n❌ WiFi connect failed, switching to AP mode.");
    }
  }

  if (!wifiConnected) {
    Serial.println("🟠 No saved Wi-Fi, or connect failed. Starting AP mode for setup.");
    WiFi.mode(WIFI_AP);
    WiFi.softAP(ap_ssid);
    Serial.print("Started AP: ");
    Serial.println(ap_ssid);
    Serial.print("AP IP: ");
    Serial.println(WiFi.softAPIP());
  }

  // ---- SD card static file serving setup ----
  server.on("/", HTTP_GET, handleRoot);
  //server.serveStatic("/", SD, "/");

  // WebServer Routes (dynamic ESP endpoints)
  server.on("/favicon.ico", HTTP_GET, [](AsyncWebServerRequest *request){
      if (SD.exists("/favicon.ico")) {
          request->send(SD, "/favicon.ico", "image/x-icon");
      } else {
          request->send(404, "text/plain", "favicon.ico not found on SD card");
      }
  });

  server.on("/setup", HTTP_GET, handleWiFiSetup);
  server.on("/savewifi", HTTP_POST, handleSaveWiFi);
  server.on("/listwifi", HTTP_GET, handleListWiFi);
  server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest *request){ request->redirect("/setup"); });
  server.on("/fwlink", HTTP_GET, [](AsyncWebServerRequest *request){ request->redirect("/setup"); });

  server.on("/wifi_try_connect", HTTP_POST, [](AsyncWebServerRequest *request){
    if (request->hasParam("ssid")) {
      String ssid = normalizedSSID(request->getParam("ssid")->value());
      String password = wifiPrefs.getString(("wifi_" + ssid).c_str(), "");
      bool ok = connectToWiFiWithRetries(ssid, password, 5);
      request->send(200, "text/plain", ok ? "Connected" : "Failed");
    } else {
      request->send(400, "text/plain", "Missing ssid");
    }
  });


  //server.on("/stream", HTTP_GET, handle_jpg_stream);

  server.on("/calibrate_imu", HTTP_POST, [](AsyncWebServerRequest *request) {
    bool stored = imuPrefs.getBool("stored", false);
    int sys = imuPrefs.getInt("sys", -1);
    int gyro = imuPrefs.getInt("gyro", -1);
    int accel = imuPrefs.getInt("accel", -1);
    int mag = imuPrefs.getInt("mag", -1);

    if (stored && sys >= 0 && gyro >= 0 && accel >= 0 && mag >= 0) {
        String json = "{\"status\":\"stored\",\"sys\":" + String(sys) +
                      ",\"gyro\":" + String(gyro) +
                      ",\"accel\":" + String(accel) +
                      ",\"mag\":" + String(mag) + "}";
        request->send(200, "application/json", json);
        Serial.println("📤 Returned stored calibration data to frontend.");
    } else {
        request->send(200, "application/json", "{\"status\":\"requested\"}");
    }
  });

  // All below: unchanged, serve as normal
  server.on("/get_keymap", HTTP_GET, [](AsyncWebServerRequest *request){
    StaticJsonDocument<512> doc;
    doc["forward"] = keymapPrefs.getString("forward", "w");
    doc["backward"] = keymapPrefs.getString("backward", "s");
    doc["left"] = keymapPrefs.getString("left", "a");
    doc["right"] = keymapPrefs.getString("right", "d");
    doc["stop"] = keymapPrefs.getString("stop", " ");

    doc["armUp"] = keymapPrefs.getString("armUp", "u");
    doc["armDown"] = keymapPrefs.getString("armDown", "j");

    doc["bucketUp"] = keymapPrefs.getString("bucketUp", "u");
    doc["bucketDown"] = keymapPrefs.getString("bucketDown", "j");
    doc["auxUp"] = keymapPrefs.getString("auxUp", "i");
    doc["auxDown"] = keymapPrefs.getString("auxDown", "k");
    doc["led"] = keymapPrefs.getString("led", "l");
    doc["beacon"] = keymapPrefs.getString("beacon", "b");
    doc["emergency"] = keymapPrefs.getString("emergency", "e");

    String json;
    serializeJson(doc, json);
    request->send(200, "application/json", json);
  });

  server.on("/set_keymap", HTTP_POST, [](AsyncWebServerRequest *request){},
  NULL,
  [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, data, len);

    if (error) {
      request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
      return;
    }

    for (JsonPair kv : doc.as<JsonObject>()) {
      keymapPrefs.putString(kv.key().c_str(), kv.value().as<String>());
    }

    request->send(200, "application/json", "{\"status\":\"ok\"}");
  });

  server.on("/ota/upload", HTTP_POST, [](AsyncWebServerRequest *request){},
    [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
      if (index == 0) {
        if (len < 4 || data[0] != 0xE9) {
          request->send(400, "text/plain", "Invalid firmware format. Aborted.");
          otaValid = false;
          return;
        }
        otaValid = true;
        if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
          request->send(500, "text/plain", "OTA begin failed.");
          return;
        }
      }
      if (otaValid) {
        if (Update.write(data, len) != len) {
          request->send(500, "text/plain", "OTA write failed.");
          return;
        }
        if (final) {
          if (Update.end(true)) {
            request->send(200, "text/plain", "✅ Update complete. Rebooting...");
            shouldReboot = true;
          } else {
            request->send(500, "text/plain", "OTA end failed.");
          }
        }
      }
    });

  server.on("/version", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "application/json", String("{\"current\":\"") + FIRMWARE_VERSION + "\"}");
  });

  server.on("/list_saved_wifi", HTTP_GET, [](AsyncWebServerRequest *request) {
      String savedList = wifiPrefs.getString("networks", "");
      String json = "[";
      int lastIndex = 0, nextIndex;
      while ((nextIndex = savedList.indexOf(',', lastIndex)) != -1) {
          String ssid = normalizedSSID(savedList.substring(lastIndex, nextIndex));
          String wifiKey = "wifi_" + ssid;
          String pass = wifiPrefs.getString(wifiKey.c_str(), "");
          int retry = wifiPrefs.getInt(("retry_" + ssid).c_str(), 5);
          Serial.printf("[CHECK] Reading key: '%s'\n", ("aRt_" + ssid).c_str());
          bool autoRec = wifiPrefs.getBool(("aRt_" + ssid).c_str(), false);
          Serial.printf("[WIFI] ssid=%s autoReconnect=%d\n", ssid.c_str(), autoRec);
          Serial.printf("[WIFI] ssid=%s autoReconnect=%d\n", ssid.c_str(), autoRec);
          if (json.length() > 1) json += ",";
          json += "{\"ssid\":\"" + ssid + "\"";
          json += ",\"password\":\"" + pass + "\"";
          json += ",\"retry\":" + String(retry);
          json += ",\"autoReconnect\":" + String(autoRec ? "true" : "false");
          json += "}";
          lastIndex = nextIndex + 1;
      }
      if (lastIndex < savedList.length()) {
          String ssid = normalizedSSID(savedList.substring(lastIndex));
          String wifiKey = "wifi_" + ssid;
          String pass = wifiPrefs.getString(wifiKey.c_str(), "");
          int retry = wifiPrefs.getInt(("retry_" + ssid).c_str(), 5);
          Serial.printf("[CHECK] Reading key: '%s'\n", ("autoReconnect_" + ssid).c_str());
          bool autoRec = wifiPrefs.getBool(("aRt_" + ssid).c_str(), false);
          Serial.printf("[WIFI] ssid=%s autoReconnect=%d\n", ssid.c_str(), autoRec);
          Serial.printf("[WIFI] ssid=%s autoReconnect=%d\n", ssid.c_str(), autoRec);
          if (json.length() > 1) json += ",";
          json += "{\"ssid\":\"" + ssid + "\"";
          json += ",\"password\":\"" + pass + "\"";
          json += ",\"retry\":" + String(retry);
          json += ",\"autoReconnect\":" + String(autoRec ? "true" : "false");
          json += "}";
      }
      json += "]";
      request->send(200, "application/json", json);
  });

  server.on("/wifi_set_autoreconnect", HTTP_POST, [](AsyncWebServerRequest *request) {
    Serial.println("Received /wifi_set_autoreconnect POST:");

    int params = request->params();
    for (int i = 0; i < params; i++) {
      const AsyncWebParameter* p = request->getParam(i);
      Serial.printf("Param %d: %s = %s\n", i, p->name().c_str(), p->value().c_str());
    }

    if (request->hasParam("ssid", true) && request->hasParam("enabled", true)) {
      String ssid = normalizedSSID(request->getParam("ssid", true)->value());
      String enabledStr = request->getParam("enabled", true)->value();
      bool enabled = (enabledStr == "1");
      String key = "aRt_" + ssid;

      wifiPrefs.putBool(key.c_str(), enabled);
      Serial.printf("[WRITE] %s = %d\n", key.c_str(), enabled);

      bool verify = wifiPrefs.getBool(key.c_str(), enabled);
      Serial.printf("[VERIFY] getBool(%s) = %d\n", key.c_str(), verify);

      if (verify == enabled) {
        request->send(200, "text/plain", "OK");
      } else {
        Serial.printf("⚠️ Mismatch! Wrote %d but read %d\n", enabled, verify);
        request->send(500, "text/plain", "Failed to verify written value");
      }
    } else {
      Serial.println("⚠️ Missing parameters!");
      request->send(400, "text/plain", "Missing ssid or enabled param");
    }
  });

  server.on("/update_wifi_password", HTTP_GET, [](AsyncWebServerRequest *request) {
      if (request->hasParam("ssid") && request->hasParam("password")) {
          String ssid = normalizedSSID(request->getParam("ssid")->value());
          String password = request->getParam("password")->value();
          String wifiKey = "wifi_" + ssid;
          wifiPrefs.putString(wifiKey.c_str(), password);
          request->send(200, "text/plain", "Password updated");
      } else {
          request->send(400, "text/plain", "Missing parameters");
      }
  });

  server.on("/connect_saved_wifi", HTTP_GET, [](AsyncWebServerRequest *request) {
      if (request->hasParam("ssid")) {
          String ssid = normalizedSSID(request->getParam("ssid")->value());
          String wifiKey = "wifi_" + ssid;
          String pass = wifiPrefs.getString(wifiKey.c_str(), "");
          if (pass != "") {
              wifiPrefs.putString("ssid", ssid);
              wifiPrefs.putString("password", pass);

              Serial.println("🔄 Switching to saved Wi-Fi: " + ssid);
              stopWebServerAndWS();
              delay(300);

              connectToWiFiWithRetries(ssid, pass, wifiRetryCount);

              wifiSSID = ssid;
              wifiPassword = pass;
              wifiConnecting = true;
              wifiConnectStartTime = millis();

              request->send(200, "text/plain", "Switching Wi-Fi, please wait...");
          } else {
              request->send(404, "text/plain", "SSID not found");
          }
      } else {
          request->send(400, "text/plain", "Missing SSID parameter");
      }
  });

  server.on("/update_retry_count", HTTP_GET, [](AsyncWebServerRequest *request) {
      if (request->hasParam("ssid") && request->hasParam("count")) {
          String ssid = normalizedSSID(request->getParam("ssid")->value());
          int count = request->getParam("count")->value().toInt();
          if (count >= 1 && count <= 10) {
              wifiPrefs.putInt(("retry_" + ssid).c_str(), count);
              request->send(200, "text/plain", "Retry count updated for " + ssid);
          } else {
              request->send(400, "text/plain", "Retry count must be between 1 and 10");
          }
      } else {
          request->send(400, "text/plain", "Missing ssid or count parameter");
      }
  });

  server.on("/get_camera_ip", HTTP_GET, [](AsyncWebServerRequest *request) {
    String camIp = WiFi.localIP().toString();
    String json = "{\"ip\":\"" + camIp + "\"}";
    request->send(200, "application/json", json);
  });

  server.on("/setsettings", HTTP_POST, [](AsyncWebServerRequest *request) {},
    NULL,
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t index, size_t total) {
      String body;
      for (size_t i = 0; i < len; i++) body += (char)data[i];
      DynamicJsonDocument doc(512);
      DeserializationError error = deserializeJson(doc, body);
      if (error) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
      }
      //camPrefs.begin("cam", false);
      for (JsonPair kv : doc.as<JsonObject>()) {
        camPrefs.putInt(kv.key().c_str(), kv.value().as<int>());
      }
      //camPrefs.end();

      sensor_t *s = esp_camera_sensor_get();

      if (doc.containsKey("res"))           s->set_framesize(s, (framesize_t)doc["res"].as<int>());
      if (doc.containsKey("quality"))       s->set_quality(s, doc["quality"].as<int>());
      if (doc.containsKey("contrast"))      s->set_contrast(s, doc["contrast"].as<int>());
      if (doc.containsKey("brightness"))    s->set_brightness(s, doc["brightness"].as<int>());
      if (doc.containsKey("saturation"))    s->set_saturation(s, doc["saturation"].as<int>());
      if (doc.containsKey("gray"))          s->set_special_effect(s, doc["gray"].as<int>() ? 2 : 0);
      if (doc.containsKey("hmirror"))       s->set_hmirror(s, doc["hmirror"].as<int>());
      if (doc.containsKey("vflip"))         s->set_vflip(s, doc["vflip"].as<int>());
      if (doc.containsKey("awb"))           s->set_whitebal(s, doc["awb"].as<int>());
      if (doc.containsKey("wb_mode"))       s->set_wb_mode(s, doc["wb_mode"].as<int>());
      if (doc.containsKey("aec"))           s->set_exposure_ctrl(s, doc["aec"].as<int>());
      if (doc.containsKey("ae_level"))      s->set_ae_level(s, doc["ae_level"].as<int>());
      if (doc.containsKey("aec_value"))     s->set_aec_value(s, doc["aec_value"].as<int>());
      if (doc.containsKey("agc"))           s->set_gain_ctrl(s, doc["agc"].as<int>());
      if (doc.containsKey("agc_gain"))      s->set_agc_gain(s, doc["agc_gain"].as<int>());
      if (doc.containsKey("gainceiling"))   s->set_gainceiling(s, (gainceiling_t)doc["gainceiling"].as<int>());
      if (doc.containsKey("awb_gain"))      s->set_awb_gain(s, doc["awb_gain"].as<int>());
      if (doc.containsKey("colorbar"))      s->set_colorbar(s, doc["colorbar"].as<int>());
      if (doc.containsKey("lenc"))          s->set_lenc(s, doc["lenc"].as<int>());
      if (doc.containsKey("bpc"))           s->set_bpc(s, doc["bpc"].as<int>());
      if (doc.containsKey("wpc"))           s->set_wpc(s, doc["wpc"].as<int>());
      if (doc.containsKey("dcw"))           s->set_dcw(s, doc["dcw"].as<int>());
      if (doc.containsKey("raw_gma"))       s->set_raw_gma(s, doc["raw_gma"].as<int>());
      if (doc.containsKey("special_effect"))s->set_special_effect(s, doc["special_effect"].as<int>());

      // Custom fields: led, sharp, gamma, compression, etc
      // Implement as needed if you have external logic!

      request->send(200, "application/json", "{\"status\":\"saved\"}");
    }
  );

  server.on("/getsettings", HTTP_GET, [](AsyncWebServerRequest *request){
    sensor_t *s = esp_camera_sensor_get();
    String json = "{";
    json += "\"res\":" + String(s->status.framesize) + ",";
    json += "\"quality\":" + String(s->status.quality) + ",";
    json += "\"contrast\":" + String(s->status.contrast) + ",";
    json += "\"brightness\":" + String(s->status.brightness) + ",";
    json += "\"saturation\":" + String(s->status.saturation) + ",";
    json += "\"gray\":" + String(s->status.special_effect == 2 ? 1 : 0) + ",";
    json += "\"hmirror\":" + String(s->status.hmirror) + ",";
    json += "\"vflip\":" + String(s->status.vflip) + ",";
    json += "\"awb\":" + String(s->status.awb) + ",";
    json += "\"wb_mode\":" + String(s->status.wb_mode) + ",";
    json += "\"aec\":" + String(s->status.aec) + ",";
    json += "\"ae_level\":" + String(s->status.ae_level) + ",";
    json += "\"aec_value\":" + String(s->status.aec_value) + ",";
    json += "\"agc\":" + String(s->status.agc) + ",";
    json += "\"agc_gain\":" + String(s->status.agc_gain) + ",";
    json += "\"gainceiling\":" + String(s->status.gainceiling) + ",";
    json += "\"awb_gain\":" + String(s->status.awb_gain) + ",";
    json += "\"colorbar\":" + String(s->status.colorbar) + ",";
    json += "\"lenc\":" + String(s->status.lenc) + ",";
    json += "\"bpc\":" + String(s->status.bpc) + ",";
    json += "\"wpc\":" + String(s->status.wpc) + ",";
    json += "\"dcw\":" + String(s->status.dcw) + ",";
    json += "\"raw_gma\":" + String(s->status.raw_gma) + ",";
    json += "\"special_effect\":" + String(s->status.special_effect);

    // ---- ADD THESE CUSTOM UI FIELDS ----
    json += ",\"darkMode\":" + String(darkMode ? 1 : 0);
    json += ",\"holdBucket\":" + String(holdBucket ? 1 : 0);
    json += ",\"holdAux\":" + String(holdAux ? 1 : 0);
    json += ",\"horizontalScreen\":" + String(horizontalScreen ? 1 : 0);
    // Add more here if needed

    json += "}";

    request->send(200, "application/json", json);
  });

  // List SD card files (with metadata and folder navigation) -- Hides .path and hidden files
  server.on("/list_sd_files", HTTP_GET, [](AsyncWebServerRequest *request) {
      Serial.println("📁 /list_sd_files requested (INDEX)");

      int start = request->hasParam("start") ? request->getParam("start")->value().toInt() : 0;
      int count = request->hasParam("count") ? request->getParam("count")->value().toInt() : 40;
      if (count < 1 || count > 256) count = 40;

      String path = request->hasParam("path") ? request->getParam("path")->value() : "/";
      if (!path.startsWith("/")) path = "/" + path;
      if (path.endsWith("/") && path.length() > 1) path.remove(path.length() - 1);

      bool showSystem = false;
      if (request->hasParam("showSystem")) {
          showSystem = request->getParam("showSystem")->value().toInt() != 0;
      }

      // --- 🟢 NEW: Auto-clear pendingReindex if index exists now ---
      if (pendingReindex && SD.exists(path + "/.index")) {
          pendingReindex = false;
          Serial.println("[Auto-clear] pendingReindex reset by file presence");
      }

      // Check if folder exists at all
      if (!SD.exists(path)) {
          request->send(200, "application/json", "[]");
          return;
      }

      // Check if .index file exists
      if (!SD.exists(path + "/.index") || pendingReindex) {
          // If folder is empty (no files), return empty array!
          File dir = SD.open(path);
          if (dir && dir.isDirectory()) {
              if (!dir.openNextFile()) {
                  request->send(200, "application/json", "[]");
                  dir.close();
                  return;
              }
              dir.close();
          }
          // If NOT empty, still reindex
          if (!pendingReindex) {
              reindexPath = path;
              pendingReindex = true;
              reindexCount = 0;
          }
          request->send(202, "application/json", "{\"status\":\"reindexing\"}");
          return;
      }

      DynamicJsonDocument doc(4096);
      JsonArray arr = doc.to<JsonArray>();
      readSdIndexBatch(path + "/.index", start, count, arr, showSystem);

      String output;
      serializeJson(arr, output);
      request->send(200, "application/json", output);
  });



  server.on("/sd_reindex", HTTP_POST, [](AsyncWebServerRequest *request) {
      String path = "/";
      if (request->hasParam("path", true)) {
          path = request->getParam("path", true)->value();
      } else if (request->hasParam("path", false)) {
          path = request->getParam("path", false)->value();
      }
      if (!path.startsWith("/")) path = "/" + path;

      if (pendingReindex) {
          request->send(429, "text/plain", "Reindex already in progress");
          return;
      }
      reindexPath = path;
      pendingReindex = true;
      reindexCount = 0;
      request->send(202, "text/plain", "Indexing started, reload soon");
  });

  server.on("/sd_reindex_status", HTTP_GET, [](AsyncWebServerRequest *request) {
      String json = "{";
      json += "\"pending\":" + String(pendingReindex ? "true" : "false");
      json += ",\"path\":\"" + String(reindexPath) + "\"";
      json += ",\"count\":" + String(reindexCount);
      json += ",\"total\":" + String(reindexTotal);
      json += ",\"counting\":" + String(reindexCounting ? "true" : "false");
      json += "}";
      request->send(200, "application/json", json);
  });



  server.on("/sd_info", HTTP_GET, [](AsyncWebServerRequest *request){
      uint64_t total = SD.totalBytes();
      uint64_t used = SD.usedBytes();
      uint64_t free = total - used;

      String json = "{\"total\":" + String(total) +
                    ",\"used\":" + String(used) +
                    ",\"free\":" + String(free) + "}";
      request->send(200, "application/json", json);
  });

  server.on("/download_sd", HTTP_GET, [](AsyncWebServerRequest *request){
      if (!request->hasParam("path")) {
          request->send(400, "text/plain", "Missing path");
          return;
      }
      String path = request->getParam("path")->value();
      if (!path.startsWith("/")) path = "/" + path;  // <-- Ensure leading slash
      if (!SD.exists(path)) {
          request->send(404, "text/plain", "File not found");
          return;
      }
      request->send(SD, path, String(), true);  // true = download
  });

  server.on("/recover_sd", HTTP_GET, [](AsyncWebServerRequest *request){
      if (!request->hasParam("name")) {
          request->send(400, "text/plain", "Missing name");
          return;
      }
      String name = request->getParam("name")->value();
      String recycleFile = "/recycle/" + name;
      String pathFile = recycleFile + ".path";
      String dst = "/" + name;
      // Try to read original path
      if (SD.exists(pathFile)) {
          File f = SD.open(pathFile, FILE_READ);
          if (f) {
              String origPath = f.readString();
              origPath.trim();
              if (origPath.length() > 0 && origPath[0] == '/') {
                  dst = origPath;
              }
              f.close();
          }
      }
      if (SD.exists(dst)) {
          request->send(409, "text/plain", "File already exists in destination");
          return;
      }
      // Ensure destination folder exists
      int lastSlash = dst.lastIndexOf('/');
      if (lastSlash > 0) {
          String folderPath = dst.substring(0, lastSlash);
          if (!SD.exists(folderPath)) SD.mkdir(folderPath.c_str());
      }
      if (SD.rename(recycleFile, dst)) {
          if (SD.exists(pathFile)) SD.remove(pathFile); // Clean up metadata

          // Invalidate /recycle index and restored file's parent index
          String recycleIdx = "/recycle/.index";
          if (SD.exists(recycleIdx)) SD.remove(recycleIdx);
          String folder = dst.substring(0, dst.lastIndexOf('/'));
          if (folder == "") folder = "/";
          String idxPath = folder + "/.index";
          if (SD.exists(idxPath)) SD.remove(idxPath);

          request->send(200, "text/plain", "Recovered");
      } else {
          request->send(500, "text/plain", "Failed to recover file");
      }

  });

  server.on("/permadelete_sd", HTTP_POST, [](AsyncWebServerRequest *request){
    if (!request->hasParam("path")) {
      request->send(400, "text/plain", "Missing path");
      return;
    }
    String path = request->getParam("path")->value();
    if (!path.startsWith("/")) path = "/" + path;

    if (!SD.exists(path)) {
      request->send(404, "text/plain", "Not Found");
      return;
    }

    File f = SD.open(path);
    if (!f) {
      request->send(404, "text/plain", "Not Found");
      return;
    }
    bool isDir = f.isDirectory();
    f.close();

    bool ok = false;
    if (isDir) {
      ok = SD.rmdir(path.c_str()); // Only works if folder is empty
    } else {
      ok = SD.remove(path.c_str());
    }
    if (ok) {
        // Invalidate index for parent folder
        String folder = path.substring(0, path.lastIndexOf('/'));
        if (folder == "") folder = "/";
        String idxPath = folder + "/.index";
        if (SD.exists(idxPath)) SD.remove(idxPath);
        request->send(200, "text/plain", "Deleted");
    } else {
        request->send(500, "text/plain", "Failed to delete");
    }

  });

  server.on("/delete_sd", HTTP_POST, [](AsyncWebServerRequest *request) {
      String originalPath;
      bool permanent = false;

      // --- Robust permanent flag check (param or arg) ---
      if (request->hasParam("permanent")) {
          String permVal = request->getParam("permanent")->value();
          permanent = (permVal == "1" || permVal == "true" || permVal == "yes");
      } else if (request->hasArg("permanent")) {
          String permVal = request->arg("permanent");
          permanent = (permVal == "1" || permVal == "true" || permVal == "yes");
      }

      // --- Robust path extraction ---
      if (request->hasParam("path")) {
          originalPath = request->getParam("path")->value();
          Serial.printf("[delete_sd] Got path from param: %s\n", originalPath.c_str());
      } else if (request->hasArg("path")) {
          originalPath = request->arg("path");
          Serial.printf("[delete_sd] Got path from arg: %s\n", originalPath.c_str());
      } else if (request->contentType().startsWith("application/x-www-form-urlencoded")) {
          // Fallback: Raw POST body (not common, but let's be robust)
          String body = request->arg(0);
          Serial.printf("[delete_sd] Raw POST body: %s\n", body.c_str());
          int idx = body.indexOf("path=");
          if (idx != -1) {
              originalPath = body.substring(idx + 5);
              int amp = originalPath.indexOf('&');
              if (amp != -1) originalPath = originalPath.substring(0, amp);
              originalPath.replace('+', ' ');
              originalPath = urlDecode(originalPath);
          }
      }

      if (!originalPath.length()) {
          Serial.println("[delete_sd] Missing 'path' parameter!");
          request->send(400, "text/plain", "Missing 'path' parameter");
          return;
      }

      if (!originalPath.startsWith("/")) originalPath = "/" + originalPath;
      Serial.println("Requested delete: " + originalPath);

      if (!SD.exists(originalPath)) {
          Serial.println("File not found: " + originalPath);
          request->send(404, "text/plain", "File not found");
          return;
      }

      // --- Permanent delete branch ---
      if (permanent) {
          if (SD.remove(originalPath)) {
              // Invalidate index for the parent folder
              String folder = originalPath.substring(0, originalPath.lastIndexOf('/'));
              if (folder == "") folder = "/";
              String idxPath = folder + "/.index";
              if (SD.exists(idxPath)) SD.remove(idxPath);
              Serial.printf("Permanently deleted: %s (index invalidated: %s)\n", originalPath.c_str(), idxPath.c_str());
              request->send(200, "text/plain", "Permanently deleted");
          } else {
              Serial.printf("Failed to permanently delete: %s\n", originalPath.c_str());
              request->send(500, "text/plain", "Failed to permanently delete");
          }
          return;
      }


      // --- Move to recycle ---
      if (!SD.exists("/recycle")) {
          SD.mkdir("/recycle");
          Serial.println("Created /recycle folder");
      }

      String filename = originalPath.substring(originalPath.lastIndexOf("/") + 1);
      String recyclePath = "/recycle/" + filename;
      int count = 1;
      String testRecyclePath = recyclePath;
      while (SD.exists(testRecyclePath)) {
          int dot = filename.lastIndexOf('.');
          String base = (dot >= 0) ? filename.substring(0, dot) : filename;
          String ext  = (dot >= 0) ? filename.substring(dot) : "";
          testRecyclePath = "/recycle/" + base + "_" + String(count++) + ext;
      }
      recyclePath = testRecyclePath;

      // Save metadata
      String pathMetaFile = recyclePath + ".path";
      File meta = SD.open(pathMetaFile, FILE_WRITE);
      if (meta) {
          meta.print(originalPath);
          meta.close();
      } else {
          Serial.printf("⚠️ Failed to write .path metadata for %s\n", recyclePath.c_str());
      }

      if (SD.rename(originalPath, recyclePath)) {
          // Invalidate index for parent folder
          String folder = originalPath.substring(0, originalPath.lastIndexOf('/'));
          if (folder == "") folder = "/";
          String idxPath = folder + "/.index";
          if (SD.exists(idxPath)) SD.remove(idxPath);
          request->send(200, "text/plain", "Moved to recycle: " + recyclePath);
      } else {
          Serial.println("Failed to move file to recycle!");
          if (SD.exists(pathMetaFile)) SD.remove(pathMetaFile);
          request->send(500, "text/plain", "Failed to move file");
      }

  });

  server.on("/upload_sd", HTTP_POST,
    // 1st handler: not needed, move everything to upload handler
    [](AsyncWebServerRequest *request) {},
    // Upload handler: use per-request context
    [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final) {
      UploadCtx *ctx = reinterpret_cast<UploadCtx*>(request->_tempObject);

      if (index == 0) {
        if (!ctx) {
          ctx = new UploadCtx();
          request->_tempObject = (void*)ctx;
        }
        // Always read the path from the POST form param
        String uploadPath;
        if (request->hasParam("path", true)) {
          uploadPath = urlDecode(request->getParam("path", true)->value());
        } else if (request->hasParam("path", false)) {
          uploadPath = urlDecode(request->getParam("path", false)->value());
        } else {
          uploadPath = "/" + filename;
        }
        if (!uploadPath.startsWith("/")) uploadPath = "/" + uploadPath;
        ctx->uploadPath = uploadPath;

        Serial.printf(">>> Starting upload: %s\n", ctx->uploadPath.c_str());

        // Ensure folder exists
        ensureFolderExists(ctx->uploadPath);

        // Move to recycle if file exists
        if (SD.exists(ctx->uploadPath)) {
          String shortName = ctx->uploadPath.substring(ctx->uploadPath.lastIndexOf("/") + 1);
          String recyclePath = "/recycle/" + shortName;
          if (!SD.exists("/recycle")) SD.mkdir("/recycle");
          int count = 1;
          String testRecyclePath = recyclePath;
          while (SD.exists(testRecyclePath)) {
            int dot = shortName.lastIndexOf('.');
            String base = (dot >= 0) ? shortName.substring(0, dot) : shortName;
            String ext  = (dot >= 0) ? shortName.substring(dot) : "";
            testRecyclePath = "/recycle/" + base + "_" + String(count++) + ext;
          }
          recyclePath = testRecyclePath;
          SD.rename(ctx->uploadPath, recyclePath);
        }

        ctx->uploadFile = SD.open(ctx->uploadPath, FILE_WRITE);
        if (!ctx->uploadFile) {
          request->send(500, "text/plain", "Failed to open file for writing");
          delete ctx; request->_tempObject = nullptr;
          return;
        }
      }

      // Write chunk
      if (ctx && ctx->uploadFile) {
        size_t toWrite = len, offset = 0;
        while (toWrite > 0) {
          size_t chunk = min(toWrite, (size_t)4096);
          size_t written = ctx->uploadFile.write(data + offset, chunk);
          if (written != chunk) {
            ctx->uploadFile.close();
            request->send(500, "text/plain", "SD write error");
            delete ctx; request->_tempObject = nullptr;
            Serial.printf("!!! SD write error at index=%u\n", (unsigned)index);
            return;
          }
          toWrite -= chunk;
          offset += chunk;
        }
      }

      if (final) {
        if (ctx && ctx->uploadFile) {
          ctx->uploadFile.close();
          // Invalidate index
          String folder = ctx->uploadPath.substring(0, ctx->uploadPath.lastIndexOf('/'));
          if (folder == "") folder = "/";
          String idxPath = folder + "/.index";
          if (SD.exists(idxPath)) SD.remove(idxPath);
          Serial.printf("<<< Upload finished (%s), index invalidated: %s\n", ctx->uploadPath.c_str(), idxPath.c_str());
        }
        request->send(200, "text/plain", "Upload complete");
        delete ctx; request->_tempObject = nullptr;
      }
    }
  );


  server.on("/create_file", HTTP_POST, [](AsyncWebServerRequest *request){
    if (!request->hasParam("path")) {
      request->send(400, "text/plain", "Missing path");
      return;
    }
    String path = request->getParam("path")->value();
    if (!path.startsWith("/")) path = "/" + path;

    path = ensureUniqueFilename(path);

    File file = SD.open(path, FILE_WRITE);
    if (!file) {
      request->send(500, "text/plain", "Failed to create file");
      return;
    }
    file.close();
    // Invalidate index for parent
    String folder = path.substring(0, path.lastIndexOf('/'));
    if (folder == "") folder = "/";
    String idxPath = folder + "/.index";
    if (SD.exists(idxPath)) SD.remove(idxPath);

    request->send(200, "text/plain", path);

  });

  server.on("/create_folder", HTTP_POST, [](AsyncWebServerRequest *request){
    if (!request->hasParam("path")) {
      request->send(400, "text/plain", "Missing path");
      return;
    }
    String path = request->getParam("path")->value();
    if (!path.startsWith("/")) path = "/" + path;

    // Check for duplicates, auto-increment as above
    String base = path;
    int count = 1;
    String newPath = path;
    while (SD.exists(newPath.c_str())) {
      newPath = base + "(" + String(count++) + ")";
    }

    if (SD.mkdir(newPath.c_str())) {
        // Invalidate index for parent
        String folder = newPath.substring(0, newPath.lastIndexOf('/'));
        if (folder == "") folder = "/";
        String idxPath = folder + "/.index";
        if (SD.exists(idxPath)) SD.remove(idxPath);

        request->send(200, "text/plain", newPath);
    } else {
        request->send(500, "text/plain", "Failed to create folder");
    }

  });


  // Optional reboot endpoint
  server.on("/reboot", HTTP_POST, [](AsyncWebServerRequest *request){
    request->send(200, "text/plain", "Rebooting...");
    delay(100);
    ESP.restart();
  });

  server.on("/control", HTTP_GET, [](AsyncWebServerRequest *request) {
      sensor_t *s = esp_camera_sensor_get();
      if (!s) {
          request->send(500, "text/plain", "No camera sensor found");
          return;
      }

      bool changed = false;
      // Helper lambda to update prefs and only set if different
      auto updatePref = [&](const char* key, int value) {
          if (camPrefs.getInt(key, INT32_MIN) != value) {
              camPrefs.putInt(key, value);
              changed = true;
          }
      };

      // ------------- CAMERA SETTINGS -------------
      // GET param & apply for each
      if (request->hasParam("res")) {
          int prevRes = camPrefs.getInt("camRes", FRAMESIZE_QVGA);
          int newRes = request->getParam("res")->value().toInt();
          if (prevRes != newRes) {
              camPrefs.putInt("camRes", newRes);
          }

      }

      if (request->hasParam("fps")) {
          int val = request->getParam("fps")->value().toInt();
          updatePref("camFps", val);
          s->set_quality(s, val);  // Most sensors only support frame rate via init, not dynamic set. Optionally skip.
      }
      if (request->hasParam("rot")) {
          int val = request->getParam("rot")->value().toInt();
          updatePref("camRot", val);
          // 0: Normal, 1: Mirror, 2: Flip, 3: Mirror+Flip
          s->set_hmirror(s, (val == 1 || val == 3));
          s->set_vflip(s,   (val == 2 || val == 3));
      }
      if (request->hasParam("sat")) {
          int val = request->getParam("sat")->value().toInt();
          updatePref("camSat", val);
          s->set_saturation(s, val);
      }
      if (request->hasParam("gray")) {
          int val = request->getParam("gray")->value().toInt();
          updatePref("camGray", val);
          s->set_special_effect(s, val ? 2 : 0); // 2 = grayscale for OV2640
      }
      if (request->hasParam("led")) {
          int val = request->getParam("led")->value().toInt();
          updatePref("camLed", val);
          // You must implement LED brightness control if you have one (e.g., analogWrite to a pin)
          // analogWrite(LED_PIN, val);
      }
      if (request->hasParam("bright")) {
          int val = request->getParam("bright")->value().toInt();
          updatePref("camBright", val);
          s->set_brightness(s, val);
      }
      if (request->hasParam("contrast")) {
          int val = request->getParam("contrast")->value().toInt();
          updatePref("camContrast", val);
          s->set_contrast(s, val);
      }
      if (request->hasParam("sharp")) {
          int val = request->getParam("sharp")->value().toInt();
          updatePref("camSharp", val);
          // OV2640 only: supports 0–3, OV5640: check data sheet
          if (s->id.PID == OV2640_PID) s->set_sharpness(s, val);
          // You may need to skip for OV5640 if not supported
      }
      if (request->hasParam("denoise")) {
          int val = request->getParam("denoise")->value().toInt();
          updatePref("camDenoise", val);
          // Some sensors support, some don't
          if (s->id.PID == OV2640_PID && s->set_denoise) s->set_denoise(s, val);
      }
      if (request->hasParam("gamma")) {
          int val = request->getParam("gamma")->value().toInt();
          updatePref("camGamma", val);
          // Not all sensors support gamma. Ignore or apply if available
          // s->set_gamma(s, val); // Uncomment if supported
      }
      if (request->hasParam("compression")) {
          int val = request->getParam("compression")->value().toInt();
          updatePref("camCompression", val);
          // OV2640 only: set compression. You may need to skip for OV5640
          if (s->id.PID == OV2640_PID && s->set_quality) s->set_quality(s, val);
      }
      if (request->hasParam("quality")) {
          int val = request->getParam("quality")->value().toInt();
          updatePref("camQuality", val);
          s->set_quality(s, val);
      }

      request->send(200, "text/plain", "OK");
  });

  server.on("/led", HTTP_GET, [](AsyncWebServerRequest *request){
      if (request->hasParam("brightness")) {
          int brightness = request->getParam("brightness")->value().toInt();
          // Set your LED brightness here
          request->send(200, "text/plain", String("LEDSTATE:") + (brightness > 0 ? "1" : "0"));
      } else {
          request->send(400, "text/plain", "Missing brightness");
      }
  });


  server.onNotFound([](AsyncWebServerRequest *request) {
      String path = request->url();
      // ---- Custom: handle /media/* with HTTP Range support ----
      if (path.startsWith("/media/")) {
          String fileName = path;
          if (!SD.exists(fileName)) {
              request->send(404, "text/plain", "File not found");
              return;
          }
          File file = SD.open(fileName);
          if (!file) {
              request->send(404, "text/plain", "File not found");
              return;
          }
          size_t fileSize = file.size();

          if (request->hasHeader("Range")) {
              String rangeHeader = request->header("Range");
              unsigned long rangeStart = 0, rangeEnd = fileSize - 1;
              int eq = rangeHeader.indexOf('=');
              int dash = rangeHeader.indexOf('-');
              if (eq >= 0 && dash >= 0 && dash > eq) {
                  String startStr = rangeHeader.substring(eq + 1, dash);
                  String endStr = rangeHeader.substring(dash + 1);
                  rangeStart = (startStr.length() > 0) ? startStr.toInt() : 0;
                  rangeEnd = (endStr.length() > 0) ? endStr.toInt() : (fileSize - 1);
                  if (rangeEnd >= fileSize) rangeEnd = fileSize - 1;
                  if (rangeStart > rangeEnd) rangeStart = 0;
              }
              size_t chunkSize = rangeEnd - rangeStart + 1;
              file.seek(rangeStart);

              AsyncWebServerResponse *response = request->beginResponse("application/octet-stream", chunkSize,
                  [file, rangeStart, rangeEnd](uint8_t *buffer, size_t maxLen, size_t index) mutable -> size_t {
                      size_t toRead = maxLen;
                      size_t remaining = rangeEnd - rangeStart + 1 - index;
                      if (toRead > remaining) toRead = remaining;
                      return file.read(buffer, toRead);
                  }
              );
              String contentType = getContentType(fileName);
              response->addHeader("Content-Type", contentType);
              response->addHeader("Accept-Ranges", "bytes");
              response->addHeader("Content-Range", "bytes " + String(rangeStart) + "-" + String(rangeEnd) + "/" + String(fileSize));
              response->setCode(206);
              request->send(response);
              return;
          }

          // Fallback: serve entire file (no seeking)
          AsyncWebServerResponse *response = request->beginResponse(SD, fileName, getContentType(fileName), true);
          response->addHeader("Accept-Ranges", "bytes");
          request->send(response);
          return;
      }
      // ---- End of /media/ custom ----

      // Normal static file serving for everything else
      // Serve all frontend files from /web/
      if (path == "/") path = "/index.html";
      String webPath = "/web" + path;
      if (SD.exists(webPath)) {
          request->send(SD, webPath, String(), false);
      } else if (SD.exists("/web/404.html")) {
          request->send(SD, "/web/404.html", "text/html");
      } else {
          request->send(404, "text/plain", "File Not Found");
      }
  });


  // Add after other server.on() calls in serverStart()
  server.on("/list_media_files", HTTP_GET, [](AsyncWebServerRequest *request) {
      // For each media folder...
      bool reindexNeeded = false;
      std::vector<String> foundFiles;

      for (const auto& folder : mediaFolders) {
          String indexPath = String(folder) + "/.index";
          indexPath.replace("//", "/");

          if (!SD.exists(indexPath)) {
              // Start async reindex if not already running
              if (!pendingReindex) {
                  reindexPath = folder; // Your global for the background task
                  pendingReindex = true;
              }
              reindexNeeded = true;
              continue;
          }

          // Read the .index file (one per folder)
          File idx = SD.open(indexPath);
          if (!idx) continue;

          while (idx.available()) {
              String line = idx.readStringUntil('\n');
              // Optionally parse: name,isDir,size,date
              int comma = line.indexOf(',');
              String name = (comma > 0) ? line.substring(0, comma) : line;
              if (!name.endsWith(".mp3") && !name.endsWith(".wav")) continue;
              String fullpath = String(folder) + "/" + name;
              fullpath.replace("//", "/");
              foundFiles.push_back(fullpath);
          }
          idx.close();
      }

      if (reindexNeeded) {
          DynamicJsonDocument doc(256);
          doc["status"] = "reindexing";
          String out;
          serializeJson(doc, out);
          request->send(200, "application/json", out);
          return;
      }

      // Output result as before, with batching/pagination
      int start = request->hasParam("start") ? request->getParam("start")->value().toInt() : 0;
      int count = request->hasParam("count") ? request->getParam("count")->value().toInt() : 40;
      if (count < 1 || count > 256) count = 40;

      std::sort(foundFiles.begin(), foundFiles.end());
      int total = foundFiles.size();
      int end = min(start + count, total);

      DynamicJsonDocument doc(8192);
      JsonArray arr = doc.createNestedArray("files");
      for (int i = start; i < end; ++i) arr.add(foundFiles[i]);
      doc["start"] = start;
      doc["count"] = arr.size();
      doc["total"] = total;

      String out;
      serializeJson(doc, out);
      request->send(200, "application/json", out);
  });



  server.on("/play_on_device", HTTP_GET, [](AsyncWebServerRequest *request) {
      if (!request->hasParam("file")) {
          request->send(400, "text/plain", "Missing file parameter");
          return;
      }
      String file = request->getParam("file")->value();

      // Check extension first for security
      if (!hasSupportedExtension(file)) {
          request->send(403, "text/plain", "Unsupported file type");
          return;
      }

      if (!SD.exists(file)) {
          request->send(404, "text/plain", "File not found");
          return;
      }

      Serial.printf("[MEDIA] Switching to speaker, playing: %s\n", file.c_str());
      playWavFileOnSpeaker(file);
      request->send(200, "text/plain", "Playing on device: " + file);
  });


  server.on("/enable_mic", HTTP_GET, [](AsyncWebServerRequest *request) {
      enableMic();
      request->send(200, "text/plain", "Mic enabled");
  });

  server.on("/disable_mic", HTTP_GET, [](AsyncWebServerRequest *request) {
      micStreamActive = false; // Signal to /mic_stream handler to finish
      request->send(200, "text/plain", "Mic disable requested, will stop after stream closes.");
  });

  server.on("/stop_playback", HTTP_GET, [](AsyncWebServerRequest *request) {
      Serial.println("[MEDIA] Stopping playback on device");
      audio.stopSong();         // This stops whatever is currently playing via ESP32-audioI2S
      request->send(200, "text/plain", "Stopped playback on device");
  });

  server.on("/set_volume", HTTP_GET, [](AsyncWebServerRequest *request) {
      if (!request->hasParam("value")) {
          request->send(400, "text/plain", "Missing value parameter");
          return;
      }
      int v = request->getParam("value")->value().toInt();
      // Clamp value, ESP32-audioI2S volume is 0..21
      if (v < 0) v = 0;
      if (v > 21) v = 21;
      audio.setVolume(v);
      request->send(200, "text/plain", "Volume set to: " + String(v));
  });

  server.on("/mic_stream", HTTP_GET, [](AsyncWebServerRequest *request){
      micStreamActive = true;
      AsyncWebServerResponse *response = request->beginChunkedResponse("audio/wav", [](uint8_t *buffer, size_t maxLen, size_t index) -> size_t {
          static bool headerSent = false;
          static uint8_t wavHeader[44];

          if (!headerSent) {
              makeWavHeader(wavHeader, 16000, 1, 16, 0x7FFFFFFF);
              memcpy(buffer, wavHeader, 44);
              headerSent = true;
              return 44;
          }
          if (!micStreamActive) {
              micCleanupPending = true;
              return 0;
          }
          size_t bytesRead = 0;
          int16_t audioBuffer[I2S_READ_LEN];
          esp_err_t res = i2s_read(MY_I2S_PORT, (void*)audioBuffer, sizeof(audioBuffer), &bytesRead, 30 / portTICK_RATE_MS);
          if (res != ESP_OK || bytesRead == 0) return 0;
          memcpy(buffer, audioBuffer, bytesRead);
          return bytesRead;
      });
      response->addHeader("Access-Control-Allow-Origin", "*");
      request->send(response);
  });


  wsCarInput.onEvent(onCarInputWebSocketEvent);
  server.addHandler(&wsCarInput);
  server.begin();
  Serial.println("HTTP server started");

  // OLED Display Status
  if (wifiConnected) {
      wifiState = WIFI_STA_CONNECTED;
    } else {
      //displayMessage(WiFi.softAPIP().toString(), "🌐 AP Setup Ready");
      wifiState = WIFI_AP_MODE;
  }
}

//-------------------------------------------Telemetry-----------------------------------------------------------------------

// ----------- Battery, Charger, WiFi, Temp, Uptime Telemetry -----------
void sendBatteryTelemetryIfIdle() {
  static unsigned long lastTelemetrySend = 0;
  if (!audio.isRunning() && millis() - lastTelemetrySend > 1000) {
    lastTelemetrySend = millis();

    int adcRaw = analogRead(BLevel);
    int adcRawCharging = analogRead(CSense);

    const float battR1 = 22000.0, battR2 = 10000.0;
    const float correctionFactorB = 8.233 / 8.03; // tune if needed
    float batteryVoltage = (adcRaw * 3.3 / 4095.0) * ((battR1 + battR2) / battR2) * correctionFactorB;

    const float chgR1 = 10000.0, chgR2 = 6800.0;
    float chargerVoltage = (adcRawCharging * 3.3 / 4095.0) * ((chgR1 + chgR2) / chgR2);

    const float MIN_BATTERY_VOLTAGE = 6.6;
    const float MAX_BATTERY_VOLTAGE = 8.3;
    int batteryPercent = constrain((int)(((batteryVoltage - MIN_BATTERY_VOLTAGE) / (MAX_BATTERY_VOLTAGE - MIN_BATTERY_VOLTAGE)) * 100.0), 0, 100);

    int rssi = WiFi.RSSI();
    int wifiQuality = constrain(2 * (rssi + 100), 0, 100);

    const char* chargingStatus = nullptr;
    if (chargerVoltage > 4) chargingStatus = "YES";
    else if (chargerVoltage < 2.5) chargingStatus = "NO";
    else chargingStatus = "FAULT";

    unsigned long uptimeSecs = millis() / 1000;
    float chipTemp = temperatureRead();

    wsCarInput.textAll("BATT," + String(batteryPercent) + "," + String(batteryVoltage, 2) + "," + String(wifiQuality));
    wsCarInput.textAll("CHARGE," + String(chargingStatus));
    wsCarInput.textAll("STATS," + String(uptimeSecs) + "," + String(chipTemp, 1));
  }
}

// ----------- IMU Telemetry -----------
void sendImuTelemetry() {
  static unsigned long lastImuSend = 0;
  if (millis() - lastImuSend > 500) {
    lastImuSend = millis();
    imu::Vector<3> euler = bno055.getVector(Adafruit_BNO055::VECTOR_EULER);
    imu::Vector<3> mag   = bno055.getVector(Adafruit_BNO055::VECTOR_MAGNETOMETER);
    float temp = bno055.getTemp();
    String imuMsg = "IMU," + String(euler.x(), 1) + "," + String(euler.y(), 1) + "," + String(euler.z(), 1)
                  + "," + String(mag.x(), 1) + "," + String(mag.y(), 1) + "," + String(mag.z(), 1)
                  + "," + String(temp, 1);
    wsCarInput.textAll(imuMsg);
  }
}

// ----------- FPS Telemetry -----------
void sendFpsTelemetry() {
  static unsigned long lastFpsSend = 0;
  extern volatile int frameCount;  // define globally!
  static int lastFps = 0;
  if (millis() - lastFpsSend > 1000) {
    lastFpsSend = millis();
    lastFps = frameCount;
    wsCarInput.textAll("FPS," + String(lastFps));
    frameCount = 0;
  }
}

void handleSerialCommands() {
  if (Serial.available()) {
    String input = "";
    while (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') break;
      input += c;
      delay(2);
    }
    input.trim();

    if (input.length() > 0) {
      // If 'P' + any non-digit, treat as play path
      if (input.charAt(0) == 'P' && (input.length() > 1) && !isDigit(input.charAt(1))) {
        String filename = input.substring(1);
        filename.trim();
        Serial.printf("[SERIAL] Requested play: '%s'\n", filename.c_str());
        if (!SD.exists(filename.c_str())) {
          Serial.printf("[ERROR] File not found on SD: '%s'\n", filename.c_str());
        } else {
          playWavFileOnSpeaker(filename.c_str());
        }
      }
      // If legacy motor command (F/B/L/R followed by number)
      else if (input.length() > 1 &&
               (input.charAt(0) == 'F' || input.charAt(0) == 'B' ||
                input.charAt(0) == 'L' || input.charAt(0) == 'R') &&
               isDigit(input.charAt(1))) {
        char cmd = input.charAt(0);
        int value = input.substring(1).toInt();
        if (cmd == 'F') controlMotorByDirection("Forward", value);
        else if (cmd == 'B') controlMotorByDirection("Backward", value);
        else if (cmd == 'L') controlMotorByDirection("Left", value);
        else if (cmd == 'R') controlMotorByDirection("Right", value);
        Serial.printf("✅ Command: %c %d\n", cmd, value);
      }
      // Otherwise, treat as plain string command
      else {
        String cmd = input;
        cmd.toLowerCase();
        if (cmd == "next") nextTrack();
        else if (cmd == "previous") prevTrack();
        else if (cmd == "play") playCurrentTrack();
        else if (cmd == "stop") {
          stopAudio();
          Serial.println("[STOP]");
          
        }
        else if (cmd == "random") randomTrack();
        else if (cmd == "nextfolder") nextFolder();
        else if (cmd == "reset") resetESP();
        else if (cmd == "+") setVolume(currentVolume + 1);
        else if (cmd == "-") setVolume(currentVolume - 1);
        else if (cmd == "list") {
          Serial.println("Current playlist:");
          for (size_t i = 0; i < playlist.size(); ++i) {
            Serial.printf("[%d] %s\n", i, playlist[i].c_str());
          }
        }
      }
    }
  }
}

//-----------------------------------------------------------------------------SETUP---------------------------------------------------------------------------------------------------------//
void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
  Serial.printf("Flash size: %lu bytes\n", ESP.getFlashChipSize());
  // --- Preferences ---
  wifiPrefs.begin("wifi", false);       // Wi-Fi credentials, networks, etc.
  camPrefs.begin("camsettings", false);   // Camera settings
  keymapPrefs.begin("keymap", false);        // Key mapping (if used)
  imuPrefs.begin("telemetry", false);   // IMU/BNO055 calibration (if used)
  uiPrefs.begin("ui", false);

  darkMode        = uiPrefs.getBool("darkMode", false);
  horizontalScreen = uiPrefs.getBool("Switch", false);
  holdBucket      = uiPrefs.getBool("HoldBucket", false);
  holdAux         = uiPrefs.getBool("HoldAux", false);

  // --- Your hardware init here ---
  i2cStart();
  spiStart();
  pixelStart();  
  serverStart(); 
  startNtpSync();
  otaUpdate();
  applySavedCamSettings();  
  startCamera();
  startCameraServer(); 
  initBNO055(); 

  showWiFiStep("Wi-Fi booting...", true);

  // Load playlist from your media folder
  if (loadPlaylistFromIndex(mediaFolders[0])) {
    Serial.printf("[PLAYLIST] Loaded playlist from %s\n", mediaFolders[0]);
  } else {
    Serial.printf("[PLAYLIST] Failed to load playlist from %s\n", mediaFolders[0]);
  }

}


//------------------------------------------------------------------------------LOOP---------------------------------------------------------------------------------------------------------//

void loop() {
  handleSerialCommands();
  sendBatteryTelemetryIfIdle();
  sendImuTelemetry();
  sendFpsTelemetry();
  // ... other logic ...
  wsCarInput.cleanupClients();

  // Animations!
  handleAnimationTimers();

  // Wi-Fi state machine
  handleWifiStateMachine();

  // ... remaining logic ...
  audio.loop();
  processReindexTask();
  pollTimeValid();
  streamMicToWebSocket();
  if (micCleanupPending) {
      disableMic();
      micCleanupPending = false;
  }
  sendDeviceMediaProgress();

  delay(1);
}



