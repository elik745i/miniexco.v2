/* MiniExco Robot Firmware (ESP32-S3-SPK v1.0)
 * Notes, changelog, and TODOs have been moved to README.md.
 */

/* Bluepad32 documentation: https://bluepad32.readthedocs.io/en/latest/
                            https://github.com/ricardoquesada/bluepad32
*/

// ============================================================================
// Feature switches (override with -D in build flags if you like)
// ----------------------------------------------------------------------------
// USE_BLUEPAD32 - Controlled by frontend Settings in Control tab switch - update v2.0.70
//   0 = exclude Bluepad32 gamepad support (saves flash/RAM, faster compile)
//   1 = include Bluepad32 (needs Bluepad32 library + BT enabled)
//   Tip: set to 0 unless you actually use a BT gamepad.
//
// DEBUG_SERIAL
//   0 = silence most DBG_PRINT/DBG_PRINTF calls
//   1 = enable verbose serial logging (requires Serial.begin in setup())
//   Tip: keep 1 while developing; switch to 0 for production.
//
// USE_PSRAM
//   0 = use internal heap only for large buffers (frame buffers, media queues)
//   1 = prefer PSRAM for large buffers (much more space; slightly slower access)
//   Notes:
//     - Board must actually have PSRAM. We’ll detect at runtime and fall back.
//     - Good for camera frames, audio buffers, MJPEG chunking, JSON docs.
// ============================================================================

//-----------------------------------------------------------------------GLOBALS---------------------------------------------------------------------


//-------------------------------------------------------------------GLOBAL FLAGS------------------------------------------------------------------
struct MQTTConfig;

  #define DEBUG_SERIAL   0
  #define DEBUG_TERMINAL 1
  #define USE_PSRAM      1

//-----------------------------------------------------------------------LIBs----------------------------------------------------------------------
  // --- Core / Arduino ---
  #include <Arduino.h>
  #include <WiFi.h>
  #include <WiFiClient.h>
  #include <WiFiClientSecure.h>
  #include <HTTPClient.h>
  #include <WiFiUdp.h>
  #include <time.h>
  #include <stdarg.h>

  // --- NVS / Preferences ---
  #include <Preferences.h>

  // --- Filesystems / Storage ---
  #include <FS.h>
  #include <SD.h>
  #include <SPI.h>
  #include <sys/stat.h>
  #include <utime.h>
  #include <mbedtls/sha256.h>  //upload file verification

  // Optional fast FS stats (used only if present)
  #if __has_include(<sys/statvfs.h>)
    #include <sys/statvfs.h>
  #endif

  // --- Async web stack ---
  #include <AsyncTCP.h>                 // required by ESPAsyncWebServer on ESP32
  #include <ArduinoJson.h>
  #include <ESPAsyncWebServer.h>        // (patched per your note)
  #include <AsyncJson.h>
  #include <ESPmDNS.h>
  using namespace ArduinoJson;

  // --- Networking helpers ---
  #include <ESPmDNS.h>
  #include <ElegantOTA.h>               // (patched per your note)
  #include "esp_wifi.h"
  #include "esp_sntp.h"

  // --- MQTT ---
  #include <PubSubClient.h>

  // --- Camera / Display / Sensors ---
  #include "esp_camera.h"
  #include <Adafruit_GFX.h>
  #include <Adafruit_SSD1306.h>
  #include <Adafruit_BNO055.h>
  #include <Adafruit_NeoPixel.h>
  #include <Wire.h>

  // auto-throttle quality/size if heap dips
  #include "esp_heap_caps.h"
  extern "C" void requestCameraParams(framesize_t fs, int quality);
  extern "C" void appHttpdPauseStreaming();
  extern "C" void appHttpdResumeStreaming();
  extern "C" void appHttpdStopActiveStream();
  extern "C" void appHttpdStopServer();
  extern volatile int frameCount;

  // --- Audio / I2S / LEDC ---
  #include <Audio.h>                    // ESP32-audioI2S
  #include "driver/i2s.h"
  #include "driver/ledc.h"

  // --- System / FreeRTOS / PSRAM ---
  #include "esp_system.h"
  #include "esp_task_wdt.h"
  #include <esp32-hal-psram.h>
  #include <esp_heap_caps.h>
  #include "freertos/FreeRTOS.h"
  #include "freertos/task.h"
  #include <semphr.h>


  //#if USE_BLUEPAD32
    #include <Bluepad32.h>
  //#endif

  // --- STL / utilities ---
  #include <map>
  #include <string>
  #include <vector>
  #include <limits>
  #include <strings.h>
  #include <cstdlib>
  #include <new>
  //#include <iostream>
  //#include <sstream>

  struct MQTTConfig;

  // Forward declarations for functions referenced before their definitions.
  void loadMqttConfig();
  void saveMqttConfig(const MQTTConfig& cfg);
  void publishMqttDiscovery();
  void mqttBegin();
  void mqttDisconnect();

  String normalizedSSID(const String& raw);

  void stopAudio();
  void pauseAudio();
  void resumeAudio();
  void releaseMediaResources();
  void queueAudioEngineReset();
  void processQueuedAudioEngineReset();
  void playWavFileOnSpeaker(const String& filename);
  void playCurrentTrack();
  void nextTrack();
  void prevTrack();
  void setVolume(int vol);
  void enableSpeaker();
  static void queueRadioPlay(const char* url);

  void otaUpdate();
  static bool otaDownloadAndApplyFromUrl(const String& url, String& errorOut);
  static void serialMirrorPrint(const char* text, bool appendNewline);
  static void serialMirrorPrintf(const char* fmt, ...);
  static void executeSerialCommand(String input);
  void webServerReboot();
  void startLobbyServer();
  void serverStart();

  static String normJoyBtn(String s);
  void clearDockPairing();
  void printDebugInfo();
  void printWifiDebugInfo();


//--------------------------------------------------------------------FIRMWARE INFO----------------------------------------------------------------

  #define FIRMWARE_VERSION "v2.1.01"


  // AP credentials (global)
  #define AP_PASSWORD_DEFAULT "12345678"   // 8..63 chars; change to your default
  String g_apPassword = AP_PASSWORD_DEFAULT;  // mutable so you can change it from UI later

//---------------------------------------------------------------------Preferences-----------------------------------------------------------------

  Preferences preferences, prefs, wifiPrefs, camPrefs, keymapPrefs, joymapPrefs, imuPrefs, uiPrefs, oledPrefs, camEnablePrefs, gpioPrefs;

//---------------------------------------------------------------------GPIO Configuration----------------------------------------------------------

  struct GpioConfig {
    int16_t rightMotorIn1;
    int16_t rightMotorIn2;
    int16_t leftMotorIn1;
    int16_t leftMotorIn2;
    int16_t armMotorIn1;
    int16_t armMotorIn2;
    int16_t bucketServo;
    int16_t auxServo;
    int16_t ledStrip;
    int16_t i2sMicWs;
    int16_t i2sMicSd;
    int16_t i2sMicSck;
    int16_t i2sSpkSd;
    int16_t i2sSpkBclk;
    int16_t i2sSpkLrck;
    int16_t i2sSpkPa;
    int16_t sdCs;
    int16_t sdSck;
    int16_t sdMosi;
    int16_t sdMiso;
    int16_t i2cSda;
    int16_t i2cScl;
    int16_t camPwdn;
    int16_t camReset;
    int16_t camXclk;
    int16_t camSiod;
    int16_t camSioc;
    int16_t camY9;
    int16_t camY8;
    int16_t camY7;
    int16_t camY6;
    int16_t camY5;
    int16_t camY4;
    int16_t camY3;
    int16_t camY2;
    int16_t camVsync;
    int16_t camHref;
    int16_t camPclk;
  };

  struct GpioFieldDescriptor {
    const char* key;
    int16_t GpioConfig::*member;
    int16_t minValue;
    int16_t maxValue;
  };

  static GpioConfig makeDefaultGpioConfig() {
    GpioConfig cfg{};
    cfg.rightMotorIn1 = 16;
    cfg.rightMotorIn2 = 17;
    cfg.leftMotorIn1  = 18;
  #if DEBUG_SERIAL
    cfg.leftMotorIn2  = -1;
    cfg.armMotorIn1   = -1;
    cfg.armMotorIn2   = -1;
  #else
    cfg.leftMotorIn2  = 19;
    cfg.armMotorIn1   = 43;
    cfg.armMotorIn2   = 44;
  #endif
    cfg.bucketServo   = 0;
    cfg.auxServo      = 20;
    cfg.ledStrip      = 21;
    cfg.i2sMicWs      = 40;
    cfg.i2sMicSd      = 38;
    cfg.i2sMicSck     = 39;
    cfg.i2sSpkSd      = 9;
    cfg.i2sSpkBclk    = 10;
    cfg.i2sSpkLrck    = 45;
    cfg.i2sSpkPa      = 46;
    cfg.sdCs          = 2;
    cfg.sdSck         = 11;
    cfg.sdMosi        = 3;
    cfg.sdMiso        = 12;
    cfg.i2cSda        = 15;
    cfg.i2cScl        = 14;
    cfg.camPwdn       = -1;
    cfg.camReset      = -1;
    cfg.camXclk       = 33;
    cfg.camSiod       = 37;
    cfg.camSioc       = 36;
    cfg.camY9         = 47;
    cfg.camY8         = 48;
    cfg.camY7         = 42;
    cfg.camY6         = 8;
    cfg.camY5         = 6;
    cfg.camY4         = 4;
    cfg.camY3         = 5;
    cfg.camY2         = 7;
    cfg.camVsync      = 35;
    cfg.camHref       = 34;
    cfg.camPclk       = 41;
    return cfg;
  }

  static GpioConfig makeInvalidGpioConfig() {
    GpioConfig cfg{};
    constexpr int16_t invalid = std::numeric_limits<int16_t>::min();
    cfg.rightMotorIn1 = invalid;
    cfg.rightMotorIn2 = invalid;
    cfg.leftMotorIn1  = invalid;
    cfg.leftMotorIn2  = invalid;
    cfg.armMotorIn1   = invalid;
    cfg.armMotorIn2   = invalid;
    cfg.bucketServo   = invalid;
    cfg.auxServo      = invalid;
    cfg.ledStrip      = invalid;
    cfg.i2sMicWs      = invalid;
    cfg.i2sMicSd      = invalid;
    cfg.i2sMicSck     = invalid;
    cfg.i2sSpkSd      = invalid;
    cfg.i2sSpkBclk    = invalid;
    cfg.i2sSpkLrck    = invalid;
    cfg.i2sSpkPa      = invalid;
    cfg.sdCs          = invalid;
    cfg.sdSck         = invalid;
    cfg.sdMosi        = invalid;
    cfg.sdMiso        = invalid;
    cfg.i2cSda        = invalid;
    cfg.i2cScl        = invalid;
    cfg.camPwdn       = invalid;
    cfg.camReset      = invalid;
    cfg.camXclk       = invalid;
    cfg.camSiod       = invalid;
    cfg.camSioc       = invalid;
    cfg.camY9         = invalid;
    cfg.camY8         = invalid;
    cfg.camY7         = invalid;
    cfg.camY6         = invalid;
    cfg.camY5         = invalid;
    cfg.camY4         = invalid;
    cfg.camY3         = invalid;
    cfg.camY2         = invalid;
    cfg.camVsync      = invalid;
    cfg.camHref       = invalid;
    cfg.camPclk       = invalid;
    return cfg;
  }

  static GpioConfig gpioConfig = makeDefaultGpioConfig();
  static GpioConfig lastAppliedGpioConfig = makeInvalidGpioConfig();
  static bool gpioPinsInitialized = false;

  static const GpioFieldDescriptor GPIO_FIELD_DESCRIPTORS[] = {
    { "RightMotorIn1", &GpioConfig::rightMotorIn1, -1, 48 },
    { "RightMotorIn2", &GpioConfig::rightMotorIn2, -1, 48 },
    { "LeftMotorIn1",  &GpioConfig::leftMotorIn1,  -1, 48 },
    { "LeftMotorIn2",  &GpioConfig::leftMotorIn2,  -1, 48 },
    { "ArmMotorIn1",   &GpioConfig::armMotorIn1,   -1, 48 },
    { "ArmMotorIn2",   &GpioConfig::armMotorIn2,   -1, 48 },
    { "BucketServo",   &GpioConfig::bucketServo,   -1, 48 },
    { "AuxServo",      &GpioConfig::auxServo,      -1, 48 },
    { "LedStrip",      &GpioConfig::ledStrip,      -1, 48 },
    { "I2SMicWS",      &GpioConfig::i2sMicWs,      -1, 48 },
    { "I2SMicSD",      &GpioConfig::i2sMicSd,      -1, 48 },
    { "I2SMicSCK",     &GpioConfig::i2sMicSck,     -1, 48 },
    { "I2SSpkSD",      &GpioConfig::i2sSpkSd,      -1, 48 },
    { "I2SSpkBCLK",    &GpioConfig::i2sSpkBclk,    -1, 48 },
    { "I2SSpkLRCK",    &GpioConfig::i2sSpkLrck,    -1, 48 },
    { "I2SSpkPA",      &GpioConfig::i2sSpkPa,      -1, 48 },
    { "SdCS",          &GpioConfig::sdCs,          -1, 48 },
    { "SdSCK",         &GpioConfig::sdSck,         -1, 48 },
    { "SdMOSI",        &GpioConfig::sdMosi,        -1, 48 },
    { "SdMISO",        &GpioConfig::sdMiso,        -1, 48 },
    { "I2CSDA",        &GpioConfig::i2cSda,        -1, 48 },
    { "I2CSCL",        &GpioConfig::i2cScl,        -1, 48 },
    { "CamPWDN",       &GpioConfig::camPwdn,       -1, 48 },
    { "CamRESET",      &GpioConfig::camReset,      -1, 48 },
    { "CamXCLK",       &GpioConfig::camXclk,       -1, 48 },
    { "CamSIOD",       &GpioConfig::camSiod,       -1, 48 },
    { "CamSIOC",       &GpioConfig::camSioc,       -1, 48 },
    { "CamY9",         &GpioConfig::camY9,         -1, 48 },
    { "CamY8",         &GpioConfig::camY8,         -1, 48 },
    { "CamY7",         &GpioConfig::camY7,         -1, 48 },
    { "CamY6",         &GpioConfig::camY6,         -1, 48 },
    { "CamY5",         &GpioConfig::camY5,         -1, 48 },
    { "CamY4",         &GpioConfig::camY4,         -1, 48 },
    { "CamY3",         &GpioConfig::camY3,         -1, 48 },
    { "CamY2",         &GpioConfig::camY2,         -1, 48 },
    { "CamVSYNC",      &GpioConfig::camVsync,      -1, 48 },
    { "CamHREF",       &GpioConfig::camHref,       -1, 48 },
    { "CamPCLK",       &GpioConfig::camPclk,       -1, 48 }
  };

  static constexpr size_t GPIO_FIELD_COUNT = sizeof(GPIO_FIELD_DESCRIPTORS) / sizeof(GPIO_FIELD_DESCRIPTORS[0]);

  static int16_t clampGpioValue(int value, const GpioFieldDescriptor& field) {
    if (value < field.minValue) return field.minValue;
    if (value > field.maxValue) return field.maxValue;
    return static_cast<int16_t>(value);
  }

  static inline std::string trimCopy(const std::string& input) {
    const char* whitespace = " \t\r\n";
    const auto begin = input.find_first_not_of(whitespace);
    if (begin == std::string::npos) return {};
    const auto end = input.find_last_not_of(whitespace);
    return input.substr(begin, end - begin + 1);
  }

  static bool applyGpioValue(GpioConfig& cfg, const std::string& key, int value) {
    for (const auto& field : GPIO_FIELD_DESCRIPTORS) {
      if (strcasecmp(key.c_str(), field.key) == 0) {
        int16_t clamped = clampGpioValue(value, field);
        int16_t current = cfg.*(field.member);
        if (current != clamped) {
          cfg.*(field.member) = clamped;
          return true;
        }
        return false;
      }
    }
    return false;
  }

  static size_t serializeGpioConfigCsv(const GpioConfig& cfg, char* out, size_t outLen) {
    if (!out || outLen == 0) return 0;
    size_t written = 0;
    auto appendChar = [&](char c) {
      if (written + 1 < outLen) {
        out[written++] = c;
        return true;
      }
      return false;
    };

    const char prefix[] = "GPIOCONF,";
    for (size_t i = 0; i < sizeof(prefix) - 1; ++i) {
      if (!appendChar(prefix[i])) return 0;
    }

    for (size_t i = 0; i < GPIO_FIELD_COUNT; ++i) {
      const auto& field = GPIO_FIELD_DESCRIPTORS[i];
      if (i > 0) {
        if (!appendChar(';')) return 0;
      }
      const size_t keyLen = strlen(field.key);
      if (written + keyLen + 2 >= outLen) return 0; // ':' + NUL
      memcpy(out + written, field.key, keyLen);
      written += keyLen;
      if (!appendChar(':')) return 0;
      written += snprintf(out + written, outLen - written, "%d", int(cfg.*(field.member)));
      if (written >= outLen) return 0;
    }
    out[written] = '\0';
    return written;
  }

  static void loadGpioConfigFromPrefs();
  static void saveGpioConfigToPrefs(const GpioConfig& cfg);
  static void applyGpioConfig(bool initial);
  static void reconfigureMotorPins(const GpioConfig& current, const GpioConfig& previous);
  static void broadcastGpioConfig(AsyncWebSocketClient* client = nullptr);

  static void loadGpioConfigFromPrefs() {
    gpioConfig = makeDefaultGpioConfig();
    for (const auto& field : GPIO_FIELD_DESCRIPTORS) {
      if (gpioPrefs.isKey(field.key)) {
        int stored = gpioPrefs.getInt(field.key, field.minValue);
        gpioConfig.*(field.member) = clampGpioValue(stored, field);
      }
    }
  }

  static void saveGpioConfigToPrefs(const GpioConfig& cfg) {
    for (const auto& field : GPIO_FIELD_DESCRIPTORS) {
      gpioPrefs.putInt(field.key, static_cast<int>(cfg.*(field.member)));
    }
  }

//---------------------------------------------------------------------NPT Tıme--------------------------------------------------------------------

  int myTimezone = +3; // For US Eastern (UTC-5)
  long gmtOffset_sec = myTimezone * 3600;
  bool timeIsValid = false;
  unsigned long lastTimeCheck = 0;


//----------------------------------------------------------------Globals for MQTT-----------------------------------------------------------------
  volatile bool mqttNeedsReconnect = false;
  unsigned long mqttTelemetryInterval = 5000; // ms, default 1 seconds
  unsigned long lastMqttTelemetry = 0;

  bool mqttDiscoveryPublished = false;

  bool mqttConnected = false;
  String mqttLastError = "";

  struct MQTTConfig {
    bool enable;
    String host;
    int port;
    String user;
    String pass;
    String topic_prefix;
  };

  MQTTConfig mqttCfg;

  WiFiClient wifiClient;
  PubSubClient mqtt(wifiClient);

  String getMqttPrefix() {
    loadMqttConfig(); // Ensure latest config
    String p = mqttCfg.topic_prefix;
    while (p.endsWith("/")) p.remove(p.length()-1);
    if (p.length()) p += "/";
    return p;
  }



//-----------------------------------------------------Globals for system sounds to play on event--------------------------------------------------
  unsigned long lastLowBatteryBeep = 0;
  bool lowBatteryAlertActive = false;
  static bool wasCharging = false;              //for charging
  static bool chargingCompletePlayed = false;   // For chargeComplete.wav
  static bool endChargingPlayed = false;        // For endCharging.wav
  static bool wasFullyCharged = false;          // For 100% detection
  bool sirenPlaying = false;

  volatile bool isSystemSoundPlaying = false;
  String lastPlayedFile = "";
  unsigned long lastPlayedTime = 0;

  // >>> KEEP ONLY ONE of these; delete any duplicate definition elsewhere <<<
  unsigned long soundRepeatDelay = 1000; // or 250 if you prefer; just one

  // >>> Queue size: 24 is fine; delete any later #ifndef/#define that redefines it <<<
  #define MAX_SYSTEM_SOUND_QUEUE 24
  String systemSoundQueue[MAX_SYSTEM_SOUND_QUEUE];
  uint8_t queueHead = 0, queueTail = 0;

  // ---- Minimal exclusivity (NEW) ----
  volatile bool ss_exclusive = false;   // while true, any new non-IP enqueues are dropped
  volatile bool ss_allow     = false;   // temporarily true only while we enqueue the IP sequence
  const char* g_apSpeechFile = "/web/pcm/apaudio.wav";


// -------------------------------------------------------------- Globals for recording -----------------------------------------------------------
  volatile bool  videoRecording  = false;
  volatile bool  videoTaskActive = false;
  TaskHandle_t   videoTaskHandle = nullptr;

//---------------------------------------------------------Telemetry Logging Global Variables------------------------------------------------------

  bool imuPresent = false;
  bool imuInitAttempted = false;
  unsigned long telemetrySampleInterval = 1000; // e.g. 1000ms = 1 second
  const uint32_t TELEMETRY_FILE_MAX_KB_DEFAULT = 2048; // 2 MB default
  const uint32_t TELEMETRY_FILE_MAX_KB_MIN = 128;
  const uint32_t TELEMETRY_FILE_MAX_KB_MAX = 10240;
  uint32_t telemetryFileMaxKB = TELEMETRY_FILE_MAX_KB_DEFAULT;
  size_t telemetryFileMaxSizeBytes = (size_t)TELEMETRY_FILE_MAX_KB_DEFAULT * 1024;
  const uint32_t SERIAL_LOG_RATE_MS_DEFAULT = 40;
  const uint32_t SERIAL_LOG_RATE_MS_MIN = 0;    // 0 = disable live SERLOG websocket push
  const uint32_t SERIAL_LOG_RATE_MS_MAX = 500;  // cap so the UI still gets updates
  uint32_t serialLogWsMinIntervalMs = SERIAL_LOG_RATE_MS_DEFAULT;
  const uint32_t SERIAL_LOG_KEEP_LINES_DEFAULT = 200;
  const uint32_t SERIAL_LOG_KEEP_LINES_MIN = 50;
  const uint32_t SERIAL_LOG_KEEP_LINES_MAX = 600;
  uint32_t serialLogRetainLines = SERIAL_LOG_KEEP_LINES_DEFAULT;
  String currentTelemetryFile = "/telemetry/telemetry_01.csv";
  static constexpr size_t TELEMETRY_BUFFER_MAX_SAMPLES = 180;

  const char* TELEMETRY_CSV_HEADER =
    "datetime,timestamp,voltage,temp,charger,imu_euler_x,imu_euler_y,imu_euler_z,"
    "imu_mag_x,imu_mag_y,imu_mag_z,imu_temp,fps";

  // Dock link (UDP) and pairing state
  const uint16_t DOCK_UDP_PORT = 5005;  // adjust to match dock listener
  struct DockHeartbeatState {
    float batteryVoltage = 0;
    float chargerVoltage = 0;
    int batteryPercent = 0;
    const char* chargingState = "UNKNOWN";
    unsigned long lastUpdateMs = 0;
  } dockHeartbeatState;
  struct DockPairInfo {
    bool paired = false;
    String roverId;
    String hwId;
    String dockId;
    String dockMac;
    IPAddress dockIp;
    uint16_t dockPort = DOCK_UDP_PORT;
  } dockPair;
  Preferences dockPrefs;
  WiFiUDP dockUdp;
  bool dockUdpStarted = false;
  int lastRssiDbm = -127;
  bool dockDiscoveryEnabled = true;
  unsigned long lastDockDiscoveryMs = 0;

  String getHardwareId() {
    static String hwId;
    if (hwId.length()) return hwId;
    uint64_t mac = ESP.getEfuseMac();
    char buf[18];
    snprintf(
      buf, sizeof(buf),
      "%02X:%02X:%02X:%02X:%02X:%02X",
      (uint8_t)(mac >> 40), (uint8_t)(mac >> 32), (uint8_t)(mac >> 24),
      (uint8_t)(mac >> 16), (uint8_t)(mac >> 8),  (uint8_t)(mac)
    );
    hwId = String(buf);
    return hwId;
  }

  String getS3Id() {
    static String s3Id;
    if (s3Id.length()) return s3Id;

    String hw = getHardwareId();
    String hex;
    hex.reserve(16);
    for (size_t i = 0; i < hw.length(); ++i) {
      if (hw[i] != ':') hex += hw[i];
    }

    // Use last 3 bytes of MAC as a number; map to 1..999
    uint32_t low = 0;
    int start = hex.length() > 6 ? hex.length() - 6 : 0;
    for (int i = start; i < (int)hex.length(); ++i) {
      char c = hex[i];
      uint8_t v = (c >= '0' && c <= '9') ? (c - '0')
                : (c >= 'A' && c <= 'F') ? (c - 'A' + 10)
                : (c >= 'a' && c <= 'f') ? (c - 'a' + 10) : 0;
      low = (low << 4) | v;
    }
    uint16_t idx = (low % 999) + 1; // 1..999
    s3Id = "miniexco" + String(idx);
    return s3Id;
  }

  struct TelemetrySample {
    unsigned long timestamp = 0;
    int batteryPercent = 0;
    float voltage = 0;
    float charger = 0;
    int wifi = 0;
    float temp = 0;
    int fps = 0;
    float imu_euler_x = 0;
    float imu_euler_y = 0;
    float imu_euler_z = 0;
    float imu_mag_x = 0;
    float imu_mag_y = 0;
    float imu_mag_z = 0;
    float imu_temp = 0;
    // Add other fields if needed!
  };


  TelemetrySample currentSample;


//------------------------------------------------------------------Bluepad32 Globals--------------------------------------------------------------

  //#if USE_BLUEPAD32
    #define STICK_DEADZONE 100
    #define DPAD_UP     0x01
    #define DPAD_DOWN   0x02
    #define DPAD_LEFT   0x04
    #define DPAD_RIGHT  0x08

    ControllerPtr myControllers[BP32_MAX_GAMEPADS];
    void onConnectedController(ControllerPtr ctl);
    void onDisconnectedController(ControllerPtr ctl);
    static bool bluepadSetupDone = false;
    static bool bluepadActive = false;

    static void applyWifiPowerPolicy(bool allowSleep);
    static void resetBluepadControllers();
    static void startBluepadRuntime();
    static void stopBluepadRuntime();
    static void handleBluepadStateChange(bool enable, bool persistPrefs, bool notifyClients);
  //#endif


//--------------------------------------------------------------------Audio Globals----------------------------------------------------------------

  Audio audio;
  // Prefer PSRAM for streaming input buffer to reduce internal heap pressure.
  // Must be configured before the first connecttoFS/connecttohost call.
  static constexpr int AUDIO_STREAM_RAM_BUF_BYTES = 4 * 1024;
  static constexpr int AUDIO_STREAM_PSRAM_BUF_BYTES = 450 * 1024;
  static volatile bool g_audioEngineResetQueued = false;

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


  bool loopMode = false;
  bool shuffleMode = false;
  bool isPaused = false;
  bool playbackStarted = false;
  bool playlistLoaded = false;


  // ---------------- System-sound scheduler ----------------
  static bool     ss_apSpeechPending   = false;
  static uint32_t ss_apSpeechAtMs      = 0;
  static bool     ss_staSpeechPending  = false;
  static IPAddress ss_staIpToSpeak;
  static bool     ss_announcedStaIp    = false;

//--------------------------------------------------------------------Reindex globals--------------------------------------------------------------

  int reindexTotal = 0;
  bool reindexCounting = false; // true while counting files
  bool reindexReadyToIndex = false; // true when ready to start indexing

  volatile bool pendingReindex = false;
  String reindexPath = "/";
  int reindexCount = 0;

//----------------------------------------------------------------------File Upload----------------------------------------------------------------
  namespace sdweb {             // keeps the symbol local to this file
    struct UploadCtx {
      String uploadPath;        // final path
      String tmpPath;           // temp path
      File   uploadFile;        // open temp handle
      String error;             // non-empty => failed
      size_t bytesWritten = 0;
      size_t bytesSinceYield = 0;     // for periodic flush/yield

      // Optional integrity check
      bool verifySha = false;
      mbedtls_sha256_context sha;
      String expectedShaHex;          // 64-hex (lowercase)
      uint8_t digest[32];             // computed
    };

  }
  using sdweb::UploadCtx;

  volatile bool isSdUploadInProgress = false;  //used in app_httpd.cpp
  volatile bool isStreaming = false;           //used in app_httpd.cpp

//----------------------------------------------------------------------Serial Debug---------------------------------------------------------------
  /* As pins 19, 43 and 44 is used to control DRV8833 when debut is enabled, you will see serial but will be unable to control motors */

  struct TerminalMirrorSink : public Print {
    static constexpr size_t CAP = 319;
    char out[CAP + 1];
    size_t len = 0;
    TerminalMirrorSink() { out[0] = '\0'; }
    size_t write(uint8_t c) override {
      if (len < CAP) {
        out[len++] = static_cast<char>(c);
        out[len] = '\0';
      }
      return 1;
    }
  };

  template <typename... Args>
  static inline void dbgPrintImpl(Args... args) {
    if (DEBUG_SERIAL) {
      Serial.print(args...);
    }
    if (DEBUG_TERMINAL) {
      TerminalMirrorSink sink;
      sink.print(args...);
      serialMirrorPrint(sink.out, false);
    }
  }

  template <typename... Args>
  static inline void dbgPrintlnImpl(Args... args) {
    if (DEBUG_SERIAL) {
      Serial.println(args...);
    }
    if (DEBUG_TERMINAL) {
      TerminalMirrorSink sink;
      sink.println(args...);
      serialMirrorPrint(sink.out, true);
    }
  }

  #define DBG_PRINT(...)    do { dbgPrintImpl(__VA_ARGS__); } while(0)
  #define DBG_PRINTLN(...)  do { dbgPrintlnImpl(__VA_ARGS__); } while(0)
  #define DBG_PRINTF(...)   do { if (DEBUG_SERIAL) Serial.printf(__VA_ARGS__); if (DEBUG_TERMINAL) serialMirrorPrintf(__VA_ARGS__); } while(0)

  #define PRINT_HEAP(step) \
    DBG_PRINTF("[HEAP][%s] Free: %u  MinFree: %u  MaxAlloc: %u\n", step, ESP.getFreeHeap(), ESP.getMinFreeHeap(), ESP.getMaxAllocHeap());

  static bool bluepadNeedsRadioCoexistence() {
    // Bluepad32 relies on the ESP-IDF Wi-Fi/Bluetooth coexistence helpers which
    // assume modem-sleep stays enabled. Multiple reports (and our own testing)
    // show that forcing Wi-Fi sleep off (`WIFI_PS_NONE`) causes a watchdog reset
    // even if no controllers are currently connected, so keep the radio in
    // minimum modem sleep as long as Bluepad32 support is compiled in.
    return true;
  }

  static void applyWifiPowerPolicy(bool allowSleep) {
    const bool wifiSleepEnabled = allowSleep || bluepadNeedsRadioCoexistence();
    const wifi_ps_type_t psMode = wifiSleepEnabled ? WIFI_PS_MIN_MODEM : WIFI_PS_NONE;
    esp_wifi_set_ps(psMode);
    WiFi.setSleep(wifiSleepEnabled);
  }

  static void resetBluepadControllers() {
    for (int i = 0; i < BP32_MAX_GAMEPADS; ++i) {
      myControllers[i] = nullptr;
    }
  }

  static void startBluepadRuntime() {
    applyWifiPowerPolicy(true);
    if (bluepadActive) return;

    if (!bluepadSetupDone) {
      BP32.setup(&onConnectedController, &onDisconnectedController);
      bluepadSetupDone = true;
      DBG_PRINTF("[Bluepad32] setup complete, heap=%u\n", ESP.getFreeHeap());
    }

    BP32.enableNewBluetoothConnections(true);
    bluepadActive = true;
    DBG_PRINTF("[Bluepad32] enabled, heap=%u\n", ESP.getFreeHeap());
  }

  static void stopBluepadRuntime() {
    if (!bluepadSetupDone && !bluepadActive) {
      applyWifiPowerPolicy(false);
      return;
    }

    if (bluepadSetupDone) {
      BP32.enableNewBluetoothConnections(false);
    }

    resetBluepadControllers();
    bluepadActive = false;
    applyWifiPowerPolicy(false);
    DBG_PRINTF("[Bluepad32] disabled, heap=%u\n", ESP.getFreeHeap());
  }

//-----------------------------------------------------------Reboot Watchdog on Webserver Disconnect-----------------------------------------------

  // --- WebServer (WebSocket) watchdog ---
  static volatile uint32_t lastWebActivityMs = 0;     // last time we saw a WS connect/data/pong
  static volatile uint32_t lastWsDisconnectMs = 0;    // last time a WS disconnected
  static volatile uint16_t wsActiveClients = 0;       // current WS client count
  static bool hadAnyClientSinceBoot = false;          // becomes true after first WS connect

  // Tunables
  static const uint32_t WS_REBOOT_TIMEOUT_MS = 5000;  // 5 seconds with no WS clients
  static const uint32_t WS_REBOOT_GRACE_MS   = 30000; // 30s after boot, don't reboot

  // If you already have these, keep them. Otherwise remove the 'extern' lines.
  extern volatile bool isSdUploadInProgress;
  extern volatile bool isStreaming;   // set to true while /stream is serving frames


//-------------------------------------------------------------------------I2S SPK & MIC-------------------------------------------------------------
  volatile bool micStreamActive = false;

  Adafruit_SSD1306 display(128, 64, &Wire, -1);


  // --- I2S config for MSM261S mic ---

  #define MY_I2S_PORT I2S_NUM_1   // instead of I2S_NUM_0


  #define I2S_SAMPLE_RATE     16000
  #define I2S_SAMPLE_BITS     I2S_BITS_PER_SAMPLE_16BIT
  #define I2S_READ_LEN        1024


  // ===== MIC STREAM STATE =====
  static int16_t* micBuf = nullptr;
  static size_t   micBufBytes   = I2S_READ_LEN * sizeof(int16_t); // bytes per read
  static uint32_t micLastSendMs = 0;


  // Track current I2S state
  enum I2SMode { I2S_NONE, I2S_MIC, I2S_SPEAKER };
  I2SMode currentI2SMode = I2S_NONE;

//----------------------------------------------------------------------CONTROL PINS---------------------------------------------------------------
  // Channel numbers for ledcWrite/ledcSetup
  #define CH_RIGHT_MOTOR_IN1 0
  #define CH_RIGHT_MOTOR_IN2 1
  #define CH_LEFT_MOTOR_IN1  2
  #define CH_LEFT_MOTOR_IN2  3
  #define CH_ARM_MOTOR_IN1   4
  #define CH_ARM_MOTOR_IN2   5

  // PWM channel mapping summary


  #define CH_BUCKET_SERVO    6
  #define CH_AUX_SERVO       7

//-------------------------------------------------------------------------CAMERA------------------------------------------------------------------

  bool cameraEnabled = false;
  bool cameraInitialized = false;
  int  lastCameraInitErr = 0;
  bool cameraBootRestorePending = false;
  uint32_t cameraBootRestoreNotBeforeMs = 0;
  uint32_t cameraBootRestoreLastTryMs = 0;
  static const uint32_t CAMERA_BOOT_RESTORE_DELAY_MS = 3000;
  static const uint32_t CAMERA_BOOT_RETRY_MS = 2500;


  #define PWM_RES_BITS 14
  #define PWM_PERIOD_US 20000

  unsigned long lastCamCheck = 0;
  const unsigned long camCheckInterval = 3000; // 3 seconds

  //--------------Auto throttle stream quality-------------------------

  volatile bool allowFsAuto      = false;  // UI: auto_res
  volatile bool adaptiveQEnabled = true;   // UI: adaptive_q

  static int   bestQualityCap   = 12;                 // best allowed (lowest number)
  static int   minQualityFloor  = 38;                 // worst allowed (highest number) safety floor
  static framesize_t startFS    = FRAMESIZE_VGA;      // your preferred FS from prefs
  static framesize_t minFS      = FRAMESIZE_QQVGA;    // absolute minimum FS you accept
  static framesize_t maxFS      = FRAMESIZE_SVGA;     // absolute maximum FS you want to use

  // ---- Targets / thresholds ----
  static const int   TARGET_FPS          = 15;
  static const int   FPS_LO_HYST         = TARGET_FPS - 2;  // hysteresis window
  static const int   FPS_HI_HYST         = TARGET_FPS + 3;

  static const size_t HEAP_SOFT_FLOOR    = 180 * 1024; // below this: start easing quality
  static const size_t HEAP_HARD_FLOOR    = 120 * 1024; // below this: drop framesize or degrade more
  static const size_t HEAP_MIN_FREE_ABS  = 80  * 1024; // absolute floor = emergency degrade

  static const int   RSSI_WEAK           = -70;  // dBm
  static const int   RSSI_BAD            = -78;  // dBm

  // ---- Step sizes / cadence ----
  static const int   QUALITY_STEP        = 2;    // increase number = more compression
  static const int   QUALITY_RECOVER_STEP= 1;    // decrease number = better quality
  extern const uint32_t ADAPT_PERIOD_MS  = 1000; // run controller every second

  // ---- State ----
  static int         curQuality = 20;            // will be seeded from sensor at start
  static framesize_t curFS      = FRAMESIZE_VGA; // will be seeded from sensor at start
  static int         lastFrameCount = 0;
  extern uint32_t lastTickMs = 0;

  // Helpers: next lower/higher framesize within your allowed band
  framesize_t stepDownFS(framesize_t fs) { // “bigger pixels” → fewer bytes
    if (fs <= minFS) return minFS;
    return (framesize_t)((int)fs - 1);
  }
  framesize_t stepUpFS(framesize_t fs) { // “smaller pixels” → more detail
    if (fs >= maxFS) return maxFS;
    return (framesize_t)((int)fs + 1);
  }

  // Bound a value into [lo, hi]
  int clampInt(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

//-------------------------------------------------------------------SD_|CARD Pin defines----------------------------------------------------------


  // ---- SD mutex (recursive) ----
  static SemaphoreHandle_t sdMutex = nullptr;

  static inline void initSdMutex() {
    if (!sdMutex) sdMutex = xSemaphoreCreateRecursiveMutex();
  }

  struct SdLock {
    SdLock()  { xSemaphoreTakeRecursive(sdMutex, portMAX_DELAY); }
    ~SdLock() { xSemaphoreGiveRecursive(sdMutex); }
  };

  // --- Global SD stream gate (serialize SD sessions) ---
  static SemaphoreHandle_t g_sdStreamGate;
  static bool g_gateHeldByAudio = false;         // true while audio (mp3/wav) owns SD exclusively
  static bool g_mediaPausedBySystem = false;     // we paused mp3 to play a system beep

  struct SdGateGuard {
    bool held = false;
    SdGateGuard(bool take_now = true) {
      if (take_now) take();
    }
    void take() {
      if (!held) {
        xSemaphoreTake(g_sdStreamGate, portMAX_DELAY);
        held = true;
      }
    }
    void give() {
      if (held) {
        xSemaphoreGive(g_sdStreamGate);
        held = false;
      }
    }
    ~SdGateGuard(){ give(); }
  };

//---------------------------------------------------------------------------I2C-------------------------------------------------------------------

  Adafruit_BNO055 bno055 = Adafruit_BNO055(55, 0x28);  // 0x28 is default addr

  volatile int frameCount = 0;  // For FPS counting, used in loop()

  //-----------------------Neopixel Globals------------------------------

  #define NEO_COUNT 12
  Adafruit_NeoPixel pixels(NEO_COUNT, gpioConfig.ledStrip, NEO_GRB + NEO_KHZ800);

  bool beaconOn = false;
  bool emergencyOn = false;
  bool leftSignalActive = false;
  bool rightSignalActive = false;

  uint8_t beaconPhase = 0;
  bool blinkState = false;  // For emergency and turn signals
  unsigned long lastAnimUpdate = 0;
  const unsigned long beaconInterval = 180;
  const unsigned long blinkInterval = 400;

//-----------------------------------------------------------------------WiFi Globals--------------------------------------------------------------

static uint8_t  netRecoverTier   = 0;
static uint32_t lastRecoverMs    = 0;
static uint32_t healthGraceMs    = 60000UL;   // 60s grace after boot
static uint32_t webIdleTimeoutMs = 600000UL;  // 10 min with no web/WS activity

static inline void resetNetRecovery() {
  netRecoverTier = 0;
  lastRecoverMs  = millis();
}

enum WifiState { WIFI_AP_LOBBY, WIFI_STA_WAIT, WIFI_STA_OK };
extern WifiState wifiState;
WifiState wifiState = WIFI_AP_LOBBY;

String wifiSSID = "";
String wifiPassword = "";

unsigned long wifiLastScanAt   = 0;
unsigned long wifiConnectSince = 0;

// scan / connect cadences
const uint32_t SCAN_PERIOD_MS   = 15000;   // how often to scan while in AP lobby
const uint32_t CONNECT_TIMEOUT  = 8000;    // how long to wait for WL_CONNECTED per attempt
int currentCandidateIndex = -1;            // -1 means "start from preferred", then walk the list

// optional: keep AP password you already have
extern String g_apPassword;

// Non-blocking auto-detach tracking for servos
unsigned long auxDetachTime    = 0;
bool          auxAttached      = false;

unsigned long bucketDetachTime = 0;
bool          bucketAttached   = false;

// --- Path drawing type (was lost during edits) ---
struct PathPoint { float x; float y; };

bool shouldReboot = false;           // used in upload lambda
bool otaValid     = false;           // used in upload lambda
bool otaInitialized = false;         // guard OTA bring-up until STA has IP

int  wifiRetryCount         = 5;
bool wifiConnecting         = false;
unsigned long wifiConnectStartTime = 0;

//----------------------------------------------------------------------SERVO GLOBALS--------------------------------------------------------------


  int lastBucketValue = 140;  // Set to your safe init value
  int lastAuxValue = 150;


// ----------------------------------------------------------------------OLED Globals--------------------------------------------------------------

  #define SCREEN_WIDTH 128   // or whatever your actual OLED width is
  #define SCREEN_HEIGHT 64   // or whatever your OLED height is

  #define TOTAL_OLED_FRAMES 30

  // For OLED or UI feedback
  unsigned long wifiOledLastMsg = 0;
  String wifiOledLastStep = "";

  int batteryPercentDisplay = 0; 

  bool isCharging = false;

  int wifiSignalStrength = 0;

  String lastWsClientIP = "";
  unsigned long lastWsConnectTime = 0;

//----------------------------------------------------------------------SENSOR Globals-------------------------------------------------------------
  #define BLevel 13
  #define CSense 1

//----------------------------------------------------------------------CONTROL Globals------------------------------------------------------------

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

  #define DIR_STOP     0
  #define DIR_FORWARD  1
  #define DIR_BACKWARD -1


  //Use a 10k + 4.7k divider — safe and very common. Let me know if yours is different.
  unsigned long lastTelemetrySend = 0;

  const float MAX_BATTERY_VOLTAGE = 8.4; // 2S Li-ion full charge
  const float MIN_BATTERY_VOLTAGE = 6.0; // 2S safe cutoff

  // ---- Actions we support everywhere ----
  enum Action : uint8_t {
    ACT_NONE = 0,
    ACT_FORWARD, ACT_BACKWARD, ACT_LEFT, ACT_RIGHT, ACT_STOP,
    ACT_ARM_UP, ACT_ARM_DOWN, ACT_BUCKET_UP, ACT_BUCKET_DOWN, 
    ACT_AUX_UP, ACT_AUX_DOWN, ACT_LIGHT_TOGGLE, ACT_BEACON_TOGGLE, 
    ACT_EMERGENCY_TOGGLE, ACT_HORN
  };


  static Action actionFromName(const String& name);
  static Action actionForKeyToken(String keyToken);
  static Action actionForJoyButtonCached(const String& btnName);
  static void   dispatchAction(Action a, bool pressed);





  // ---- Keyboard defaults (what the UI shows by default too) ----
  static const struct { const char* action; const char* def; } KEYMAP_DEFAULTS[] = {
    {"forward",       "w"},
    {"backward",      "s"},
    {"left",          "a"},
    {"right",         "d"},
    {"stop",          " "},   // space
    {"arm_up",        " "},        
    {"arm_down",      " "},
    {"bucket_up",     "e"},
    {"bucket_down",   "q"},
    {"aux_up",        "r"},
    {"aux_down",      "f"},
    {"light_toggle",  "l"},
    {"beacon", "b"},
    {"emergency","x"},
    {"horn",          "h"},
  };
  static const size_t KEYMAP_N = sizeof(KEYMAP_DEFAULTS)/sizeof(KEYMAP_DEFAULTS[0]);

  // ---- Joypad defaults (Bluepad32-style names) ----
  // Keep simple & digital to start; you can extend with axes later.
  static const struct { const char* action; const char* defBtn; } JOYMAP_DEFAULTS[] = {
    {"forward",       "DPAD_UP"},
    {"backward",      "DPAD_DOWN"},
    {"left",          "DPAD_LEFT"},
    {"right",         "DPAD_RIGHT"},
    {"stop",          "BTN_BACK"},       // “select/back” as stop
    {"arm_up",        "L_STICK_UP"},     // ⟵ changed
    {"arm_down",      "L_STICK_DOWN"},   // ⟵ changed 
    {"bucket_up",     "R1"},
    {"bucket_down",   "L1"},
    {"aux_up",        "R2_CLICK"},       // treat R2/L2 as “click” if your lib offers it
    {"aux_down",      "L2_CLICK"},
    {"light_toggle",  "X"},
    {"beacon", "Y"},
    {"emergency","B"},
    {"horn",          "A"},
  };
  static const size_t JOYMAP_N = sizeof(JOYMAP_DEFAULTS)/sizeof(JOYMAP_DEFAULTS[0]);

  // Normalize UI tokens to stored form
  static String normKeyToken(String s) {
    // handle literal single space BEFORE trimming
    if (s.length() == 1 && s[0] == ' ') return String(" ");

    s.trim();
    if (s.equalsIgnoreCase("Space")) return String(" ");
    if (s.startsWith("Arrow")) { s.toLowerCase(); return s; }  // ArrowUp -> arrowup
    s.toLowerCase();                                           // letters/digits -> lowercase
    return s;
  }

  // Accept both UI camelCase and firmware snake_case names
  struct ActionAlias { const char* fw; const char* alias; };
  static const ActionAlias ACTION_ALIASES[] = {
    {"forward","forward"}, {"backward","backward"}, {"left","left"}, {"right","right"},
    {"stop","stop"},
    {"arm_up","armUp"}, {"arm_down","armDown"},
    {"bucket_up","bucketUp"}, {"bucket_down","bucketDown"},
    {"aux_up","auxUp"}, {"aux_down","auxDown"},
    {"light_toggle","led"}, {"beacon","beacon"},
    {"emergency","emergency"},               // UI "emergency"
    {"emergency","emergency_toggle"},        // legacy alias accepted too
    {"horn","horn"},
  };
  static const size_t ACTION_ALIASES_N = sizeof(ACTION_ALIASES)/sizeof(ACTION_ALIASES[0]);

  static String aliasToFw(const String& key) {
    for (size_t i=0;i<ACTION_ALIASES_N;++i) {
      if (key.equalsIgnoreCase(ACTION_ALIASES[i].alias)) return String(ACTION_ALIASES[i].fw);
      if (key.equalsIgnoreCase(ACTION_ALIASES[i].fw))    return String(ACTION_ALIASES[i].fw);
    }
    return key;
  }

//-------------------------------------------------------------------UI Settings variables---------------------------------------------------------

  bool darkMode    = false;
  bool horScreen   = false;
  bool holdBucket  = false;
  bool holdAux     = false;
  bool tlmEnabled  = false;
  bool sSndEnabled = false;
  bool wsRebootOnDisconnect = true;
  static const char* PREF_WS_REBOOT_WATCHDOG = "WsRebootWD"; // <=15 chars for ESP32 Preferences
  static const char* PREF_SERIALLOG_RATE_MS = "SerLogInt";   // <=15 chars for ESP32 Preferences
  static const char* PREF_SERIALLOG_KEEP_LINES = "SerLogKeep"; // <=15 chars for ESP32 Preferences
  static const char* PREF_INDICATORS_VISIBLE = "MetersVis";
  static const char* PREF_INDICATORS_X = "MetersX";
  static const char* PREF_INDICATORS_Y = "MetersY";
  static const char* PREF_IMU_VISIBLE = "ImuVis";
  static const char* PREF_IMU_X = "ImuX";
  static const char* PREF_IMU_Y = "ImuY";
  static const char* PREF_MEDIA_VISIBLE = "MediaVis";
  static const char* PREF_MEDIA_X = "MediaX";
  static const char* PREF_MEDIA_Y = "MediaY";
  static const char* PREF_PATH_VISIBLE = "PathVis";
  static const char* PREF_PATH_X = "PathX";
  static const char* PREF_PATH_Y = "PathY";
  static const char* PREF_MODEL3D_VISIBLE = "M3DVis";
  static const char* PREF_MODEL3D_X = "M3DX";
  static const char* PREF_MODEL3D_Y = "M3DY";
  static const char* PREF_VIEW_OVERLAP_FX = "VwOvFx";
  static const char* PREF_VIEW_SNAP_FX = "VwSnFx";
  static const char* PREF_VIEW_GRAVITY_FX = "VwGrFx";
  static const char* PREF_VIEW_GRAVITY_ST = "VwGrStr";
  bool bluepadEnabled = false;
  bool indicatorsVisible = true;
  int  indicatorsPosX = -1;
  int  indicatorsPosY = -1;
  bool imuVisible = true;
  int  imuPosX = -1;
  int  imuPosY = -1;
  bool mediaVisible = true;
  int  mediaPosX = -1;
  int  mediaPosY = -1;
  bool pathVisible = true;
  int  pathPosX = -1;
  int  pathPosY = -1;
  bool model3dVisible = true;
  int  model3dPosX = -1;
  int  model3dPosY = -1;
  bool viewOverlapFxEnabled = true;
  bool viewSnapFxEnabled = true;
  bool viewGravityFxEnabled = true;
  int  viewGravityFxStrength = 55;
  int  sSndVolume  = 15;
  int  modelRotXDeg = 0;
  int  modelRotYDeg = 0;
  int  modelRotZDeg = 0;
  int  modelDirX   = 1;
  int  modelDirY   = 1;
  int  modelDirZ   = 1;
  int  modelAxisX  = 0;
  int  modelAxisY  = 1;
  int  modelAxisZ  = 2;


  // global constants
  //const char* ap_ssid = "MiniExco_Setup";

  bool light = false;


  AsyncWebServer server(80);
  AsyncWebSocket wsCarInput("/CarInput");
  bool wsAttached = false;
  bool lobbyServerStarted = false;
  bool fullServerStarted = false;

  static inline void wsSendKeyInt(const char* key, int value, AsyncWebSocketClient* client = nullptr) {
    char msg[48];
    int n = snprintf(msg, sizeof(msg), "%s,%d", key, value);
    if (n <= 0) return;
    if (client) client->text(msg, n);
    else wsCarInput.textAll(msg, n);
  }

  static inline void wsSendKeyStr(const char* key, const char* value, AsyncWebSocketClient* client = nullptr) {
    if (!key || !value) return;
    const size_t keyLen = strlen(key);
    const size_t valLen = strlen(value);
    const size_t total = keyLen + 1 + valLen;
    char* buf = (char*)alloca(total + 1);  // stack to avoid heap churn
    memcpy(buf, key, keyLen);
    buf[keyLen] = ',';
    memcpy(buf + keyLen + 1, value, valLen);
    buf[total] = '\0';
    if (client) client->text(buf, total);
    else wsCarInput.textAll(buf, total);
  }

  static inline void wsSendKeyStr(const char* key, const String& value, AsyncWebSocketClient* client = nullptr) {
    wsSendKeyStr(key, value.c_str(), client);
  }

  static inline void wsPrintfAll(const char* fmt, ...) {
    char buf[256];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n <= 0) return;
    size_t len = (n < (int)sizeof(buf)) ? (size_t)n : sizeof(buf) - 1;
    wsCarInput.textAll(buf, len);
  }

  static void broadcastGpioConfig(AsyncWebSocketClient* client) {
    char payload[512];
    size_t len = serializeGpioConfigCsv(gpioConfig, payload, sizeof(payload));
    if (!len) return;
    if (client) client->text(payload, len);
    else wsCarInput.textAll(payload, len);
  }

  static void sendJsonError(AsyncWebServerRequest* req, int code, const char* message) {
    String payload = String("{\"error\":\"") + message + "\"}";
    AsyncWebServerResponse* resp = req->beginResponse(code, "application/json", payload);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    req->send(resp);
  }

  static String urlEncodeComponent(const String& value) {
    String encoded;
    encoded.reserve(value.length() * 3);  // worst case
    constexpr char hex[] = "0123456789ABCDEF";
    for (size_t i = 0; i < value.length(); ++i) {
      uint8_t c = static_cast<uint8_t>(value[i]);
      if ((c >= 'a' && c <= 'z') ||
          (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') ||
          c == '-' || c == '_' || c == '.' || c == '~') {
        encoded += static_cast<char>(c);
      } else {
        encoded += '%';
        encoded += hex[(c >> 4) & 0x0F];
        encoded += hex[c & 0x0F];
      }
    }
    return encoded;
  }

  static constexpr size_t SERIAL_LOG_RING_SIZE = SERIAL_LOG_KEEP_LINES_MAX;
  static constexpr size_t SERIAL_LOG_LINE_MAX  = 280;
  static char* serialLogRing = nullptr;                          // contiguous [N][LINE_MAX+1]
  static size_t serialLogHead = 0;
  static size_t serialLogCount = 0;
  static uint32_t serialLastWsPushMs = 0;

  static bool initSerialLogStorage() {
    if (serialLogRing) return true;
    const size_t bytes = SERIAL_LOG_RING_SIZE * (SERIAL_LOG_LINE_MAX + 1);
    serialLogRing = (char*)heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!serialLogRing) {
      serialLogRing = (char*)heap_caps_malloc(bytes, MALLOC_CAP_8BIT);
    }
    if (!serialLogRing) return false;
    memset(serialLogRing, 0, bytes);
    return true;
  }

  static inline size_t serialLogActiveCapacity() {
    size_t cap = (size_t)serialLogRetainLines;
    if (cap < SERIAL_LOG_KEEP_LINES_MIN) cap = SERIAL_LOG_KEEP_LINES_MIN;
    if (cap > SERIAL_LOG_RING_SIZE) cap = SERIAL_LOG_RING_SIZE;
    return cap;
  }

  static void clearSerialLogBuffer() {
    serialLogHead = 0;
    serialLogCount = 0;
    if (serialLogRing) {
      const size_t bytes = SERIAL_LOG_RING_SIZE * (SERIAL_LOG_LINE_MAX + 1);
      memset(serialLogRing, 0, bytes);
    }
  }

  static inline char* serialLogSlot(size_t idx) {
    return serialLogRing + (idx * (SERIAL_LOG_LINE_MAX + 1));
  }

  static void serialLogPushLine(const char* line, bool sendWs = true) {
    if (!line) return;
    if (!initSerialLogStorage()) return;
    const size_t cap = serialLogActiveCapacity();
    char* slot = serialLogSlot(serialLogHead);
    size_t out = 0;
    for (const char* p = line; *p && out < SERIAL_LOG_LINE_MAX; ++p) {
      if (*p == '\r') continue;
      slot[out++] = *p;
    }
    slot[out] = '\0';
    serialLogHead = (serialLogHead + 1) % cap;
    if (serialLogCount < cap) serialLogCount++;
    if (sendWs && wsAttached && wsCarInput.count() > 0 && serialLogWsMinIntervalMs > 0) {
      const uint32_t now = millis();
      if (now - serialLastWsPushMs >= serialLogWsMinIntervalMs) {
        serialLastWsPushMs = now;
        wsSendKeyStr("SERLOG", slot);
      }
    }
  }

  static inline void serialLogPushLine(const String& line, bool sendWs = true) {
    serialLogPushLine(line.c_str(), sendWs);
  }

  static void serialMirrorPrint(const char* text, bool appendNewline) {
    if ((!text || !text[0]) && !appendNewline) return;
    char buf[SERIAL_LOG_LINE_MAX + 1];
    if (!text) text = "";
    strncpy(buf, text, SERIAL_LOG_LINE_MAX);
    buf[SERIAL_LOG_LINE_MAX] = '\0';
    if (appendNewline) {
      size_t n = strlen(buf);
      while (n && (buf[n - 1] == '\n' || buf[n - 1] == '\r')) {
        buf[--n] = '\0';
      }
    }
    serialLogPushLine(buf, true);
  }

  static void serialMirrorPrintf(const char* fmt, ...) {
    if (!fmt) return;
    char buf[320];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n <= 0) return;
    size_t len = (n < (int)sizeof(buf)) ? (size_t)n : sizeof(buf) - 1;
    while (len && (buf[len - 1] == '\n' || buf[len - 1] == '\r')) {
      buf[--len] = '\0';
    }
    serialLogPushLine(buf, true);
  }

  static String httpsGet(const String& url, int* statusOut = nullptr) {
    WiFiClientSecure client;
    client.setInsecure();  // TODO: replace with CA pinning for radio-browser.info
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setTimeout(8000);
    http.setUserAgent("MiniExco/2.00 (radio-browser relay)");
    if (!http.begin(client, url)) {
      if (statusOut) {
        *statusOut = -1;
      }
      return String();
    }
    const int code = http.GET();
    if (statusOut) {
      *statusOut = code;
    }
    const String body = (code >= 200 && code < 300) ? http.getString() : String();
    http.end();
    if (code >= 200 && code < 300 && body.length()) {
      return body;
    }
    return String();
  }

  static bool otaDownloadAndApplyFromUrl(const String& url, String& errorOut) {
    errorOut = "";

    if (!(url.startsWith("https://") || url.startsWith("http://"))) {
      errorOut = "invalid_url";
      return false;
    }

    std::unique_ptr<WiFiClientSecure> secureClient;
    std::unique_ptr<WiFiClient> plainClient;
    WiFiClient* netClient = nullptr;

    if (url.startsWith("https://")) {
      auto* c = new WiFiClientSecure();
      c->setInsecure();
      secureClient.reset(c);
      netClient = secureClient.get();
    } else {
      plainClient.reset(new WiFiClient());
      netClient = plainClient.get();
    }

    if (!netClient) {
      errorOut = "no_client";
      return false;
    }

    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    http.setConnectTimeout(8000);
    http.setTimeout(15000);
    http.setUserAgent("MiniExco/2.00 OTA-device-fetch");

    if (!http.begin(*netClient, url)) {
      errorOut = "http_begin_failed";
      return false;
    }

    const int code = http.GET();
    if (code < 200 || code >= 300) {
      errorOut = String("http_") + String(code);
      http.end();
      return false;
    }

    const int contentLen = http.getSize();
    WiFiClient* stream = http.getStreamPtr();
    if (!stream) {
      errorOut = "no_stream";
      http.end();
      return false;
    }

    if (!Update.begin((contentLen > 0) ? (size_t)contentLen : UPDATE_SIZE_UNKNOWN)) {
      errorOut = String("update_begin_") + Update.errorString();
      http.end();
      return false;
    }

    uint8_t buf[2048];
    size_t totalWritten = 0;
    uint32_t lastDataMs = millis();

    while (http.connected() && (contentLen < 0 || (int)totalWritten < contentLen)) {
      const size_t avail = stream->available();
      if (avail == 0) {
        if (millis() - lastDataMs > 15000) break;
        delay(1);
        continue;
      }

      const size_t toRead = (avail > sizeof(buf)) ? sizeof(buf) : avail;
      const int rd = stream->readBytes(buf, toRead);
      if (rd <= 0) continue;

      const size_t wr = Update.write(buf, (size_t)rd);
      if (wr != (size_t)rd) {
        errorOut = String("update_write_") + Update.errorString();
        Update.abort();
        http.end();
        return false;
      }

      totalWritten += wr;
      lastDataMs = millis();
    }

    http.end();

    if (contentLen > 0 && totalWritten != (size_t)contentLen) {
      errorOut = String("size_mismatch_") + String(totalWritten) + "/" + String(contentLen);
      Update.abort();
      return false;
    }

    if (!Update.end(true)) {
      errorOut = String("update_end_") + Update.errorString();
      return false;
    }

    return true;
  }

  static String rbFetchPath(const String& path, int* statusOut = nullptr) {
    static const char* bases[] = {
      "https://all.api.radio-browser.info/json",  // dispatcher
      "https://de2.api.radio-browser.info/json",  // mirror
      "https://nl1.api.radio-browser.info/json",  // mirror
      "http://37.27.202.89/json"                  // direct IP fallback (HTTP)
    };

    String lastUrl;
    int lastCode = -1;

    for (const char* base : bases) {
      const bool useHttps = (strncmp(base, "https://", 8) == 0);
      std::unique_ptr<WiFiClientSecure> httpsClient;
      std::unique_ptr<WiFiClient> httpClient;
      WiFiClient* rawClient = nullptr;
      if (useHttps) {
        auto* c = new WiFiClientSecure();
        c->setInsecure();
        httpsClient.reset(c);
        rawClient = httpsClient.get();
      } else {
        httpClient.reset(new WiFiClient());
        rawClient = httpClient.get();
      }
      HTTPClient http;
      http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      http.setTimeout(8000);
      http.setUserAgent("MiniExco/2.00 (radio-browser relay)");
      const String url = String(base) + path;
      int code = -1;
      if (rawClient && http.begin(*rawClient, url)) {
        http.setConnectTimeout(5000);
        code = http.GET();
        lastUrl = url;
        if (statusOut) {
          *statusOut = code;
        }
        if (code >= 200 && code < 300) {
          const String body = http.getString();
          http.end();
          if (body.length()) {
            return body;
          }
        }
        http.end();
        lastCode = code;
      } else if (statusOut) {
        *statusOut = -1;
        lastCode = -1;
        lastUrl = url;
      }
    }
    if (statusOut && *statusOut == 0) {
      *statusOut = lastCode;
    }
    if (!lastUrl.isEmpty()) {
      DBG_PRINTF("[RB] all bases failed lastCode=%d lastUrl=%s\n", lastCode, lastUrl.c_str());
    }
    return String();
  }

  struct RbCacheEntry {
    String key;
    String body;
    uint32_t ts;
  };
  static RbCacheEntry rbCache[6];

  static String rbCacheGet(const String& key, uint32_t ttlMs) {
    const uint32_t now = millis();
    for (auto& e : rbCache) {
      if (e.key == key && (now - e.ts) < ttlMs) {
        return e.body;
      }
    }
    return String();
  }

  static void rbCachePut(const String& key, const String& body) {
    // place or overwrite the oldest/empty slot
    uint32_t oldestTs = UINT32_MAX;
    RbCacheEntry* slot = &rbCache[0];
    for (auto& e : rbCache) {
      if (e.key == key) {
        e.body = body;
        e.ts = millis();
        return;
      }
      uint32_t age = millis() - e.ts;
      if (e.key.isEmpty() || age > oldestTs) {
        oldestTs = age;
        slot = &e;
      }
    }
    slot->key = key;
    slot->body = body;
    slot->ts = millis();
  }

  static void setupRadioBrowserRelay(AsyncWebServer& server) {
    // TODO: consider lightweight caching/throttling if upstream becomes unstable
    server.on("/rb/countries", HTTP_GET, [](AsyncWebServerRequest* req) {
      int code = 0;
      const String cacheKey = "/countries?hidebroken=true&order=name";
      const String fallbackBody =
        "[{\"name\":\"Azerbaijan\",\"iso_3166_1\":\"AZ\"},"
        "{\"name\":\"Turkey\",\"iso_3166_1\":\"TR\"},"
        "{\"name\":\"Germany\",\"iso_3166_1\":\"DE\"},"
        "{\"name\":\"United Kingdom\",\"iso_3166_1\":\"GB\"},"
        "{\"name\":\"United States\",\"iso_3166_1\":\"US\"}]";
      String body = rbCacheGet(cacheKey, 5UL * 60UL * 1000UL);  // 5 min cache

      // Non-blocking default: return cache/fallback immediately.
      // Use /rb/countries?refresh=1 only when explicitly refreshing cache.
      const bool doRefresh = req->hasParam("refresh");
      if (body.isEmpty()) {
        body = fallbackBody;
      }
      if (doRefresh) {
        String fresh = rbFetchPath(cacheKey, &code);
        if (!fresh.isEmpty()) {
          body = fresh;
          rbCachePut(cacheKey, fresh);
        } else {
          DBG_PRINTF("[RB] countries refresh failed, code=%d; serving cached/fallback\n", code);
        }
      }
      AsyncWebServerResponse* resp = req->beginResponse(200, "application/json", body);
      resp->addHeader("Access-Control-Allow-Origin", "*");
      req->send(resp);
    });

    server.on("/rb/stations", HTTP_GET, [](AsyncWebServerRequest* req) {
      String countryCode;
      if (req->hasParam("country")) {
        countryCode = req->getParam("country")->value();
      } else if (req->hasParam("code")) {
        countryCode = req->getParam("code")->value();
      } else {
        sendJsonError(req, 400, "missing_country");
        return;
      }
      countryCode.trim();
      countryCode.toUpperCase();
      if (!countryCode.length()) {
        sendJsonError(req, 400, "invalid_country");
        return;
      }
      String path = "/stations/bycountrycodeexact/" + urlEncodeComponent(countryCode);
      String query;
      if (req->hasParam("limit")) {
        int limit = req->getParam("limit")->value().toInt();
        if (limit > 0) {
          limit = constrain(limit, 1, 200);
          query = String("?limit=") + String(limit);
        }
      }
      const String cacheKey = String("stations:") + countryCode + ":" + (req->hasParam("limit") ? req->getParam("limit")->value() : "");
      int code = 0;
      String body = rbCacheGet(cacheKey, 2UL * 60UL * 1000UL);  // 2 min cache per country

      // Non-blocking default: serve cached stations or [] immediately.
      // Use /rb/stations?...&refresh=1 only when explicitly refreshing cache.
      const bool doRefresh = req->hasParam("refresh");
      if (body.isEmpty()) {
        body = "[]";
      }
      if (doRefresh) {
        String fresh;
        for (int attempt = 0; attempt < 2 && fresh.isEmpty(); ++attempt) {
          fresh = rbFetchPath(path + query, &code);
          if (fresh.isEmpty() && code == 429) {
            delay(60);
          }
        }
        if (!fresh.isEmpty()) {
          body = fresh;
          rbCachePut(cacheKey, fresh);
        } else {
          DBG_PRINTF("[RB] stations refresh failed code=%d country=%s; serving cached/empty\n", code, countryCode.c_str());
        }
      }
      AsyncWebServerResponse* resp = req->beginResponse(200, "application/json", body);
      resp->addHeader("Access-Control-Allow-Origin", "*");
      req->send(resp);
    });
  }

  static void handleBluepadStateChange(bool enable, bool persistPrefs, bool notifyClients) {
    bool stateChanged = (bluepadEnabled != enable);
    bluepadEnabled = enable;

    if (persistPrefs && stateChanged) {
      uiPrefs.putBool("BluepadEnabled", bluepadEnabled);
    }

    if (bluepadEnabled) {
      startBluepadRuntime();
    } else {
      stopBluepadRuntime();
    }

    if (notifyClients && stateChanged && wsCarInput.count() > 0) {
      wsSendKeyInt("GamepadEnabled", bluepadEnabled ? 1 : 0);
    }

    if (stateChanged) {
      DBG_PRINTF("[Bluepad32] state -> %s\n", bluepadEnabled ? "ON" : "OFF");
    }
  }


  // --- PSRAM allocator for ESP32 Arduino ---
  // This must be defined ONCE, above all vector declarations that use it.
  #if USE_PSRAM
  template <class T>
  struct psram_allocator : public std::allocator<T> {
      template<class U> struct rebind { typedef psram_allocator<U> other; };
      T* allocate(std::size_t n) {
          void* p = ps_malloc(n * sizeof(T));
          if (!p) throw std::bad_alloc();
          return static_cast<T*>(p);
      }
      void deallocate(T* p, std::size_t) noexcept { free(p); }
  };
  #endif

  // ---- MIME helper for serving static from SD (adds GLB etc.) ----
  static String mimeOf(const String& p) {
    if (p.endsWith(".html")) return "text/html";
    if (p.endsWith(".js"))   return "application/javascript";
    if (p.endsWith(".css"))  return "text/css";
    if (p.endsWith(".json")) return "application/json";
    if (p.endsWith(".svg"))  return "image/svg+xml";
    if (p.endsWith(".glb"))  return "model/gltf-binary";
    if (p.endsWith(".wasm")) return "application/wasm";
    if (p.endsWith(".ico"))  return "image/x-icon";
    if (p.endsWith(".mp3"))  return "audio/mpeg";
    if (p.endsWith(".wav"))  return "audio/wav";
    if (p.endsWith(".png"))  return "image/png";
    if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
    return "application/octet-stream";
  }

  // ---- Serve /path or /path.gz if present ----
  static bool sendMaybeGz(AsyncWebServerRequest* req, const String& path) {
    String gz = path + F(".gz");

    if (SD.exists(gz)) {
      File f = SD.open(gz, FILE_READ);
      if (!f) return false;

      AsyncWebServerResponse* res = req->beginResponse(f, path, mimeOf(path));
      res->addHeader(F("Content-Encoding"), F("gzip"));
      res->addHeader(F("Cache-Control"), F("no-store"));
      req->send(res);
      return true;
    }

    if (SD.exists(path)) {
      File f = SD.open(path, FILE_READ);
      if (!f) return false;

      AsyncWebServerResponse* res = req->beginResponse(f, path, mimeOf(path));
      res->addHeader(F("Cache-Control"), F("no-store"));
      req->send(res);
      return true;
    }

    return false;
  }



//-----------------------------------------------------------------------PSRAM GLOBALS-------------------------------------------------------------
  // -----------------------------------------------------
  // PSRAM-based or regular vector declarations for globals
  // Place this block after your struct/class definitions (TelemetrySample, PathPoint)
  // and after psram_allocator is defined
  // -----------------------------------------------------

  #if USE_PSRAM
  // Use psram_allocator for all large or expandable vectors to store them in external PSRAM.
  // This saves valuable internal RAM for stack/heap.
  // You can add any additional vectors here to move them to PSRAM.

  std::vector<String, psram_allocator<String>> playlist;           // Stores filenames or track names for media
  std::vector<int, psram_allocator<int>> folderIndex;              // Index mapping for folders
  std::vector<PathPoint, psram_allocator<PathPoint>> pathPoints;   // List of path points received from frontend UI
  std::vector<TelemetrySample, psram_allocator<TelemetrySample>> telemetryBuffer; // Buffer for telemetry logging

  #else
  // If not using PSRAM, fall back to normal std::vector on internal RAM.

  std::vector<String> playlist;
  std::vector<int> folderIndex;
  std::vector<PathPoint> pathPoints;
  std::vector<TelemetrySample> telemetryBuffer;

  #endif

  static bool ensurePlaylistLoaded();

  int currentTrack = 0;
  int currentVolume = 15;    // Default volume (0–21)

  String currentlyPlayingFile = "";
  unsigned long lastMediaProgressSend = 0;
  static String pendingRadioUrl;
  static bool radioPlayQueued = false;





//-----------------------------------------------------------------MDNS HELPERS TO SANITIZE ID-----------------------------------------------------

  // Global sanitized hostname to use everywhere (STA/AP/mDNS)
  String g_mdnsHost;

  // Make a valid mDNS/DHCP hostname from S3_ID (lowercase, [a-z0-9-], <=63)
  static String makeMdnsHostFromId(const char* id) {
    String s = id;
    s.toLowerCase();
    for (size_t i = 0; i < s.length(); ++i) {
      char c = s[i];
      bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || (c == '-');
      if (!ok) s.setCharAt(i, '-');
    }
    while (s.length() && s[0] == '-') s.remove(0, 1);
    while (s.length() && s[s.length()-1] == '-') s.remove(s.length()-1, 1);
    while (s.indexOf("--") != -1) s.replace("--", "-");
    if (s.isEmpty()) s = "esp32";
    if (s.length() > 63) s = s.substring(0, 63);
    return s;
  }

  // Call this early (before/around WiFi.begin) to set DHCP hostname
  static void initHostnames() {
    g_mdnsHost = makeMdnsHostFromId(getS3Id().c_str());  // e.g. "miniexco-s3-v1-01"
    WiFi.setHostname(g_mdnsHost.c_str());
  }

  // Start mDNS after you are connected (STA) or after AP is up (AP)
  static bool startMdns() {
    if (MDNS.begin(g_mdnsHost.c_str())) {
      MDNS.setInstanceName(getS3Id().c_str());                 // pretty name
      MDNS.addService("http", "tcp", 80);          // UI
      MDNS.addServiceTxt("http", "tcp", "path", "/");
      MDNS.addService("http", "tcp", 81);          // stream
      MDNS.addServiceTxt("http", "tcp", "path", "/stream");
      return true;
    }
    return false;
  }
//---------------------------------------------------------------------------------------------------------------------------------------------------


//-------------------------------------------------------------------------FUNCTIONS-----------------------------------------------------------------


//----------------------------------------------------------------------Robot Cam Settings----------------------------------------------------------

  void startCameraServer();

  bool startCamera() {
    camera_config_t config;
    config.ledc_channel = LEDC_CHANNEL_0;
    config.ledc_timer   = LEDC_TIMER_0;
    config.pin_d0       = gpioConfig.camY2;
    config.pin_d1       = gpioConfig.camY3;
    config.pin_d2       = gpioConfig.camY4;
    config.pin_d3       = gpioConfig.camY5;
    config.pin_d4       = gpioConfig.camY6;
    config.pin_d5       = gpioConfig.camY7;
    config.pin_d6       = gpioConfig.camY8;
    config.pin_d7       = gpioConfig.camY9;
    config.pin_xclk     = gpioConfig.camXclk;
    config.pin_pclk     = gpioConfig.camPclk;
    config.pin_vsync    = gpioConfig.camVsync;
    config.pin_href     = gpioConfig.camHref;
    config.pin_sccb_sda = gpioConfig.camSiod;
    config.pin_sccb_scl = gpioConfig.camSioc;
    config.pin_pwdn     = gpioConfig.camPwdn;
    config.pin_reset    = gpioConfig.camReset;

    config.xclk_freq_hz = 10000000;
    config.frame_size   = FRAMESIZE_VGA;   // lower default to reduce init footprint
    config.pixel_format = PIXFORMAT_JPEG;
    config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
    config.fb_location  = CAMERA_FB_IN_PSRAM;
    config.jpeg_quality = 14;              // start a bit lower quality to reduce load
    config.fb_count     = 1;

    if (config.pixel_format == PIXFORMAT_JPEG) {
      if (psramFound()) {
        config.jpeg_quality = 12;
        config.fb_count     = 1;
        //config.grab_mode    = CAMERA_GRAB_LATEST;
        config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;

      } else {
        config.frame_size   = FRAMESIZE_VGA;
        //config.fb_location  = CAMERA_FB_IN_DRAM;
        config.fb_location  = CAMERA_FB_IN_PSRAM;
      }
    } else {
      config.frame_size = FRAMESIZE_240X240;
    #if CONFIG_IDF_TARGET_ESP32S3
      config.fb_count = 1;
    #endif
    }

    esp_err_t err = esp_camera_init(&config);
    lastCameraInitErr = (int)err;

    DBG_PRINTF("[HEAP][After camera init] Free: %u, MinFree: %u, MaxAlloc: %u\n",
              ESP.getFreeHeap(),
              heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT),
              heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    DBG_PRINTF("[PSRAM][After camera init] Free: %u, MinFree: %u, MaxAlloc: %u\n",
              heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
              heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM),
              heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM));

    if (err != ESP_OK) {
      DBG_PRINTF("Camera init failed with error 0x%x\n", err);
      return false;
    }

    sensor_t *s = esp_camera_sensor_get();
    if (s && s->id.PID == OV3660_PID) {
      s->set_vflip(s, 1);
      s->set_brightness(s, 1);
      s->set_saturation(s, -2);
    }
    if (config.pixel_format == PIXFORMAT_JPEG && s) {
      s->set_framesize(s, FRAMESIZE_QVGA);
    }

    return true;
  }


  void applySavedCamSettings() {
      sensor_t *s = esp_camera_sensor_get();
      if (!s) return;

      // === Universal settings ===
      int res        = camPrefs.getInt("res", FRAMESIZE_VGA);
      int quality    = camPrefs.getInt("quality", 10);
      int contrast   = camPrefs.getInt("contrast", 0);
      int brightness = camPrefs.getInt("brightness", 0);
      int saturation = camPrefs.getInt("saturation", 0);
      int gray       = camPrefs.getInt("gray", 0);
      int hmirror    = camPrefs.getInt("hmirror", 0);
      int vflip      = camPrefs.getInt("vflip", 0);
      int special_effect = camPrefs.getInt("special_effect", 0);
      int wb_mode    = camPrefs.getInt("wb_mode", 0);
      int awb        = camPrefs.getInt("awb", 1);
      int agc        = camPrefs.getInt("agc", 1);
      int agc_gain   = camPrefs.getInt("agc_gain", 0);
      int aec        = camPrefs.getInt("aec", 1);
      int aec_value  = camPrefs.getInt("aec_value", 300);
      int aec2       = camPrefs.getInt("aec2", 0);
      int dcw        = camPrefs.getInt("dcw", 1);
      int bpc        = camPrefs.getInt("bpc", 0);
      int wpc        = camPrefs.getInt("wpc", 1);
      int raw_gma    = camPrefs.getInt("raw_gma", 1);
      int lenc       = camPrefs.getInt("lenc", 1);
      int gainceiling= camPrefs.getInt("gainceiling", 0);
      int colorbar   = camPrefs.getInt("colorbar", 0);

      s->set_framesize(s, (framesize_t)res);
      s->set_quality(s, quality);
      s->set_contrast(s, contrast);
      s->set_brightness(s, brightness);
      s->set_saturation(s, saturation);
      s->set_special_effect(s, special_effect);
      s->set_hmirror(s, hmirror);
      s->set_vflip(s, vflip);
      s->set_whitebal(s, awb);
      s->set_wb_mode(s, wb_mode);
      s->set_gain_ctrl(s, agc);
      s->set_agc_gain(s, agc_gain);
      s->set_exposure_ctrl(s, aec);
      s->set_aec_value(s, aec_value);
      s->set_aec2(s, aec2);
      s->set_dcw(s, dcw);
      s->set_bpc(s, bpc);
      s->set_wpc(s, wpc);
      s->set_raw_gma(s, raw_gma);
      s->set_lenc(s, lenc);
      s->set_gainceiling(s, (gainceiling_t)gainceiling);
      s->set_colorbar(s, colorbar);

      // === OV2640-specific ===
      if (s->id.PID == OV2640_PID) {
          int sharpness  = camPrefs.getInt("sharpness", 2);
          int denoise    = camPrefs.getInt("denoise", 0);
          int compression= camPrefs.getInt("compression", 12);

          if (s->set_sharpness) s->set_sharpness(s, sharpness);
          if (s->set_denoise)   s->set_denoise(s, denoise);
          if (s->set_quality)   s->set_quality(s, compression); // Can be optional
      }

      // === OV5640-specific ===
      if (s->id.PID == OV5640_PID) {
          int sharpness  = camPrefs.getInt("sharpness", 33);    // 0..255
          int denoise    = camPrefs.getInt("denoise", 0);       // 0,1
          int brightness = camPrefs.getInt("brightness", 0);    // -4..4
          int saturation = camPrefs.getInt("saturation", 0);    // -4..4
          int contrast   = camPrefs.getInt("contrast", 0);      // -4..4
          // int hue        = camPrefs.getInt("hue", 0);        // NOT USED

          if (s->set_sharpness)   s->set_sharpness(s, sharpness);
          if (s->set_denoise)     s->set_denoise(s, denoise);
          if (s->set_brightness)  s->set_brightness(s, brightness);
          if (s->set_saturation)  s->set_saturation(s, saturation);
          if (s->set_contrast)    s->set_contrast(s, contrast);
          // No set_hue for OV5640 or any camera
      }


      // === Add other models as needed ===
      // For example: OV3660, etc.
      // if (s->id.PID == OV3660_PID) { ... }

      // -- Optionally, print sensor info for debug --
      DBG_PRINTF("Camera PID: 0x%04X\n", s->id.PID);
  }

  // --- Enable/disable functions ---
  bool enableCamera() {
    saveCameraPrefs(true);
    // Start camera HTTP server only when camera is enabled to save idle heap.
    startCameraServer();
    if (!cameraInitialized) {
      if (!startCamera()) {
        DBG_PRINTLN("enableCamera(): startCamera failed (try 1), retrying...");
        esp_camera_deinit();
        delay(40);
        if (!startCamera()) {
          DBG_PRINTF("enableCamera(): startCamera failed (try 2), err=0x%x\n", lastCameraInitErr);
          return false;
        }
      }
      cameraInitialized = true;
      applySavedCamSettings();
      initAdaptiveCameraCaps();
      DBG_PRINTLN("Camera enabled.");
    }
    cameraEnabled = true;
    saveCameraPrefs(true);
    appHttpdResumeStreaming();
    return true;
  }

  bool disableCamera() {
    appHttpdPauseStreaming();
    appHttpdStopActiveStream();
    delay(120); // allow active stream handler to exit and return fb cleanly
    if (cameraInitialized) {
      esp_camera_deinit();
      cameraInitialized = false;
      DBG_PRINTLN("Camera deinitialized.");
    }
    appHttpdStopServer();
    saveCameraPrefs(false);
    cameraEnabled = false;
    return true;
  }

  void loadCameraPrefs() {
      cameraEnabled = camEnablePrefs.getBool("enabled", false);
  }

  void saveCameraPrefs(bool enabled) {
      camEnablePrefs.putBool("enabled", enabled);
  }

  bool loadWsRebootWatchdogPref() {
    // Primary key must stay <=15 chars in Preferences (NVS) API.
    if (uiPrefs.isKey(PREF_WS_REBOOT_WATCHDOG)) {
      return uiPrefs.getBool(PREF_WS_REBOOT_WATCHDOG, true);
    }
    // Legacy key was too long for reliable persistence; keep fallback read.
    return uiPrefs.getBool("WsRebootOnDisconnect", true);
  }

  void saveWsRebootWatchdogPref(bool enabled) {
    wsRebootOnDisconnect = enabled;
    uiPrefs.putBool(PREF_WS_REBOOT_WATCHDOG, enabled);
  }

  void pumpCameraBootRestore(uint32_t nowMs) {
    if (!cameraBootRestorePending) return;
    if (!cameraEnabled) {
      cameraBootRestorePending = false;
      return;
    }
    if (cameraInitialized) {
      cameraBootRestorePending = false;
      return;
    }
    if ((int32_t)(nowMs - cameraBootRestoreNotBeforeMs) < 0) return;
    if (cameraBootRestoreLastTryMs && (nowMs - cameraBootRestoreLastTryMs) < CAMERA_BOOT_RETRY_MS) return;

    cameraBootRestoreLastTryMs = nowMs;
    DBG_PRINTLN("[CAM] Boot restore attempt...");
    if (enableCamera()) {
      cameraBootRestorePending = false;
      DBG_PRINTLN("[CAM] Boot restore success.");
    } else {
      DBG_PRINTF("[CAM] Boot restore failed, err=0x%x (will retry)\n", lastCameraInitErr);
    }
  }

  //----------------------Auto throttle stream quality functions----------------------------


  // Initialize from prefs and actual sensor
  void initAdaptiveCameraCaps() {
    // Use the same prefs your UI writes
    bestQualityCap = clampInt(camPrefs.getInt("quality", 12), 10, 40);
    startFS        = (framesize_t)clampInt(camPrefs.getInt("res", (int)FRAMESIZE_VGA),
                                          (int)minFS, (int)maxFS);
    // new optional UI flags
    allowFsAuto    = camPrefs.getBool("auto_res", false);  
    adaptiveQEnabled  = camPrefs.getBool("adaptive_q", true);

    // Seed from current sensor so we don’t fight a fresh applySavedCamSettings()
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
      curQuality = s->status.quality;
      curFS      = (framesize_t)s->status.framesize;
    }

    // Snap to your prefs and publish them via the stream-safe hook
    curQuality = clampInt(curQuality, bestQualityCap, minQualityFloor);
    curFS      = startFS;
    requestCameraParams(curFS, curQuality);  // stream loop applies between frames
  }

  // Core policy: compute new target (quality, framesize)
  void adaptCameraOnce() {
    // compute FPS
    int frames = frameCount;
    int fps = frames - lastFrameCount;
    lastFrameCount = frames;

    // sample health metrics
    size_t freeHeap   = heap_caps_get_free_size(MALLOC_CAP_8BIT);
    size_t minEver    = heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT);
    int rssi          = WiFi.isConnected() ? WiFi.RSSI() : -100;

    bool needRelief = (freeHeap < HEAP_SOFT_FLOOR) || (rssi <= RSSI_WEAK) || (fps < FPS_LO_HYST);
    bool severe     = (freeHeap < HEAP_HARD_FLOOR) || (rssi <= RSSI_BAD)
                      || (minEver < HEAP_MIN_FREE_ABS) || (fps < TARGET_FPS - 4);
    bool canRecover = (freeHeap > HEAP_SOFT_FLOOR + 40*1024) && (rssi > RSSI_WEAK) && (fps > FPS_HI_HYST);

    int newQ = curQuality;
    framesize_t newFS = curFS;

    // If adaptive quality is OFF, don’t auto-tune quality (only obey manual changes)
    // If auto-res is OFF, never change framesize unless emergency RAM floor
    bool canTouchQuality = adaptiveQEnabled;
    bool canTouchFS = allowFsAuto;

    if (needRelief) {
      if (canTouchQuality) newQ += severe ? QUALITY_STEP * 2 : QUALITY_STEP;
      if (severe && (canTouchFS || freeHeap < HEAP_MIN_FREE_ABS)) {
        newFS = stepDownFS(newFS);
      }
    } else if (canRecover) {
      if (canTouchQuality) newQ -= QUALITY_RECOVER_STEP;
      if (canTouchFS && newFS < startFS &&
          fps > TARGET_FPS + 6 &&                  // FPS well above target (≈15)
          rssi > RSSI_WEAK + 5 &&                  // Wi-Fi is strong, not marginal
          freeHeap > HEAP_SOFT_FLOOR + 64*1024) {  // at least +64k heap above soft floor
        newFS = stepUpFS(newFS);
      }
    }

    // Never exceed user's best/“max” quality or your safety floor
    newQ = clampInt(newQ, bestQualityCap, minQualityFloor);

    // Never go beyond the user’s selected resolution upward
    if (newFS > startFS) newFS = startFS;

    if (newQ != curQuality || newFS != curFS) {
      curQuality = newQ;
      curFS      = newFS;
      requestCameraParams(curFS, curQuality);  // applied cleanly between frames
    }
  }

  void runAdaptiveCamera() {
    if (!cameraEnabled || !cameraInitialized) return;
    uint32_t now = millis();
    if (now - lastTickMs >= ADAPT_PERIOD_MS) {
      lastTickMs = now;
      adaptCameraOnce();
    }
  }

  inline void adaptiveKickNow() {
    // ensures runAdaptiveCamera() triggers adaptCameraOnce() at next iteration
    lastTickMs = (millis() > ADAPT_PERIOD_MS) ? (millis() - ADAPT_PERIOD_MS) : 0;
  }

//------------------------------------------------------------------Telemetry Logging Functions-----------------------------------------------------

  // Quick SD-present check that doesn't open extra files
  static inline bool sdPresent() {
    SdLock lock;
    return SD.cardType() != CARD_NONE;
  }

  // Single place to flip the flag + persist + cleanup
  static void setTelemetryEnabled(bool on) {
    tlmEnabled = on;
    uiPrefs.putBool("RecordTelemetry", tlmEnabled);
    if (!on) {
      telemetryBuffer.clear();       // drop any queued samples
      currentTelemetryFile = "";     // forget target file so we re-pick when re-enabled
    }
  }

  static uint32_t clampTelemetryMaxKB(int32_t kb) {
    if (kb < (int32_t)TELEMETRY_FILE_MAX_KB_MIN) return TELEMETRY_FILE_MAX_KB_MIN;
    if (kb > (int32_t)TELEMETRY_FILE_MAX_KB_MAX) return TELEMETRY_FILE_MAX_KB_MAX;
    return (uint32_t)kb;
  }

  static uint32_t clampSerialLogRateMs(int32_t ms) {
    if (ms < (int32_t)SERIAL_LOG_RATE_MS_MIN) return SERIAL_LOG_RATE_MS_MIN;
    if (ms > (int32_t)SERIAL_LOG_RATE_MS_MAX) return SERIAL_LOG_RATE_MS_MAX;
    return (uint32_t)ms;
  }

  static uint32_t clampSerialLogKeepLines(int32_t lines) {
    if (lines < (int32_t)SERIAL_LOG_KEEP_LINES_MIN) return SERIAL_LOG_KEEP_LINES_MIN;
    if (lines > (int32_t)SERIAL_LOG_KEEP_LINES_MAX) return SERIAL_LOG_KEEP_LINES_MAX;
    return (uint32_t)lines;
  }


  void resetCurrentSample() {
    currentSample.timestamp    = 0;
    currentSample.voltage      = NAN;
    currentSample.temp         = NAN;
    currentSample.charger      = NAN;
    currentSample.imu_euler_x  = NAN;
    currentSample.imu_euler_y  = NAN;
    currentSample.imu_euler_z  = NAN;
    currentSample.imu_mag_x    = NAN;
    currentSample.imu_mag_y    = NAN;
    currentSample.imu_mag_z    = NAN;
    currentSample.imu_temp     = NAN;
    currentSample.fps          = NAN;
  }

  void flushTelemetryBufferToSD_Auto() {
    static unsigned long lastFlushTime = 0;
    if (!tlmEnabled) return;  // Only log when enabled
    if (!sdPresent()) return;   // <- don't even try to open anything if card is ejected

    unsigned long now = millis();
    if (now - lastFlushTime < telemetrySampleInterval) return;
    lastFlushTime = now;

    // --- Set timestamp for this sample ---
    if (timeIsValid) {
      time_t nowT;
      time(&nowT);
      currentSample.timestamp = nowT; // UNIX time
    } else {
      currentSample.timestamp = millis() / 1000;
    }

    // --- Buffer currentSample for writing ---
    telemetryBuffer.push_back(currentSample);
    if (telemetryBuffer.size() > TELEMETRY_BUFFER_MAX_SAMPLES) {
      const size_t overflow = telemetryBuffer.size() - TELEMETRY_BUFFER_MAX_SAMPLES;
      telemetryBuffer.erase(telemetryBuffer.begin(), telemetryBuffer.begin() + overflow);
    }

    // === SD card is accessed from here on ===
    {
      SdLock lock;  // 🔒 Mutex lock for SD access

      // Ensure /telemetry folder exists
      if (!SD.exists("/telemetry")) {
        SD.mkdir("/telemetry");
      }

      int idx = 1;
      // Resolve target file only when current target is missing/unset.
      if (currentTelemetryFile.isEmpty() || !SD.exists(currentTelemetryFile)) {
        // ---- Find the current file number ----
        while (true) {
          String fname = "/telemetry/telemetry_";
          fname += (idx < 10 ? "0" : "");
          fname += String(idx);
          fname += ".csv";

          if (!SD.exists(fname)) {
            // Create new file with header
            File f = SD.open(fname, FILE_WRITE);
            if (f) {
              f.println(TELEMETRY_CSV_HEADER);
              f.close();
            }
            currentTelemetryFile = fname;
            break;
          } else {
            File f = SD.open(fname, FILE_READ);
            if (f && f.size() < telemetryFileMaxSizeBytes) {
              currentTelemetryFile = fname;
              f.close();
              break;
            }
            if (f) f.close();
            idx++;
          }
        }
      } else {
        // Keep current file index for rotate logic below.
        int us = currentTelemetryFile.lastIndexOf('_');
        int dot = currentTelemetryFile.lastIndexOf('.');
        if (us >= 0 && dot > us + 1) idx = currentTelemetryFile.substring(us + 1, dot).toInt();
      }

      // ---- If appending would exceed size, rotate to next file ----
      File f = SD.open(currentTelemetryFile, FILE_APPEND);
      if (!f) {
        // Fallback for FS variants that can fail FILE_APPEND.
        f = SD.open(currentTelemetryFile, FILE_WRITE);
        if (f) f.seek(f.size());
      }
      if (!f) {
        DBG_PRINTF("Failed to open %s for append!\n", currentTelemetryFile.c_str());
        return;
      }
      // Force write cursor to EOF to avoid accidental overwrite.
      f.seek(f.size());

      const size_t estimatedCsvBytesPerSample = 128;
      size_t estimatedSize = telemetryBuffer.size() * estimatedCsvBytesPerSample;
      if (f.size() + estimatedSize > telemetryFileMaxSizeBytes) {
        f.close();
        while (true) {
          idx++;
          String nextFile = "/telemetry/telemetry_";
          nextFile += (idx < 10 ? "0" : "");
          nextFile += String(idx);
          nextFile += ".csv";

          if (!SD.exists(nextFile)) {
            File nf = SD.open(nextFile, FILE_WRITE);
            if (nf) {
              nf.println(TELEMETRY_CSV_HEADER);
              nf.close();
            }
            currentTelemetryFile = nextFile;
            break;
          }

          File rf = SD.open(nextFile, FILE_READ);
          const bool hasRoom = (rf && rf.size() < telemetryFileMaxSizeBytes);
          if (rf) rf.close();
          if (hasRoom) {
            currentTelemetryFile = nextFile;
            break;
          }
        }

        f = SD.open(currentTelemetryFile, FILE_APPEND);
        if (!f) {
          f = SD.open(currentTelemetryFile, FILE_WRITE);
          if (f) f.seek(f.size());
        }
        if (!f) {
          DBG_PRINTF("Failed to open %s for append after rotate!\n", currentTelemetryFile.c_str());
          return;
        }
        f.seek(f.size());
      }

      // ---- Write all samples in the buffer ----
      for (const auto& s : telemetryBuffer) {
          if (timeIsValid) {
              time_t rawTime = (time_t)s.timestamp;
              struct tm * timeinfo = localtime(&rawTime);
              char datetime[24] = {0};
              if (timeinfo) {
                  strftime(datetime, sizeof(datetime), "%Y-%m-%d %H:%M:%S", timeinfo);
                  f.print(datetime);
              } else {
                  f.print("");
              }
          } else {
              f.print("");
          }
          f.print(",");
          f.print(s.timestamp);    f.print(",");
          f.print(s.voltage, 2);   f.print(",");
          f.print(s.temp, 1);      f.print(",");
          f.print(s.charger, 2);   f.print(",");
          f.print(s.imu_euler_x, 2); f.print(",");
          f.print(s.imu_euler_y, 2); f.print(",");
          f.print(s.imu_euler_z, 2); f.print(",");
          f.print(s.imu_mag_x, 2);   f.print(",");
          f.print(s.imu_mag_y, 2);   f.print(",");
          f.print(s.imu_mag_z, 2);   f.print(",");
          f.print(s.imu_temp, 1);    f.print(",");
          f.println(s.fps, 1);
      }

      f.close();
    } // 🔓 Lock automatically released here

    telemetryBuffer.clear();
    resetCurrentSample();
  }


//-------------------------------------------------------------------------NPT Tine sync------------------------------------------------------------
  // Call this after WiFi connects
  void startNtpSync() {
    static bool sntpInit = false;

    // Non-blocking: just configure SNTP and return.
    // (Turkey is UTC+3 permanently; no DST.)
    const long gmtOffset_sec = 3 * 3600;
    configTime(gmtOffset_sec, 0,
              "pool.ntp.org",
              "time.google.com",
              "time.windows.com");

    if (!sntpInit) {
      sntp_set_sync_interval(60UL * 60UL * 1000UL);  // resync every 1h
      sntp_set_time_sync_notification_cb([](struct timeval*) {
        // no-op; ensures FS timestamps get updated when time changes
      });
      sntpInit = true;
    }
  }

  // Non blocking NPT time sync
  void pollTimeValid() {
    static uint32_t lastPollMs = 0;
    static uint8_t  backoffIdx = 0;
    // gentle backoff so we don't spam when offline
    const uint16_t backoffMs[] = {1000, 2000, 4000, 8000, 16000, 30000};

    if (timeIsValid) return;

    // Only try when we actually have internet
    if (WiFi.status() != WL_CONNECTED) return;                // or: if (wifiState != WIFI_STA_CONNECTED) return;

    uint32_t now = millis();
    uint16_t interval = backoffMs[backoffIdx];
    if (now - lastPollMs < interval) return;
    lastPollMs = now;

    struct tm tm;
    // IMPORTANT: short timeout to keep this NON-BLOCKING
    if (getLocalTime(&tm, 50)) {                              // 50 ms max
      if ((tm.tm_year + 1900) >= 2023) {
        timeIsValid = true;
        DBG_PRINT("NTP time is valid: ");
        DBG_PRINTLN(asctime(&tm));                            // asctime() already has a newline

        //  (optional) set callback once; harmless if repeated
        sntp_set_time_sync_notification_cb([](struct timeval *tv) {
          // No-op; ensures FATFS has timestamps
        });

        backoffIdx = 0;                                       // reset backoff
      }
    } else {
      // didn't get time yet; increase backoff up to max
      if (backoffIdx < (sizeof(backoffMs) / sizeof(backoffMs[0]) - 1)) backoffIdx++;
    }
  }

  void pumpTimeSyncTick() {
    static bool sntpConfigured = false;

    // Only do NTP work when STA is actually connected.
    if (wifiState == WIFI_STA_OK || WiFi.status() == WL_CONNECTED) {
      if (!sntpConfigured) {
        startNtpSync();          // just config, returns immediately
        sntpConfigured = true;
        DBG_PRINTLN("[NTP] configured (non-blocking)");
      }

      // This is non-blocking (uses getLocalTime(&tm, 50) + backoff).
      pollTimeValid();

    } else {
      // In AP / disconnected: do nothing (no NTP); reset so we re-config next time.
      if (sntpConfigured) {
        sntpConfigured = false;
        // Optional: if you want to forget "valid" time when leaving STA:
        // timeIsValid = false;
        DBG_PRINTLN("[NTP] paused (not STA-connected)");
      }
    }
  }


//--------------------------------------------------------------------------Lighting----------------------------------------------------------------
  void updatePixels() {
      pixels.clear();

      // =========================
      // Emergency has top priority
      // =========================
      if (emergencyOn) {
          uint32_t col = blinkState ? pixels.Color(255, 180, 0) : 0;
          pixels.setPixelColor(0, col);
          pixels.setPixelColor(5, col);
          pixels.setPixelColor(6, col);
          pixels.setPixelColor(11, col);
          pixels.show();

          // Stop siren if it was running
          if (sirenPlaying) {
              Serial.println("[SIREN] Emergency -> stop");
              stopAudio();
              sirenPlaying = false;
          }
          return;
      }

      // Track last beacon state to detect ON/OFF edges
      static bool lastBeacon = false;

      // ========== Beacon mode ==========
      if (beaconOn) {
          static int phase = 0;
          static unsigned long lastStep = 0;
          const int stepDelay = 90;
          const int whiteFlashes = 3;
          const int phaseCount = 3 + 3 + 3 + whiteFlashes * 2;

          unsigned long now = millis();
          if (now - lastStep > stepDelay) {
              lastStep = now;
              phase = (phase + 1) % phaseCount;
          }

          pixels.clear();
          const int pairs[3][2] = { {0, 5}, {1, 4}, {2, 3} };

          // LED pattern logic...
          if (phase == 0) {
              for (int b = 0; b < 2; b++) {
                  pixels.setPixelColor(pairs[0][b], pixels.Color(0, 0, 255));
                  pixels.setPixelColor(pairs[0][b] + 6, pixels.Color(0, 0, 255));
              }
          } else if (phase == 1) {
              for (int step = 0; step < 2; step++)
                  for (int b = 0; b < 2; b++) {
                      pixels.setPixelColor(pairs[step][b], pixels.Color(0, 0, 255));
                      pixels.setPixelColor(pairs[step][b] + 6, pixels.Color(0, 0, 255));
                  }
          } else if (phase == 2) {
              for (int step = 0; step < 3; step++)
                  for (int b = 0; b < 2; b++) {
                      pixels.setPixelColor(pairs[step][b], pixels.Color(0, 0, 255));
                      pixels.setPixelColor(pairs[step][b] + 6, pixels.Color(0, 0, 255));
                  }
          }
          else if (phase == 3) {
              for (int b = 0; b < 2; b++) {
                  pixels.setPixelColor(pairs[2][b], pixels.Color(255, 0, 0));
                  pixels.setPixelColor(pairs[2][b] + 6, pixels.Color(255, 0, 0));
              }
          } else if (phase == 4) {
              for (int step = 1; step < 3; step++)
                  for (int b = 0; b < 2; b++) {
                      pixels.setPixelColor(pairs[step][b], pixels.Color(255, 0, 0));
                      pixels.setPixelColor(pairs[step][b] + 6, pixels.Color(255, 0, 0));
                  }
          } else if (phase == 5) {
              for (int step = 0; step < 3; step++)
                  for (int b = 0; b < 2; b++) {
                      pixels.setPixelColor(pairs[step][b], pixels.Color(255, 0, 0));
                      pixels.setPixelColor(pairs[step][b] + 6, pixels.Color(255, 0, 0));
                  }
          } else if (phase == 6) {
              for (int i = 0; i < 12; i++) pixels.setPixelColor(i, pixels.Color(255, 0, 0));
          } else if (phase == 7) {
              for (int i = 0; i < 12; i++) pixels.setPixelColor(i, pixels.Color(0, 0, 255));
          } else if (phase == 8) {
              for (int i = 0; i < 12; i++) pixels.setPixelColor(i, pixels.Color(255, 0, 0));
          } else if (phase >= 9 && phase < 9 + whiteFlashes * 2) {
              if ((phase - 9) % 2 == 0) {
                  for (int i = 0; i < 12; i++) pixels.setPixelColor(i, pixels.Color(255, 255, 255));
              }
          }

          pixels.show();

          // ---- Siren control (state change only) ----
          if (!lastBeacon) { // turned ON just now
              Serial.println("[SIREN] Beacon ON -> start siren");
              stopAudio();
              setVolume(sSndVolume);
              playWavFileOnSpeaker("/web/pcm/siren.wav");
              sirenPlaying = true;
          }

          lastBeacon = true;
          return;
      }

      // Beacon just turned off
      if (lastBeacon) {
          Serial.println("[SIREN] Beacon OFF -> stop siren");
          stopAudio();
          sirenPlaying = false;
          lastBeacon = false;
      }

      // ================= Main LED (white) =================
      if (light) {
          for (int i = 0; i < NEO_COUNT; i++)
              pixels.setPixelColor(i, pixels.Color(255, 255, 255));
          pixels.show();
          return;
      }

      // ================= Turn signals =================
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
    pixels.setPin(gpioConfig.ledStrip);
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


//----------------------------------------------------------------------------OLED------------------------------------------------------------------
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

  void showWiFiProgress(int percent) {
    String ipToShow = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : "WiFi";
    display.clearDisplay();
    drawCenteredIP(ipToShow);

    display.setCursor(0, 20);
    display.setTextSize(1);
    display.println("Connecting...");

    display.drawRect(0, 35, 128, 10, SSD1306_WHITE);
    int barWidth = ::map(percent, 0, 100, 0, 124);
    display.fillRect(2, 37, barWidth, 6, SSD1306_WHITE);

    display.display();
  }

  void showCheckmark() {
    display.clearDisplay();
    drawCenteredIP(WiFi.localIP().toString());
    display.setTextSize(2);
    display.setCursor(30, 25);
    display.println("✔");
    display.display();
    delay(800);
  }

  void drawGear(int cx, int cy, int r, int teeth, float angle) {
    float toothWidth = PI / teeth;
    float outerR = r;
    float innerR = r - 3;

    for (int i = 0; i < teeth; i++) {
      float a = angle + i * 2 * PI / teeth;

      float ax = cx + cos(a) * innerR;
      float ay = cy + sin(a) * innerR;
      float bx = cx + cos(a + toothWidth / 2) * outerR;
      float by = cy + sin(a + toothWidth / 2) * outerR;
      float cx2 = cx + cos(a + toothWidth) * innerR;
      float cy2 = cy + sin(a + toothWidth) * innerR;

      // Draw tooth triangle
      display.drawLine(ax, ay, bx, by, SSD1306_WHITE);
      display.drawLine(bx, by, cx2, cy2, SSD1306_WHITE);
    }

    // Optional: draw gear hub
    display.drawCircle(cx, cy, 2, SSD1306_WHITE);
  }

  void drawBatteryBar(int x, int y, int width, int height, int percent, bool charging) {
    percent = constrain(percent, 0, 100);
    // Clear the drawing area (including the tip) before redrawing
    display.fillRect(x, y, width + 3, height, SSD1306_BLACK);

    const bool lowBattery = (percent <= 5);
    static uint32_t lowBlinkLastToggle = 0;
    static bool lowBlinkVisible = true;

    if (lowBattery) {
      uint32_t now = millis();
      if (now - lowBlinkLastToggle >= 400) {
        lowBlinkLastToggle = now;
        lowBlinkVisible = !lowBlinkVisible;
      }
    } else {
      lowBlinkVisible = true;
    }

    if (!lowBlinkVisible) {
      return;  // Skip drawing this frame to create a blink effect
    }

    // Draw battery outline and tip
    display.drawRect(x, y, width, height, SSD1306_WHITE);
    display.fillRect(x + width, y + height / 3, 2, height / 3, SSD1306_WHITE);

    const int innerX = x + 1;
    const int innerWidth = max(1, width - 2);
    const int innerHeight = max(1, height - 2);
    const int segments = 5;

    int baseHeight = innerHeight / segments;
    int remainder = innerHeight % segments;
    int filledSegments = constrain((percent + 19) / 20, 0, segments);
    if (lowBattery) {
      filledSegments = 0;
    }

    int segmentBottom = y + height - 2;
    for (int seg = 0; seg < segments; ++seg) {
      int segHeight = baseHeight + ((seg < remainder) ? 1 : 0);
      int segTop = segmentBottom - segHeight + 1;
      if (segTop < y + 1) segTop = y + 1;

      if (filledSegments > seg) {
        display.fillRect(innerX, segTop, innerWidth, segHeight, SSD1306_WHITE);
      }
      display.drawRect(innerX, segTop, innerWidth, segHeight, SSD1306_WHITE);

      segmentBottom = segTop - 1;
      if (segmentBottom <= y) {
        break;
      }
    }

    if (charging) {
      static bool flash = false;
      flash = !flash;
      if (flash) {
        int boltX = innerX + (innerWidth / 2);
        int boltY = y + 2;
        display.fillRect(boltX - 1, boltY, 3, 5, SSD1306_BLACK);
        display.drawLine(boltX, boltY, boltX + 1, boltY + 2, SSD1306_WHITE);
        display.drawLine(boltX + 1, boltY + 2, boltX - 1, boltY + 2, SSD1306_WHITE);
        display.drawLine(boltX - 1, boltY + 2, boltX, boltY + 4, SSD1306_WHITE);
      }
    }
  }
  void drawWiFiBars(int x, int y, int quality) {
    int levels = ::map(quality, 0, 100, 0, 4); // 0 to 4 bars
    int barWidth = 3, spacing = 2;
    
    for (int i = 0; i < 4; i++) {
      int barHeight = (i + 1) * 4;
      int bx = x + i * (barWidth + spacing);
      int by = y + 16 - barHeight;
      if (i < levels) {
        display.fillRect(bx, by, barWidth, barHeight, SSD1306_WHITE);
      } else {
        display.drawRect(bx, by, barWidth, barHeight, SSD1306_WHITE);
      }
    }
  }

  void drawWebSocketStatus() {
    if (lastWsClientIP != "" && millis() - lastWsConnectTime < 15000) {
      String wsText = "WS: " + lastWsClientIP;
      //playSystemSound("/web/pcm/click.wav");
      display.setTextSize(1);
      display.setTextColor(SSD1306_WHITE);

      int16_t x1, y1;
      uint16_t w, h;
      display.getTextBounds(wsText, 0, 0, &x1, &y1, &w, &h);

      if (w < 128) {
        display.setCursor((128 - w) / 2, 56);  // bottom center
        display.print(wsText);
      } else {
        static int scrollX = 0;
        scrollX = (scrollX + 2) % (w + 128);
        display.setCursor(128 - scrollX, 56);
        display.print(wsText);
      }
    }
  }

  void animateGears() {
    static float angle1 = 0;
    const int r1 = 10, r2 = 15;
    const int teeth1 = 8, teeth2 = 12;
    const int x1 = 50, y1 = 32;
    const int x2 = x1 + r1 + r2 - 1;

    // Load user OLED settings (no SD lock needed here - Preferences is thread-safe)
    String oledLayout = oledPrefs.getString("layout", "default");
    bool showIP       = oledPrefs.getBool("showIP", true);
    bool showBattery  = oledPrefs.getBool("showBattery", true);
    bool showWiFi     = oledPrefs.getBool("showWiFi", true);

    display.clearDisplay();

    // Show IP at top center (if enabled)
    if (showIP) {
      String ipStr = (WiFi.status() == WL_CONNECTED)
                    ? WiFi.localIP().toString()
                    : "WiFi";
      drawCenteredIP(ipStr);
    }

    // AP mode indicator (top-left)
    if (WiFi.getMode() == WIFI_AP && WiFi.status() != WL_CONNECTED) {
      drawAPIndicator(0, 0);
    }

    // Apply layout logic
    if (oledLayout == "default") {
      // Gears + battery + Wi-Fi bars
      if (showBattery)
        drawBatteryBar(0, 20, 8, 24, batteryPercentDisplay, isCharging);

      if (showWiFi)
        drawWiFiBars(110, 20, wifiSignalStrength);

      // Gears animation
      drawGear(x1, y1, r1, teeth1, angle1);
      drawGear(x2, y1, r2, teeth2, -angle1 * ((float)teeth1 / teeth2) + PI / teeth2);
      angle1 += 0.2f;

    } else if (oledLayout == "text") {
      // Just show centered message
      displayMessage("MiniExco", "System Ready", "");

    } else if (oledLayout == "animation") {
      // Try to load a frame from SD and show it
      static int frame = 0;
      char filename[32];
      sprintf(filename, "/oled_anim/frame_%03d.raw", frame);

      {
        SdLock lock; // 🔒 Protect SD access
        File f = SD.open(filename, FILE_READ);
        if (f) {
          // ---- Allocate buffer dynamically in PSRAM if enabled ----
          uint8_t* buffer = nullptr;
          #if USE_PSRAM
            buffer = (uint8_t*)ps_malloc(2048);
          #else
            buffer = (uint8_t*)malloc(1024);
          #endif
          if (buffer) {
            f.read(buffer, 1024);
            f.close();
            display.drawBitmap(0, 0, buffer, 128, 64, SSD1306_WHITE);
            frame = (frame + 1) % TOTAL_OLED_FRAMES;
            free(buffer);  // Always free after use!
          } else {
            displayMessage("⚠️ Animation", "buffer error", "");
            f.close();
          }
        } else {
          displayMessage("⚠️ Animation", "frame missing", "");
        }
      } // 🔓 Lock released here
    }

    drawWebSocketStatus();
    display.display();
  }

  void drawAPIndicator(int x, int y) {
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(x, y);
    display.print("AP");
  }

  void animateAP() {
    static uint8_t phase = 0;
    display.clearDisplay();

    int cx = 20, cy = 32;
    display.fillCircle(cx, cy, 3, SSD1306_WHITE);  // AP center

    for (int i = 0; i < 3; i++) {
      uint8_t r = 8 + i * 6 + (phase % 6) / 2;     // slow ripple
      display.drawCircle(cx, cy, r, SSD1306_WHITE);
    }

    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(50, 28);
    display.print("AP MODE");
    display.display();

    phase++;
  }

//-----------------------------------------------------------------------------I2C------------------------------------------------------------------

  void i2cStart(){

    Wire.begin(gpioConfig.i2cSda, gpioConfig.i2cScl);  // I2C pins
    if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
      DBG_PRINTLN(F("❌ OLED init failed"));
    } else {
      displayMessage("", "🔋 MiniExco Booting", "Please wait");
    }

  }

  bool initBNO055() {
    imuInitAttempted = true;
    Wire.begin(gpioConfig.i2cSda, gpioConfig.i2cScl);
    for (int i = 0; i < 5; ++i) {
      if (bno055.begin()) {
        imuPresent = true;
        bno055.setExtCrystalUse(true);
        return true;
      }
      delay(100);
    }
    imuPresent = false;
    DBG_PRINTLN("❌ BNO055 not detected; continuing without IMU.");
    return false;
  }

  static void ensureImuStartedLazy() {
    if (!imuInitAttempted) {
      initBNO055();
    }
  }

  void spiStart() {
    SPI.begin(gpioConfig.sdSck, gpioConfig.sdMiso, gpioConfig.sdMosi, gpioConfig.sdCs);

    bool ok = false;

    // --- Prefer new-style config if available (Arduino-ESP32 2.x/3.x) ---
    // SDFSConfig lets us set MaxOpenFiles; header is provided by SD.h in new cores.
    #if defined(SDFS_CONFIG_H) || defined(ARDUINO_ESP32_RELEASE_3_0_0) || defined(ARDUINO_ESP32_RELEASE_2_0_0)
    {
      SDFSConfig cfg;
      cfg.setSPI(SPI);
      cfg.setCSPin(gpioConfig.sdCs);
      cfg.setMaxOpenFiles(12);               // lowered to reduce baseline heap
      cfg.setAllocationUnitSize(16 * 1024);  // optional; keeps FAT happy

      ok = SD.begin(cfg);
    }
    #else
    // --- Fallback: older core signature supports max_files as 5th arg ---
    // SD.begin(cs, spi, freq, mountpoint, max_files)
    {
      ok = SD.begin(gpioConfig.sdCs, SPI, 40000000U, "/sd", 12);   // lowered to reduce baseline heap
    }
    #endif

    if (!ok) {
      DBG_PRINTLN("SD Card initialization failed!");
      return;
    }

    DBG_PRINTLN("SD Card initialized.");
    // SD.setTimeCallback(getFatTime); // if you use timestamps

    // Helpers to make dirs safely
    auto ensureDir = [](const char* p) {
      SdLock lock;
      if (!SD.exists(p)) {
        SD.mkdir(p);
        DBG_PRINTF("Created %s folder on SD card.\n", p);
      }
    };

    // Base folders
    ensureDir("/media");
    ensureDir("/web");
    ensureDir("/web/pcm");
    ensureDir("/firmware");
    ensureDir("/telemetry");

    // Media subfolders
    const char* mediaFolders[] = {"/capture", "/wav", "/video", "/mp3", "/anim"};
    for (size_t i = 0; i < sizeof(mediaFolders) / sizeof(mediaFolders[0]); ++i) {
      String sub = String("/media") + mediaFolders[i];
      ensureDir(sub.c_str());
    }
  }

//----------------------------------------------------------------Helpers for webserver file handling-----------------------------------------------

  static String mimeFor(const String& p_) {
    String p = p_;
    if (p.endsWith(".gz")) p.remove(p.length()-3);

    if (p.endsWith(".html")||p.endsWith(".htm")) return "text/html";
    if (p.endsWith(".css"))  return "text/css";
    if (p.endsWith(".js"))   return "application/javascript";
    if (p.endsWith(".json")) return "application/json";
    if (p.endsWith(".svg"))  return "image/svg+xml";
    if (p.endsWith(".png"))  return "image/png";
    if (p.endsWith(".webp")) return "image/webp";
    if (p.endsWith(".avif")) return "image/avif";   // if you try AVIF later
    if (p.endsWith(".jpg")||p.endsWith(".jpeg")) return "image/jpeg";
    if (p.endsWith(".ico"))  return "image/x-icon";
    if (p.endsWith(".csv")||p.endsWith(".txt"))  return "text/plain";
    return "application/octet-stream";
  }

  static void sendStaticFromWeb(AsyncWebServerRequest* req, const String& urlPath) {
    String fsPath = urlPath.startsWith("/web/") ? urlPath : ("/web" + urlPath);
    if (fsPath.endsWith("/")) fsPath += "index.html";

    String real = fsPath;
    { SdLock lk;
      if (!SD.exists(real)) {
        String gz = fsPath + ".gz";
        if (SD.exists(gz)) real = gz;
        else { req->send(404, "text/plain", "File Not Found"); return; }
      }
    }

    String baseMime = mimeFor(fsPath);
    String mime     = real.endsWith(".gz") ? baseMime : mimeFor(real);

    size_t size = 0;
    { SdLock lk; File f = SD.open(real, FILE_READ); if (!f) { req->send(404,"text/plain","File Not Found"); return; } size = f.size(); f.close(); }

    SdGateGuard gate;                                   // <--- serialize whole send
    auto* resp = req->beginResponseStream(mime, size);
    if (real.endsWith(".gz")) { resp->addHeader("Content-Encoding","gzip"); resp->setContentType(baseMime); }
    resp->addHeader("Cache-Control", "public, max-age=86400");

    const size_t BUFSZ = 4096;
    size_t bufSize = BUFSZ;
    uint8_t* buf = nullptr;
  #if USE_PSRAM
    buf = (uint8_t*)ps_malloc(BUFSZ);
  #else
    buf = (uint8_t*)malloc(BUFSZ);
  #endif
    if (!buf) {
      bufSize = 1024;
      buf = (uint8_t*)malloc(bufSize); // fallback path
    }
    if (!buf) {
      req->send(500, "text/plain", "alloc_failed");
      return;
    }
    const size_t readChunk = bufSize;

    File f;
    {
      SdLock lk;
      f = SD.open(real, FILE_READ);
    }
    if (!f) { req->send(404, "text/plain", "File Not Found"); return; }

    while (true) {
      size_t n = 0;
      {
        SdLock lk;
        n = f.read(buf, readChunk);
      }
      if (!n) break;
      if (resp->write(buf, n) != n) break;
      yield();
    }
    {
      SdLock lk;
      f.close();
    }
    free(buf);
    req->send(resp);
  } 


  static void sendFileFromSD(AsyncWebServerRequest* req, const String& path) {
    { SdLock lk; if (!SD.exists(path)) { req->send(404, "text/plain", "File not found"); return; } }
    AsyncWebServerResponse *resp = req->beginResponse(SD, path, mimeFor(path), false);
    if (!resp) { req->send(500, "text/plain", "beginResponse failed"); return; }
    resp->addHeader("Accept-Ranges", "bytes");
    resp->addHeader("Cache-Control", "public, max-age=86400");
    req->send(resp);
  }

  static void sendFileFromSDWithMime(AsyncWebServerRequest* req,
                                    const String& path,
                                    const String& mime,
                                    bool asAttachment = false)
  {
    { SdLock lk; if (!SD.exists(path)) { req->send(404, "text/plain", "File not found"); return; } }
    AsyncWebServerResponse *resp = req->beginResponse(SD, path, mime, asAttachment);
    if (!resp) { req->send(500, "text/plain", "beginResponse failed"); return; }
    resp->addHeader("Cache-Control", "public, max-age=86400");
    if (asAttachment) resp->addHeader("Content-Disposition", "attachment");
    req->send(resp);
  }


//-----------------------------------------------------------------------SD File Management---------------------------------------------------------

  void handleRoot(AsyncWebServerRequest *request) {
    SdLock lock; // 🔒 Protect SD access

    // Try /web/index.html (gz-aware)
    if (sendMaybeGz(request, "/web/index.html")) return;

    // Fallback legacy root
    if (sendMaybeGz(request, "/index.html")) return;

    // List SD card if not found
    String message = "index.html not found on SD card.\n\nFiles on SD card:\n";
    File root = SD.open("/");
    if (root) {
      File file = root.openNextFile();
      while (file) {
        message += String(file.name()) + "\n";
        file = root.openNextFile();
      }
      root.close();
    } else {
      message += "(Failed to open SD root)\n";
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

  void ensureFolderExists(const String& fullPath) {
    int lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash > 0) {
      String folderPath = fullPath.substring(0, lastSlash);
      if (!SD.exists(folderPath)) SD.mkdir(folderPath.c_str());
    }
  }

  static inline bool equalsIgnoreCase(const String& a, const String& b) {
    return a.equalsIgnoreCase(b);
  }

  // ---------------------------------------------------------------------------
  // Offline upload fallback (mirrors Base_v_1024 upload helper)
  // ---------------------------------------------------------------------------
  static const char UPLOAD_FALLBACK_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Offline Upload</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0f1115;color:#f4f4f6;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{max-width:620px;width:100%;background:#161a21;border:1px solid #2f3542;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.45);padding:18px;display:flex;flex-direction:column;gap:12px}
    h1{margin:0;font-size:20px;display:flex;justify-content:space-between;align-items:center;gap:10px}
    p{margin:0;line-height:1.45;color:#cbd5e1}
    .pill{display:inline-block;background:#1d7ffb33;color:#bde0ff;border:1px solid #1d7ffb55;padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px;letter-spacing:0.08em;text-transform:uppercase}
    form{display:flex;flex-direction:column;gap:10px;border:1px dashed #2f3542;border-radius:10px;padding:12px;background:#0c0f14}
    input[type=file]{color:#f4f4f6}
    button{align-self:flex-start;border:1px solid #1d7ffb;background:#1d7ffb;color:#fff;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer}
    button:hover{background:#3693ff}
    .danger{border-color:#d93025;background:#d93025}
    .danger:hover{background:#f04438}
    a{color:#79c0ff}
    .status{font-size:12px;color:#bde0ff}
    .status.error{color:#ffb3b3}
    .list{border:1px solid #2f3542;border-radius:10px;padding:10px;background:#0c0f14;max-height:220px;overflow:auto}
    .item{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid #1f2530;font-size:13px}
    .item:last-child{border-bottom:0}
    .meta{color:#94a3b8;font-size:12px}
    .progress{width:100%;height:10px;border-radius:999px;background:#1f2530;overflow:hidden;border:1px solid #2f3542}
    .bar{height:100%;width:0;background:#22d3ee;transition:width 0.1s linear}
  </style>
</head>
<body>
  <div class="card">
    <div class="pill">Offline fallback &middot; %FIRMWARE_VERSION%</div>
    <h1><span>Upload web assets</span><button type="button" id="refreshBtn">Refresh list</button></h1>
    <p>SD is missing <code>/web/index.html</code> plus its <code>main.css</code> and <code>main.js</code> (optionally gzip). Upload them via the form below or the file manager.</p>
    <p><a href="/recovery">Open recovery browser</a></p>
    <form id="uploadForm">
      <input type="file" id="uploadInput" name="fsFile" multiple required>
      <div class="progress"><div class="bar" id="progressBar"></div></div>
      <div class="status" id="statusMsg">Choose one or more files to upload to /web/.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="submit">Upload to /web/</button>
        <button type="button" class="danger" id="clearBtn">Clear /web/</button>
      </div>
    </form>
    <div class="list" id="list">Loading /web/...</div>
  </div>
  <script>
    const listEl = document.getElementById('list');
    const uploadForm = document.getElementById('uploadForm');
    const uploadInput = document.getElementById('uploadInput');
    const statusMsg = document.getElementById('statusMsg');
    const progressBar = document.getElementById('progressBar');
    const refreshBtn = document.getElementById('refreshBtn');
    const clearBtn = document.getElementById('clearBtn');

    function setStatus(msg, error=false){
      statusMsg.textContent = msg;
      statusMsg.classList.toggle('error', !!error);
    }

    async function fetchWebList(){
      try{
        const resp = await fetch('/fs/list',{cache:'no-store'});
        const data = await resp.json();
        const files = Array.isArray(data.files) ? data.files : [];
        const webItems = files.filter(it=>typeof it.path==='string' && it.path.startsWith('/web/'));
        if (!webItems.length){
          listEl.innerHTML = '<div class="item"><span>No files in /web/.</span></div>';
          return;
        }
        listEl.innerHTML = webItems.map(it=>{
          const size = (Number(it.size)||0);
          const kb = size>=1024 ? (size/1024).toFixed(1)+' KB' : size+' B';
          return `<div class="item"><span>${it.path}</span><span class="meta">${kb}</span></div>`;
        }).join('');
      }catch(err){
        console.error(err);
        listEl.innerHTML = '<div class="item">Unable to load /web/ listing.</div>';
      }
    }

    function resetProgress(){
      if (progressBar) progressBar.style.width = '0%';
    }

    function uploadSingleFile(file){
      return new Promise((resolve,reject)=>{
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/fs/upload?path=/web/', true);
        xhr.upload.addEventListener('progress', (evt)=>{
          if (evt.lengthComputable && progressBar){
            const pct = Math.round((evt.loaded / evt.total) * 100);
            progressBar.style.width = pct+'%';
          }
        });
        xhr.onload = ()=> xhr.status>=200 && xhr.status<300 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText||('HTTP '+xhr.status)));
        xhr.onerror = ()=> reject(new Error('Network error'));
        const formData = new FormData();
        formData.append('fsFile', file, file.name);
        xhr.send(formData);
      });
    }

    uploadForm.addEventListener('submit', async (evt)=>{
      evt.preventDefault();
      const files = uploadInput.files ? Array.from(uploadInput.files) : [];
      if (!files.length){
        setStatus('Select at least one file.', true);
        return;
      }
      uploadForm.querySelector('button[type=submit]').disabled = true;
      try{
        for (let i=0;i<files.length;i++){
          resetProgress();
          setStatus(`Uploading ${files[i].name} (${i+1}/${files.length})...`);
          await uploadSingleFile(files[i]);
        }
        setStatus('Upload complete.');
        resetProgress();
        fetchWebList();
      }catch(err){
        console.error(err);
        setStatus(err && err.message ? err.message : 'Upload failed', true);
      }finally{
        uploadForm.querySelector('button[type=submit]').disabled = false;
      }
    });

    if (refreshBtn){
      refreshBtn.addEventListener('click', fetchWebList);
    }

    if (clearBtn){
      clearBtn.addEventListener('click', async ()=>{
        const confirmed = confirm('Delete all contents of /web/?');
        if (!confirmed) return;
        setStatus('Clearing /web/...'); resetProgress();
        try{
          const body = new URLSearchParams({path:'/web'});
          const resp = await fetch('/fs/delete',{method:'POST', body});
          const text = await resp.text();
          if (!resp.ok) throw new Error(text || 'Delete failed');
          setStatus('Cleared /web/.');
          fetchWebList();
        }catch(err){
          console.error(err);
          setStatus(err && err.message ? err.message : 'Unable to clear /web/', true);
        }
      });
    }

    fetchWebList();
  </script>
</body>
</html>
)rawliteral";

  static const char RECOVERY_BROWSER_HTML[] PROGMEM = R"rawliteral(
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Recovery Browser</title>
  <style>
    :root{--bg:#0f1115;--card:#161a21;--line:#2f3542;--text:#f4f4f6;--muted:#94a3b8;--accent:#1d7ffb;--danger:#d93025}
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:18px}
    .card{max-width:980px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .path{font-family:Consolas,monospace;color:#bde0ff}
    .list{margin-top:10px;border:1px solid var(--line);border-radius:10px;max-height:62vh;overflow:auto}
    .list.drop{border-color:var(--accent);box-shadow:0 0 0 2px #1d7ffb55 inset}
    .drop-hint{margin-top:6px;font-size:12px;color:var(--muted);opacity:.9}
    .it{display:grid;grid-template-columns:28px 1fr 110px 150px;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #202734}
    .it:last-child{border-bottom:0}
    .it .muted{color:var(--muted)}
    button,input{background:#0c0f14;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 10px}
    button{cursor:pointer}
    .a{background:var(--accent);border-color:var(--accent)}
    .d{background:var(--danger);border-color:var(--danger)}
    .ok{color:#92f09f}
    .err{color:#ff9a9a}
  </style>
</head>
<body>
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <strong>Recovery Browser</strong>
      <span>%FIRMWARE_VERSION%</span>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="upBtn">Up</button>
      <button id="refreshBtn">Refresh</button>
      <span class="path" id="pathLbl">/web</span>
    </div>
    <div class="row" style="margin-top:8px">
      <input id="folderName" placeholder="new-folder-name">
      <button id="mkBtn" class="a">Create Folder</button>
      <input id="uploadInput" type="file" multiple>
      <button id="upFileBtn" class="a">Upload</button>
    </div>
    <div id="status" class="muted" style="margin-top:8px">Ready.</div>
    <div id="dropHint" class="drop-hint">Tip: Drag &amp; drop files onto the list below to upload into current folder.</div>
    <div id="list" class="list"></div>
  </div>
  <script>
    let cur = '/web';
    const listEl = document.getElementById('list');
    const statusEl = document.getElementById('status');
    const pathLbl = document.getElementById('pathLbl');
    const dropHintEl = document.getElementById('dropHint');
    const esc = (s)=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const show = (msg, err=false)=>{ statusEl.textContent = msg; statusEl.className = err ? 'err' : 'ok'; };
    const human = (n)=>{ n=Number(n)||0; if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(1)+' MB'; };
    const loadDir = ()=>{
      pathLbl.textContent = cur;
      listEl.innerHTML = '';
      return fetch('/fs/list?dir=' + encodeURIComponent(cur), {cache:'no-store'})
        .then(r => r.json().then(j => ({ r, j })))
        .then(({r, j}) => {
          if (!r.ok || (j && j.ok === false)) throw new Error((j && j.error) || ('HTTP ' + r.status));
          let arr = Array.isArray(j.entries) ? j.entries : [];
          // Compatibility: older /fs/list returns recursive "files" without "entries".
          if (!arr.length && Array.isArray(j.files)) {
            const base = cur.endsWith('/') ? cur : (cur + '/');
            const dirSeen = {};
            arr = [];
            j.files.forEach(f => {
              const p = (f && typeof f.path === 'string') ? f.path : '';
              if (!p.startsWith(base)) return;
              let rel = p.substring(base.length);
              if (!rel) return;
              const slash = rel.indexOf('/');
              if (slash >= 0) {
                const dn = rel.substring(0, slash);
                const full = base + dn;
                if (!dirSeen[full]) {
                  dirSeen[full] = true;
                  arr.push({ name: dn, path: full, isDir: true, size: 0 });
                }
              } else {
                arr.push({ name: rel, path: p, isDir: false, size: Number(f.size) || 0 });
              }
            });
          }
          if (!arr.length){
            listEl.innerHTML = '<div class="it"><div></div><div class="muted">Empty folder</div><div></div><div></div></div>';
            return;
          }
          arr.sort((a,b)=>{
            const ad = !!(a && a.isDir), bd = !!(b && b.isDir);
            if (ad !== bd) return ad ? -1 : 1; // folders first
            const an = String((a && a.name) || '').toLowerCase();
            const bn = String((b && b.name) || '').toLowerCase();
            return an.localeCompare(bn);
          });
          arr.forEach(it => {
            const row = document.createElement('div');
            row.className = 'it';
            const icon = it.isDir ? '&#128193;' : '&#128196;';
            const act = it.isDir
              ? '<button data-open="'+esc(it.path)+'">Open</button> <button class="d" data-del="'+esc(it.path)+'">Delete</button>'
              : '<a href="/fs/download?path='+encodeURIComponent(it.path)+'"><button>Download</button></a> <button class="d" data-del="'+esc(it.path)+'">Delete</button>';
            row.innerHTML = '<div>'+icon+'</div><div>'+esc(it.name)+'</div><div class="muted">'+(it.isDir?'--':human(it.size))+'</div><div>'+act+'</div>';
            listEl.appendChild(row);
          });
        })
        .catch(e => {
          show(e && e.message ? e.message : 'List failed', true);
        });
    }
    const doDelete = (path)=>{
      if (!confirm('Delete ' + path + ' ?')) return;
      const body = new URLSearchParams({path});
      return fetch('/fs/delete', {method:'POST', body})
        .then(r => r.text().then(t => ({ r, t })))
        .then(({r, t}) => {
          if (!r.ok) throw new Error(t || ('HTTP ' + r.status));
          show('Deleted: ' + path);
          return loadDir();
        });
    }
    const doMkdir = ()=>{
      const name = (document.getElementById('folderName').value || '').trim();
      if (!name) return show('Enter folder name', true);
      const p = (cur.endsWith('/') ? cur : cur + '/') + name;
      const body = new URLSearchParams({path:p});
      return fetch('/fs/mkdir', {method:'POST', body})
        .then(r => r.text().then(t => ({ r, t })))
        .then(({r, t}) => {
          if (!r.ok) throw new Error(t || ('HTTP ' + r.status));
          show('Created: ' + p);
          document.getElementById('folderName').value = '';
          return loadDir();
        });
    }
    const uploadFiles = (files)=>{
      if (!files.length) return show('Choose files first', true);
      let chain = Promise.resolve();
      files.forEach((f, i) => {
        chain = chain.then(() => {
          const fd = new FormData();
          fd.append('fsFile', f, f.name);
          const url = '/fs/upload?path=' + encodeURIComponent(cur.endsWith('/') ? cur : (cur + '/'));
          return fetch(url, {method:'POST', body:fd})
            .then(r => r.text().then(t => ({ r, t })))
            .then(({r, t}) => {
              if (!r.ok) throw new Error(t || ('HTTP ' + r.status));
              show('Uploaded ' + f.name + ' (' + (i+1) + '/' + files.length + ')');
            });
        });
      });
      return chain.then(() => loadDir());
    }
    const doUpload = ()=>{
      const files = Array.from(document.getElementById('uploadInput').files || []);
      return uploadFiles(files);
    }
    listEl.addEventListener('click', (e)=>{
      const o = e.target && e.target.getAttribute ? e.target.getAttribute('data-open') : null;
      const d = e.target && e.target.getAttribute ? e.target.getAttribute('data-del') : null;
      if (o){ cur = o; loadDir(); }
      if (d){ doDelete(d).catch(err=>show(err && err.message ? err.message : 'Delete failed', true)); }
    });
    document.getElementById('refreshBtn').onclick = ()=>loadDir();
    document.getElementById('mkBtn').onclick = ()=>doMkdir().catch(err=>show(err && err.message ? err.message : 'Create failed', true));
    document.getElementById('upFileBtn').onclick = ()=>doUpload().catch(err=>show(err && err.message ? err.message : 'Upload failed', true));
    // Drag-and-drop upload directly to current folder.
    ['dragenter','dragover'].forEach(ev => listEl.addEventListener(ev, (e)=>{
      e.preventDefault(); e.stopPropagation();
      listEl.classList.add('drop');
      show('Drop files to upload into ' + cur);
      if (dropHintEl) dropHintEl.textContent = 'Drop now to upload into ' + cur;
    }));
    ['dragleave','dragend'].forEach(ev => listEl.addEventListener(ev, (e)=>{
      e.preventDefault(); e.stopPropagation();
      listEl.classList.remove('drop');
      show('Ready.');
      if (dropHintEl) dropHintEl.textContent = 'Tip: Drag & drop files onto the list below to upload into current folder.';
    }));
    listEl.addEventListener('drop', (e)=>{
      e.preventDefault(); e.stopPropagation();
      listEl.classList.remove('drop');
      if (dropHintEl) dropHintEl.textContent = 'Uploading dropped files...';
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      uploadFiles(files)
        .then(()=>{ if (dropHintEl) dropHintEl.textContent = 'Tip: Drag & drop files onto the list below to upload into current folder.'; })
        .catch(err=>show(err && err.message ? err.message : 'Upload failed', true));
    });
    listEl.addEventListener('mouseenter', ()=>{
      if (!listEl.classList.contains('drop') && dropHintEl) {
        dropHintEl.textContent = 'Drag/drop files here';
      }
    });
    listEl.addEventListener('mouseleave', ()=>{
      if (!listEl.classList.contains('drop') && dropHintEl) {
        dropHintEl.textContent = 'Tip: Drag & drop files onto the list below to upload into current folder.';
      }
    });
    document.getElementById('upBtn').onclick = ()=>{
      let p = String(cur || '/web').replace(/\/+$/,'');
      if (!p.length) p = '/web';
      if (p === '/web') {
        cur = '/';
        loadDir();
        return;
      }
      if (p === '/') { show('Already at root'); return; }
      const i = p.lastIndexOf('/');
      cur = (i <= 0) ? '/' : p.substring(0, i);
      if (!cur.length) cur = '/';
      loadDir();
    };
    loadDir();
  </script>
</body>
</html>
)rawliteral";

  void sendUploadFallbackPage(AsyncWebServerRequest* request) {
    String html = FPSTR(UPLOAD_FALLBACK_HTML);
    html.replace("%FIRMWARE_VERSION%", FIRMWARE_VERSION);
    request->send(200, "text/html", html);
  }

  void sendRecoveryBrowserPage(AsyncWebServerRequest* request) {
    String html = FPSTR(RECOVERY_BROWSER_HTML);
    html.replace("%FIRMWARE_VERSION%", FIRMWARE_VERSION);
    request->send(200, "text/html", html);
  }

  static bool pathUnderWeb(const String& path) {
    String p = path;
    if (!p.startsWith("/")) p = "/" + p;
    return (p == "/web") || p.startsWith("/web/");
  }

  void listSdFilesRecursive(const String& path, JsonArray& out) {
    SdLock lock;
    File dir = SD.open(path);
    if (!dir) return;
    File entry = dir.openNextFile();
    while (entry) {
      String child = entry.name();
      bool isDir = entry.isDirectory();
      uint32_t size = isDir ? 0 : entry.size();
      if (!child.startsWith("/")) {
        if (path == "/") child = "/" + child;
        else child = path + "/" + child;
      }

      JsonObject it = out.createNestedObject();
      it["path"] = child;
      it["size"] = size;

      entry.close();
      if (isDir) {
        listSdFilesRecursive(child, out);
      }
      entry = dir.openNextFile();
    }
    dir.close();
  }

  void listSdDirEntries(const String& path, JsonArray& out) {
    SdLock lock;
    File dir = SD.open(path);
    if (!dir || !dir.isDirectory()) {
      if (dir) dir.close();
      return;
    }
    File entry = dir.openNextFile();
    while (entry) {
      String child = entry.name();
      bool isDir = entry.isDirectory();
      uint32_t size = isDir ? 0 : entry.size();
      if (!child.startsWith("/")) {
        if (path == "/") child = "/" + child;
        else child = path + "/" + child;
      }
      String name = child;
      int slash = name.lastIndexOf('/');
      if (slash >= 0) name = name.substring(slash + 1);

      JsonObject it = out.createNestedObject();
      it["name"] = name;
      it["path"] = child;
      it["isDir"] = isDir;
      it["size"] = size;

      entry.close();
      entry = dir.openNextFile();
    }
    dir.close();
  }

  bool deletePathRecursive(const String& path, bool keepRoot = false) {
    SdLock lock;
    File f = SD.open(path);
    if (!f) return false;
    bool isDir = f.isDirectory();
    f.close();

    if (!isDir) {
      return SD.remove(path);
    }

    File dir = SD.open(path);
    if (!dir) return false;
    File entry = dir.openNextFile();
    while (entry) {
      String child = entry.name();
      if (!child.startsWith("/")) {
        if (path == "/") child = "/" + child;
        else child = path + "/" + child;
      }
      bool childDir = entry.isDirectory();
      entry.close();
      // Recurse into children
      deletePathRecursive(child, false);
      entry = dir.openNextFile();
    }
    dir.close();

    if (keepRoot) return true;
    if (path == "/") return true;
    return SD.rmdir(path);
  }

  struct WebUploadCtx {
    String destPath;
    File file;
    String error;
  };

  void processReindexTask() {
      static File dir, idx;
      static File f;
      static bool init = false;
      static unsigned lastBatch = 0;
      static File tmpDir; // For counting

      if (!pendingReindex) return;

      SdLock lock; // 🔒 All SD access is now thread-safe

      if (!init) {
          // First, count files (async-friendly)
          reindexCounting = true;
          reindexReadyToIndex = false;
          reindexTotal = 0;

          if (tmpDir) tmpDir.close();
          tmpDir = SD.open(reindexPath);
          if (!tmpDir || !tmpDir.isDirectory()) {
              pendingReindex = false;
              DBG_PRINTLN("Failed to open dir for count!");
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
          DBG_PRINTF("Counted %d files for indexing in %s\n", reindexTotal, reindexPath.c_str());
          reindexCounting = false;
          reindexReadyToIndex = true;
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
              DBG_PRINTLN("Failed to start reindex!");
              return;
          }
          f = dir.openNextFile();
          reindexCount = 0;
          reindexReadyToIndex = false; // Reset so doesn't re-enter
          DBG_PRINTF("Begin background indexing for %s\n", reindexPath.c_str());
      }

      if (!dir || !idx) return; // Not ready yet

      const int BATCH_SIZE = 50;
      int batchCount = 0;

      while (f && batchCount < BATCH_SIZE) {
          String name = String(f.name());
          if (name.equalsIgnoreCase("System Volume Information") || name == "Thumbs.db") { 
              f.close(); 
              f = dir.openNextFile(); 
              continue; 
          }
          idx.printf("%s,%d,%u,%lu\n",
                    name.c_str(),
                    f.isDirectory() ? 1 : 0,
                    (unsigned)f.size(),
                    (unsigned long)f.getLastWrite());
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
          DBG_PRINTF("Index for %s finished, %d files\n", reindexPath.c_str(), reindexCount);
      }
  }

  // Utility: read a batch from .index file
  void readSdIndexBatch(const String& idxPath, int start, int count, JsonArray& arr, bool showSystem /*= false*/) {
    if (start < 0) start = 0;
    if (count < 1) count = 1;

    SdLock lock;                              // safe with recursive mutex
    File idx = SD.open(idxPath, FILE_READ);
    if (!idx) return;

    delay(0);                                 // initial yield after open

    int visibleSeen = 0;
    int added   = 0;
    uint32_t tick = 0;
    String line;
    bool isEmptyMarker = false;

    while (idx.available()) {
      line = idx.readStringUntil('\n');
      line.trim();

      if (line == "__EMPTY__") {               // fast exit if index marks empty dir
        isEmptyMarker = true;
        break;
      }

      // --- parse: name,isFolder,size[,date] ---
      int comma1 = line.indexOf(',');
      int comma2 = line.indexOf(',', comma1 + 1);
      int comma3 = line.indexOf(',', comma2 + 1); // optional date

      if (comma1 < 0 || comma2 < 0) {          // malformed line
        if (((++tick) & 0x7F) == 0) delay(0);
        continue;
      }

      String name = line.substring(0, comma1);
      bool isFolder = line.substring(comma1 + 1, comma2).toInt();

      uint32_t size = 0;
      uint32_t date = 0;
      if (comma3 > 0) {
        size = line.substring(comma2 + 1, comma3).toInt();
        date = line.substring(comma3 + 1).toInt();
      } else {
        size = line.substring(comma2 + 1).toInt();
      }

      // --- filters ---
      if (!showSystem && (
          name.endsWith(".path") ||
          name.endsWith(".bak")  ||
          name.endsWith(".meta") ||
          name.startsWith(".")   ||
          name.startsWith(".csv")||
          name.equalsIgnoreCase("System Volume Information") ||
          name.startsWith("FOUND.") ||
          name == "Thumbs.db"
      )) {
        if (((++tick) & 0x7F) == 0) delay(0);
        continue;
      }

      // Pagination must be based on visible entries (after filters), not raw index lines.
      if (visibleSeen++ < start) {
        if (((++tick) & 0x7F) == 0) delay(0);
        continue;
      }

      // Pagination: stop once we've added 'count' items
      if (added >= count) break;

      // Build JSON entry
      JsonObject obj = arr.createNestedObject();
      obj["name"]     = name;
      obj["isFolder"] = isFolder;
      if (!isFolder) obj["size"] = size;
      obj["type"]     = isFolder ? "folder" : "default";
      if (date > 0)   obj["date"] = (uint64_t)date * 1000ULL; // seconds -> ms (avoid 32-bit overflow)

      added++;

      if (((++tick) & 0x7F) == 0) delay(0);     // periodic yield to feed WDT
    }

    idx.close();
    delay(0);                                   // final cooperative yield

    // If __EMPTY__ marker encountered and nothing was added, leave arr empty
    if (isEmptyMarker && arr.size() == 0) {
      // intentionally empty
    }
  }


  // helpers to Fix upload corruption-----

  // ---------- SD helpers ----------
  static String baseName(const String& path) {
    int s = path.lastIndexOf('/'); return (s >= 0) ? path.substring(s + 1) : path;
  }
  static String dirName(const String& path) {
    int s = path.lastIndexOf('/'); return (s >= 0) ? path.substring(0, s) : String("/");
  }
  static String uniqueInDir(const String& dir, const String& wantName) {
    String base = wantName, ext;
    int d = wantName.lastIndexOf('.');
    if (d >= 0) { base = wantName.substring(0, d); ext = wantName.substring(d); }
    String test = dir + "/" + wantName; int n = 1;
    while (SD.exists(test)) test = dir + "/" + base + "_" + String(n++) + ext;
    return test;
  }
  static inline void sdTinyYield(uint32_t ms = 2) {
  #if defined(ESP32)
    vTaskDelay(pdMS_TO_TICKS(ms));
  #else
    delay(ms);
  #endif
  }

  void initSdGate() {
    g_sdStreamGate = xSemaphoreCreateBinary();
    xSemaphoreGive(g_sdStreamGate); // gate is free at boot
  }

  // ---------- HEX helpers ----------
  static String toHexLower(const uint8_t* p, size_t n) {
    static const char* hexd = "0123456789abcdef";
    String s; s.reserve(n*2);
    for (size_t i=0;i<n;i++){ s += hexd[p[i]>>4]; s += hexd[p[i]&0x0F]; }
    return s;
  }
  static String normHex64(String s) { s.trim(); s.toLowerCase(); return s; }

  // ---------- Boot cleanup: delete orphan temp files ----------
  static void removeOrphanTempsInDir(const String& path) {
    File dir; { SdLock lock; dir = SD.open(path); }
    if (!dir) return;

    while (true) {
      File f; { SdLock lock; f = dir.openNextFile(); }
      if (!f) break;

      String name = f.name();
      bool isDir = f.isDirectory();
      f.close();                  // close before any yield

      if (isDir) {
        if (name != "." && name != "..") {
          // Recurse into subdir
          removeOrphanTempsInDir(path + "/" + name);
        }
      } else {
        if (name.endsWith(".upload.tmp")) {
          String doomed = path + "/" + name;
          { SdLock lock; SD.remove(doomed); }   // lock only around SD op
          DBG_PRINTF("[CLEAN] removed orphan temp: %s\n", doomed.c_str());
        }
      }

      // Give the scheduler a breath after each entry (no SD lock held)
  #if defined(ESP32)
      vTaskDelay(1);
  #else
      yield();
  #endif
    }

    dir.close();
  }


  void auditPcmAssets() {
    const char* req[] = {"apaudio.wav","connected.wav"};
    for (auto f : req) {
      String p = String("/web/pcm/") + f;
      if (!SD.exists(p)) {
        String pu = p; pu.replace(".wav",".WAV");
        if (!SD.exists(pu)) DBG_PRINTF("[PCM MISSING] %s (or %s)\n", p.c_str(), pu.c_str());
      }
    }


    if (SD.exists("/web/pcm/apaudio.wav") || SD.exists("/web/pcm/APAUDIO.WAV")) {
      g_apSpeechFile = "/web/pcm/apaudio.wav";
    } else {
      g_apSpeechFile = nullptr;
      DBG_PRINTF("[PCM MISSING] apaudio.wav (or APAUDIO.WAV) not found under /web/pcm\n");
    }
  }

//-------------------------------------------------------------------------System Sound-------------------------------------------------------------

  void playSystemSound(const char* filename) {
      if (!sSndEnabled || !filename || !filename[0]) return;

      // NEW: drop any enqueues while exclusive, except the ones we are explicitly allowing now
      if (ss_exclusive && !ss_allow) return;

      unsigned long now = millis();
      // Ignore if file is same and within debounce period
      if (lastPlayedFile == filename && (now - lastPlayedTime < soundRepeatDelay)) return;

      // If something is playing, enqueue the request if there's space
      if (isSystemSoundPlaying) {
          // Add to queue only if not a duplicate in the queue
          for (uint8_t i = queueHead; i != queueTail; i = (i + 1) % MAX_SYSTEM_SOUND_QUEUE) {
              if (systemSoundQueue[i] == filename) return; // Already in queue
          }
          uint8_t nextTail = (queueTail + 1) % MAX_SYSTEM_SOUND_QUEUE;
          if (nextTail != queueHead) { // Queue not full
              systemSoundQueue[queueTail] = filename;
              queueTail = nextTail;
          }
          return;
      }

      // Not playing, start playing this one
      sSndVolume = constrain(sSndVolume, 0, 21);
      audio.setVolume(sSndVolume);
      isSystemSoundPlaying = true;
      lastPlayedFile = filename;
      lastPlayedTime = now;
      playWavFileOnSpeaker(filename); // This should be non-blocking
  }

  void onSystemSoundFinished() {
    bool shouldLoopSiren = beaconOn && sirenPlaying;

    isSystemSoundPlaying = false;
    sirenPlaying = false;

    // Release exclusive gate held for the beep
    if (g_gateHeldByAudio) {
      g_gateHeldByAudio = false;
      xSemaphoreGive(g_sdStreamGate);
    }

    // Chain next system sound if queued (they’ll preempt again)
    if (queueHead != queueTail) {
      String nextFile = systemSoundQueue[queueHead];
      queueHead = (queueHead + 1) % MAX_SYSTEM_SOUND_QUEUE;
      playSystemSound(nextFile.c_str());
      return;
    }

    if (shouldLoopSiren && sSndEnabled) {
      playSystemSound("/web/pcm/siren.wav");
      if (isSystemSoundPlaying) {
        sirenPlaying = true;
        return;
      }
    }

    // If we paused media to play the system sound, resume it now
    if (g_mediaPausedBySystem) {
      g_mediaPausedBySystem = false;
      resumeAudio();  // your resume starts track from the beginning; acceptable
    }
    if (ss_exclusive && (queueHead == queueTail) && !isSystemSoundPlaying) {
      ss_exclusive = false;
    }

    if (!ss_exclusive) ss_announcedStaIp = false;
    ss_exclusive = false;
  }

  // Speak an IP address by queueing WAV digits + a dot sound
  static inline void _enqueueDigit(char d) {
    String f = "/web/pcm/";
    f += d;
    f += ".wav";
    playSystemSound(f.c_str());
  }

  static inline void _enqueueDot() {
    playSystemSound("/web/pcm/dot.wav");     // add a very short “dot” (or “space.wav” if preferred)
  }

  void speakNumber(uint16_t n) {
    String s = String(n);
    for (uint16_t i = 0; i < s.length(); i++) _enqueueDigit(s[i]);
  }

  void speakIPAddress(const IPAddress& ip) {
    // Temporarily disable de-bounce to allow repeated digits (e.g., "1.wav" twice)
    unsigned long _prevDelay = soundRepeatDelay;
    soundRepeatDelay = 0;

    for (int i = 0; i < 4; i++) {
      speakNumber(ip[i]);   // enqueues each digit of the octet
      if (i < 3) _enqueueDot();
    }

    // Restore original setting
    soundRepeatDelay = _prevDelay;
  }


  inline bool soundIsPlaying() {
    // Treat queue as busy while a system sound is actively playing
    return isSystemSoundPlaying;
  }

  void cancelSystemSoundQueue() {
    if (!isSystemSoundPlaying && queueHead == queueTail) return;
    sirenPlaying = false;

    stopAudio();
    isSystemSoundPlaying = false;
    queueHead = queueTail = 0;
    ss_allow = false;
    ss_apSpeechPending = false;
    ss_staSpeechPending = false;
    ss_announcedStaIp = false;

    if (g_mediaPausedBySystem) {
      g_mediaPausedBySystem = false;
      resumeAudio();
    }

    ss_exclusive = false;
  }

  // Dock-targeted sounds should not re-arm STA chimes; stop playback and clear queue only.
  void stopSystemSoundForDock() {
    if (isSystemSoundPlaying) {
      audio.stopSong();
    }
    sirenPlaying = false;
    isSystemSoundPlaying = false;
    queueHead = queueTail = 0;
  }

  static unsigned long lastDockSoundMs = 0;
  static String lastDockSoundPath = "";

  void scheduleApSpeechSoon(uint32_t delayMs = 700) {
    if (ss_exclusive || ss_apSpeechPending) return;  // NEW: prevent re-arming
    ss_apSpeechPending = true;
    ss_apSpeechAtMs    = millis() + delayMs;
  }

  // Drop-in: no IP announcement, only a short STA chime.
  void speakStaIpOrDefer(const IPAddress& ip) {
    // If IP is invalid, do nothing (no deferral/queueing).
    if (ip == IPAddress(0,0,0,0)) {
      DBG_PRINTLN("[WIFI AUDIO] STA IP is 0.0.0.0; skipping announcement");
      ss_staSpeechPending = false;
      return;
    }

    // If we've already announced this session, skip duplicate chime
    if (ss_announcedStaIp) {
      return;
    }

    // Stop/clear anything pending so no stray digit clips resume.
    // (Both calls are safe no-ops if nothing is playing/queued.)
    if (isSystemSoundPlaying) {
      audio.stopSong();                 // stop current I2S playback (if your helper exists, keep using it)
    }
    cancelSystemSoundQueue();           // clear queued system sounds

    // Play only the STA "connected" chime.
    DBG_PRINTLN("[WIFI AUDIO] Playing STA connect chime (no IP digits)");
    playSystemSound("/web/pcm/connected.wav");

    // Make it idempotent: mark as done; no follow-up speech or queue.
    ss_announcedStaIp = true;
    ss_staSpeechPending = false;

    // Ensure any exclusivity gates aren’t left latched for old flow.
    ss_exclusive = false;
    ss_allow = false;

    // If you previously used a ring buffer for system sounds, make sure pointers are reset
    // (safe if you have these globals; otherwise remove the two lines below).
    queueHead = 0;
    queueTail = 0;
  }


  void pumpSystemSoundScheduler(uint32_t now) {
    // Fire pending AP speech once loop is alive and queue is idle
    if (ss_apSpeechPending && now >= ss_apSpeechAtMs && !isSystemSoundPlaying && !ss_exclusive) {
      ss_exclusive = true;
      ss_allow     = true;
      queueHead = queueTail = 0;

      String apIpStr = WiFi.softAPIP().toString();
      DBG_PRINTF("[WIFI AUDIO] Speaking AP IP %s\n", apIpStr.c_str());

      if (g_apSpeechFile) playSystemSound(g_apSpeechFile);
      else DBG_PRINTLN("[PCM INFO] AP speech sound unavailable; skipping clip");

      unsigned long _prevDelay = soundRepeatDelay; 
      soundRepeatDelay = 0;
      speakIPAddress(WiFi.softAPIP());
      soundRepeatDelay = _prevDelay;

      ss_allow = false;
      ss_apSpeechPending = false;
    }

    // Fire deferred STA speech when queue is idle
    if (ss_staSpeechPending) {
      if (!isSystemSoundPlaying && !ss_exclusive) {
        ss_exclusive = true;
        ss_allow     = true;
        queueHead = queueTail = 0;

        String staIpStr = ss_staIpToSpeak.toString();
        DBG_PRINTF("[WIFI AUDIO] Playing STA connect clip via scheduler for %s\n", staIpStr.c_str());

        playSystemSound("/web/pcm/connected.wav");

        unsigned long _prevDelay = soundRepeatDelay; 
        soundRepeatDelay = 0;
        speakIPAddress(ss_staIpToSpeak);
        soundRepeatDelay = _prevDelay;

        ss_announcedStaIp = true;
        ss_allow = false;
        ss_staSpeechPending = false;
      } else {
        static uint32_t lastStaWaitLog = 0;
        if (now - lastStaWaitLog >= 1000) {
          DBG_PRINTF("[WIFI AUDIO] STA speech waiting (playing=%d, exclusive=%d)\n", isSystemSoundPlaying, ss_exclusive);
          lastStaWaitLog = now;
        }
      }
    }
  }



//----------------------------------------------------------------------WiFi Stack Management-------------------------------------------------------


  static uint8_t  consecStaDrops = 0;
  static uint32_t lastDropMs     = 0;

  static void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
      case ARDUINO_EVENT_WIFI_STA_CONNECTED:
        Serial.printf("[WiFi] CONNECTED (ch=%d)\n", info.wifi_sta_connected.channel);
        break;

      case ARDUINO_EVENT_WIFI_STA_GOT_IP:
        Serial.printf("[WiFi] GOT_IP %s\n", WiFi.localIP().toString().c_str());
        // link healthy again → clear all drop/escalation state
        consecStaDrops = 0;
        lastDropMs     = 0;
        resetNetRecovery();
        if (!otaInitialized) { otaUpdate(); otaInitialized = true; }
        mqttBegin();
        break;

      case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
        const uint32_t now    = millis();
        const uint8_t  reason = info.wifi_sta_disconnected.reason;
        Serial.printf("[WiFi] DISCONNECTED reason=%u\n", reason);

        // count quick, back-to-back drops (within 20s)
        consecStaDrops = (now - lastDropMs < 20000UL) ? consecStaDrops + 1 : 1;
        lastDropMs     = now;

        // first response: gentle, non-destructive
        WiFi.reconnect();
        mqttDisconnect();

        // 3 quick drops → refresh just the web stack
        if (consecStaDrops == 3) {
          Serial.println("[WiFi] Repeated drops → refreshing web stack");
          webServerReboot();
          // don't resetNetRecovery() here; let the loop do it once health returns
        }

        // 5+ quick drops → soft STA kick without nuking BT/coex
        if (consecStaDrops >= 5) {
          Serial.println("[WiFi] Many drops → soft STA refresh");
          WiFi.disconnect(false /*erase creds*/, false /*turn off*/);
          delay(50);
          WiFi.reconnect();
          consecStaDrops = 0;
        }
        break;
      }

      case ARDUINO_EVENT_WIFI_AP_STACONNECTED:
        Serial.println("[AP] STA joined");
        // AP lobby is serving → treat as healthy; clear escalation
        resetNetRecovery();
        break;

      case ARDUINO_EVENT_WIFI_AP_STADISCONNECTED:
        Serial.println("[AP] STA left");
        break;

      default:
        break;
    }
  }


  void WIFI_LOG_MODE(wifi_mode_t t, const char* where){
    Serial.printf("[WIFI] mode(%d) at %s (cur=%d) t=%lu\n", (int)t, where, (int)WiFi.getMode(), millis());
    if (WiFi.getMode()!=t) WiFi.mode(t);
  }
  void WIFI_LOG_DISC(bool erase, bool off, const char* where){
    Serial.printf("[WIFI] disconnect(erase=%d, off=%d) at %s t=%lu\n",
                  erase, off, where, millis());
    WiFi.disconnect(erase, off);
  }

  static void startApLobby() {
    // AP+STA so UI stays reachable while we hunt for Wi-Fi
    if (WiFi.getMode() != WIFI_AP_STA) WiFi.mode(WIFI_AP_STA);

    if (g_apPassword.length() >= 8 && g_apPassword.length() <= 63)
      WiFi.softAP(getS3Id().c_str(), g_apPassword.c_str());
    else
      WiFi.softAP(getS3Id().c_str());

    applyWifiPowerPolicy(bluepadEnabled);



    showWiFiStep(String("AP:\n") + WiFi.softAPIP().toString());
    wifiState = WIFI_AP_LOBBY;
    ss_announcedStaIp = false;
    wifiLastScanAt = 0;          // force immediate scan
    currentCandidateIndex = -1;  // restart candidate iteration
  }

  static void stopApIfRunning() {
    if (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
      WiFi.softAPdisconnect(true);
    }
  }

  static void switchToStaOnly() {
    stopApIfRunning();
    if (WiFi.getMode() != WIFI_STA) WiFi.mode(WIFI_STA);
    esp_wifi_set_inactive_time(WIFI_IF_STA, 30);
    applyWifiPowerPolicy(bluepadEnabled);  // respects Bluepad32 preference

  }

  static bool hasAnySavedNetworks() {
    String list = wifiPrefs.getString("networks", "");
    if (list.length()) {
      for (int i = 0; i < (int)list.length(); ++i) {
        char c = list[i];
        if (c != ',' && c != ' ' && c != '\t' && c != '\r' && c != '\n') return true;
      }
    }
    if (wifiPrefs.getString("preferred_ssid", "").length()) return true;
    return false;
  }

  // Build the ordered list: preferred first (deduped), then others
  static void loadOrderedSavedList(std::vector<String>& ssidsOut) {
    ssidsOut.clear();
    ssidsOut.reserve(8);  // small hint to reduce realloc churn
    // preferred first
    String pref = normalizedSSID(wifiPrefs.getString("preferred_ssid", ""));
    if (pref.length()) ssidsOut.push_back(pref);

    // then the rest (dedup)
    String list = wifiPrefs.getString("networks", "");
    int last = 0;
    while (true) {
      int next = list.indexOf(',', last);
      String item = normalizedSSID((next == -1) ? list.substring(last) : list.substring(last, next));
      if (item.length()) {
        bool dup = false;
        for (auto &s : ssidsOut) { if (s == item) { dup = true; break; } }
        if (!dup) ssidsOut.push_back(item);
      }
      if (next == -1) break;
      last = next + 1;
    }
  }

  static void beginConnectTo(const String& ssid) {
    String pass = wifiPrefs.getString(("wifi_" + ssid).c_str(), "");
    bool aRt    = wifiPrefs.getBool(("aRt_"  + ssid).c_str(), true);
    if (!aRt) return; // skip SSIDs user disabled

    // keep AP up while we attempt (we are in AP_LOBBY)
    if (WiFi.getMode() != WIFI_AP_STA) WiFi.mode(WIFI_AP_STA);

    showWiFiStep("Connecting:\n" + ssid);
    wifiSSID = ssid;
    wifiPassword = pass;
    WiFi.disconnect(true, false);     // clean slate, keep radio on
    delay(50);
    WiFi.begin(ssid.c_str(), pass.c_str());
    wifiConnectSince = millis();
    wifiState = WIFI_STA_WAIT;
  }

  void handleWifiSimple() {
    // 1) If we are connected, ensure STA-only and monitor for drop
    if (WiFi.status() == WL_CONNECTED) {
      if (wifiState != WIFI_STA_OK) {
        switchToStaOnly();

        IPAddress staIp = WiFi.localIP();
        if (staIp == IPAddress(0,0,0,0)) {
          return; // wait for DHCP to provide a real address
        }

        showWiFiStep("Connected:\n" + staIp.toString(), true);
        ss_apSpeechPending = false;
        speakStaIpOrDefer(staIp);
        wifiState = WIFI_STA_OK;
      }
      return; // nothing else to do while happily connected
    }

    // 2) Not connected → ensure AP lobby is running
    if (wifiState == WIFI_STA_OK && WiFi.status() != WL_CONNECTED) {
      // lost link → go back to AP lobby and retry forever
      ss_announcedStaIp = false;
      startApLobby();
    }

    if (wifiState == WIFI_AP_LOBBY) {
      // No saved networks? Just stay AP.
      if (!hasAnySavedNetworks()) return;

      // Periodic async scan
      if (millis() - wifiLastScanAt >= SCAN_PERIOD_MS || wifiLastScanAt == 0) {
        wifiLastScanAt = millis();
        showWiFiStep("Scanning for\nknown Wi-Fi...");
        WiFi.scanDelete();
        WiFi.scanNetworks(true); // async
        return;
      }

      int sc = WiFi.scanComplete();
      if (sc >= 0) {
        // Build candidate list once per scan
        std::vector<String> ssids;
        ssids.reserve(10);
        loadOrderedSavedList(ssids);

        // Iterate candidates, pick the first present in results
        for (size_t i = 0; i < ssids.size(); ++i) {
          String s = ssids[i];
          bool present = false;
          for (int j = 0; j < sc; ++j) if (WiFi.SSID(j) == s) { present = true; break; }
          if (present) {
            beginConnectTo(s);
            WiFi.scanDelete();
            return;
          }
        }
        // Nothing found in this scan; keep AP and wait for next period
        WiFi.scanDelete();
        showWiFiStep("No known Wi-Fi\nStill in AP");
      }
      // sc == -1 → scan running; sc == -2 → none yet (next tick will start)
      return;
    }

    if (wifiState == WIFI_STA_WAIT) {
      // wait for connect or timeout
      if (WiFi.status() == WL_CONNECTED) {
        // the connected branch at top will handle transition next tick
        return;
      }
      if (millis() - wifiConnectSince >= CONNECT_TIMEOUT) {
        // timeout → back to lobby (AP kept running the whole time)
        wifiState = WIFI_AP_LOBBY;
        showWiFiStep("Timeout.\nBack to AP");
      }
      return;
    }
  }

  // 👇 Helper: Stop server + WebSocket cleanly before Wi-Fi switch
  void stopWebServerAndWS() {
      wsCarInput.closeAll();  // Close all websocket clients
      server.end();           // Fully stop the HTTP server
      DBG_PRINTLN("✅ WebServer + WebSocket stopped.");
  }

  void webServerReboot() {
      Serial.println("[WebServer] Forcibly restarting AsyncWebServer stack...");

      // If server was never started yet, boot lobby normally.
      if (!lobbyServerStarted) {
        startLobbyServer();
        Serial.println("[WebServer] Lobby server started.");
        return;
      }

      // Do not re-run route registration here; just bounce the active server.
      wsCarInput.closeAll();
      server.end();
      delay(100);
      server.begin();
      Serial.println("[WebServer] AsyncWebServer stack restarted.");
  }

  bool connectToWiFiWithRetries(const String& ssid, const String& password, int retries) {

    wifi_mode_t m = WiFi.getMode();
    if (m != WIFI_STA){
      //WiFi.mode(WIFI_STA);

      WIFI_LOG_MODE(WIFI_STA, "site2880");
    } 

    WiFi.begin(ssid.c_str(), password.c_str());

    for (int attempt = 1; attempt <= retries; attempt++) {
      int progress = ::map(attempt - 1, 0, retries, 0, 100);
      showWiFiProgress(progress);

      DBG_PRINTF("🔁 Attempt %d to connect to WiFi SSID: %s\n", attempt, ssid.c_str());
      unsigned long startAttemptTime = millis();

      // Keep attempt short; yield often
      while (millis() - startAttemptTime < 1200) {
        if (WiFi.status() == WL_CONNECTED) {
          DBG_PRINTLN("✅ Connected to WiFi!");
          displayMessage("", "✅ WiFi Connected\n" + WiFi.localIP().toString());
          delay(120);
          showCheckmark();
          return true;
        }
        delay(100);
        yield();
      }

      // Prepare next try
      WIFI_LOG_DISC(true, false, "site2866");
      delay(80);
      WiFi.begin(ssid.c_str(), password.c_str());
    }

    DBG_PRINTLN("❌ Failed to connect after retries.");
    return false;
  }

  void handleWiFiSetup(AsyncWebServerRequest *request) {
    if (SD.exists("/WiFiPages.html")) {
      sendFileFromSDWithMime(request, "/WiFiPages.html", "text/html");
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
        sendFileFromSDWithMime(request, "/wifi_success.html", "text/html");
      } else {
        request->send(200, "text/html",
          "<html><body><h1>✅ Wi-Fi Credentials Saved</h1><p>Rebooting and trying to connect...</p></body></html>");
      }

      delay(3000);
      ESP.restart();   // ← Optional: remove if you want to stay up and let the loop connect
    } else {
      request->send(400, "text/html", "<html><body><h1>Missing SSID or Password</h1></body></html>");
    }
  }

//---------------------------------------------------------------------AP Password Function---------------------------------------------------------

  bool setApPassword(const String& pw) {
    if (pw.length() && (pw.length() < 8 || pw.length() > 63)) return false; // reject invalid
    g_apPassword = pw;                                   // allow empty to make AP open
    uiPrefs.putString("ap_pass", g_apPassword);          // persist
    return true;
  }


//------------------------------------------------------------------------Robot Controls------------------------------------------------------------

  void rightMotorForward(uint8_t pwm = 255) {
    ledcWrite(CH_RIGHT_MOTOR_IN1, pwm);
    ledcWrite(CH_RIGHT_MOTOR_IN2, 0);
  }
  void rightMotorBackward(uint8_t pwm = 255) {
    ledcWrite(CH_RIGHT_MOTOR_IN1, 0);
    ledcWrite(CH_RIGHT_MOTOR_IN2, pwm);
  }
  void rightMotorStop() {
    ledcWrite(CH_RIGHT_MOTOR_IN1, 0);
    ledcWrite(CH_RIGHT_MOTOR_IN2, 0);
  }
  void leftMotorForward(uint8_t pwm = 255) {
    ledcWrite(CH_LEFT_MOTOR_IN1, pwm);
    ledcWrite(CH_LEFT_MOTOR_IN2, 0);
  }
  void leftMotorBackward(uint8_t pwm = 255) {
    ledcWrite(CH_LEFT_MOTOR_IN1, 0);
    ledcWrite(CH_LEFT_MOTOR_IN2, pwm);
  }
  void leftMotorStop() {
    ledcWrite(CH_LEFT_MOTOR_IN1, 0);
    ledcWrite(CH_LEFT_MOTOR_IN2, 0);
  }
  static int armCurrentPwm = 0;
  static bool armManualOverride = false;

  static void armMotorApplyRaw(int pwm) {
    pwm = constrain(pwm, -255, 255);
    if (pwm == armCurrentPwm) return;

    if (pwm == 0) {
      ledcWrite(CH_ARM_MOTOR_IN1, 0);
      ledcWrite(CH_ARM_MOTOR_IN2, 0);
    } else if (pwm > 0) {
      ledcWrite(CH_ARM_MOTOR_IN2, 0);
      ledcWrite(CH_ARM_MOTOR_IN1, pwm);
    } else {
      ledcWrite(CH_ARM_MOTOR_IN1, 0);
      ledcWrite(CH_ARM_MOTOR_IN2, -pwm);
    }
    armCurrentPwm = pwm;
  }

  void armMotorManual(int pwm) {
    pwm = constrain(pwm, -255, 255);
    armManualOverride = (pwm != 0);
    armMotorApplyRaw(pwm);
  }

  void armMotorUp(uint8_t pwm = 255) {
    armManualOverride = false;
    armMotorApplyRaw(constrain((int)pwm, 0, 255));
  }
  void armMotorDown(uint8_t pwm = 255) {
    armManualOverride = false;
    armMotorApplyRaw(-constrain((int)pwm, 0, 255));
  }
  void armMotorStop() {
    armManualOverride = false;
    armMotorApplyRaw(0);
  }

  void moveCar(int inputValue, int pwm = 255) {
    if (!horScreen) { // Normal orientation
      switch (inputValue) {
        case UP:
          rightMotorForward(pwm);
          leftMotorForward(pwm);
          break;
        case DOWN:
          rightMotorBackward(pwm);
          leftMotorBackward(pwm);
          break;
        case LEFT:
          rightMotorForward(pwm);
          leftMotorBackward(pwm);
          break;
        case RIGHT:
          rightMotorBackward(pwm);
          leftMotorForward(pwm);
          break;
        case STOP:
          rightMotorStop();
          leftMotorStop();
          if (!armManualOverride) armMotorStop();
          break;
        case ARMUP:
          armMotorUp(pwm);
          break;
        case ARMDOWN:
          armMotorDown(pwm);
          break;
        default:
          rightMotorStop();
          leftMotorStop();
          if (!armManualOverride) armMotorStop();
          break;
      }
    } else { // Horizontal/rotated screen (swap both axes!)
      switch (inputValue) {
        case UP:      // Rotate UP -> RIGHT
          rightMotorBackward(pwm);
          leftMotorForward(pwm);
          break;
        case DOWN:    // Rotate DOWN -> LEFT
          rightMotorForward(pwm);
          leftMotorBackward(pwm);
          break;
        case LEFT:    // Rotate LEFT -> DOWN
          rightMotorBackward(pwm);
          leftMotorBackward(pwm);
          break;
        case RIGHT:   // Rotate RIGHT -> UP
          rightMotorForward(pwm);
          leftMotorForward(pwm);
          break;
        case STOP:
          rightMotorStop();
          leftMotorStop();
          if (!armManualOverride) armMotorStop();
          break;
        case ARMUP:
          armMotorUp(pwm);
          break;
        case ARMDOWN:
          armMotorDown(pwm);
          break;
        default:
          rightMotorStop();
          leftMotorStop();
          if (!armManualOverride) armMotorStop();
          break;
      }
    }
  }

  void writeServo(ledc_channel_t channel, int angle) {
    angle = constrain(angle, 0, 180);
    int pulse_us = ::map(angle, 0, 180, 500, 2500);
    uint32_t duty = ((uint64_t)pulse_us << PWM_RES_BITS) / PWM_PERIOD_US;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, channel, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, channel);
  }

  static bool isMotorPwmPin(int16_t pin) {
    if (pin < 0) return false;
    return pin == gpioConfig.rightMotorIn1 ||
           pin == gpioConfig.rightMotorIn2 ||
           pin == gpioConfig.leftMotorIn1  ||
           pin == gpioConfig.leftMotorIn2  ||
           pin == gpioConfig.armMotorIn1   ||
           pin == gpioConfig.armMotorIn2;
  }

  static void detachBucketServoNow() {
    if (!bucketAttached) return;
    ledc_stop(LEDC_LOW_SPEED_MODE, (ledc_channel_t)CH_BUCKET_SERVO, 0);
    if (gpioConfig.bucketServo >= 0) pinMode(gpioConfig.bucketServo, INPUT);
    bucketAttached = false;
    bucketDetachTime = 0;
  }

  static void detachAuxServoNow() {
    if (!auxAttached) return;
    ledc_stop(LEDC_LOW_SPEED_MODE, (ledc_channel_t)CH_AUX_SERVO, 0);
    if (gpioConfig.auxServo >= 0) pinMode(gpioConfig.auxServo, INPUT);
    auxAttached = false;
    auxDetachTime = 0;
  }

  static void runServoAutoDetach(uint32_t nowMs) {
    if (!holdBucket && bucketAttached && bucketDetachTime > 0 &&
        (int32_t)(nowMs - bucketDetachTime) >= 0) {
      detachBucketServoNow();
    }
    if (!holdAux && auxAttached && auxDetachTime > 0 &&
        (int32_t)(nowMs - auxDetachTime) >= 0) {
      detachAuxServoNow();
    }
  }

  void bucketTilt(int bucketServoValue) {
    if (gpioConfig.bucketServo < 0) {
      DBG_PRINTLN("Bucket servo GPIO disabled");
      return;
    }
    if (isMotorPwmPin(gpioConfig.bucketServo)) {
      DBG_PRINTF("Bucket servo GPIO %d conflicts with motor GPIO; ignoring bucket command\n", gpioConfig.bucketServo);
      return;
    }
    if (gpioConfig.auxServo >= 0 && gpioConfig.bucketServo == gpioConfig.auxServo) {
      DBG_PRINTF("Bucket servo GPIO %d conflicts with aux servo GPIO; ignoring bucket command\n", gpioConfig.bucketServo);
      return;
    }
    if (!bucketAttached) {
      // Use low-speed timer explicitly
      ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_14_BIT,
        // Keep both servos on TIMER_3 so motor timers (incl. arm CH4/CH5) are not disturbed.
        .timer_num = LEDC_TIMER_3,
        .freq_hz = 50,
        .clk_cfg = LEDC_AUTO_CLK
      };

      ledc_timer_config(&timer);

      ledc_channel_config_t ch = {
        .gpio_num = gpioConfig.bucketServo,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = (ledc_channel_t)CH_BUCKET_SERVO,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_3,
        .duty = 0,
        .hpoint = 0
      };
      ledc_channel_config(&ch);
      bucketAttached = true;
      DBG_PRINTLN("Bucket PWM configured (low-speed)");
    }

    writeServo((ledc_channel_t)CH_BUCKET_SERVO, bucketServoValue);

    lastBucketValue = bucketServoValue;
    preferences.putInt("bucketAngle", lastBucketValue);
    if (!holdBucket) bucketDetachTime = millis() + 300;
  }

  void auxControl(int auxServoValue) {
    if (gpioConfig.auxServo < 0) {
      DBG_PRINTLN("Aux servo GPIO disabled");
      return;
    }
    if (isMotorPwmPin(gpioConfig.auxServo)) {
      DBG_PRINTF("Aux servo GPIO %d conflicts with motor GPIO; ignoring aux command\n", gpioConfig.auxServo);
      return;
    }
    if (gpioConfig.bucketServo >= 0 && gpioConfig.auxServo == gpioConfig.bucketServo) {
      DBG_PRINTF("Aux servo GPIO %d conflicts with bucket servo GPIO; ignoring aux command\n", gpioConfig.auxServo);
      return;
    }
    if (!auxAttached) {
      ledc_timer_config_t timer = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_14_BIT,
        .timer_num = LEDC_TIMER_3,
        .freq_hz = 50,
        .clk_cfg = LEDC_AUTO_CLK
      };

      ledc_timer_config(&timer);

      ledc_channel_config_t ch = {
        .gpio_num = gpioConfig.auxServo,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = (ledc_channel_t)CH_AUX_SERVO,
        .intr_type = LEDC_INTR_DISABLE,
        .timer_sel = LEDC_TIMER_3,  // shared 50Hz servo timer
        .duty = 0,
        .hpoint = 0
      };
      ledc_channel_config(&ch);
      auxAttached = true;
      DBG_PRINTLN("Aux PWM configured (low-speed)");
    }

    writeServo((ledc_channel_t)CH_AUX_SERVO, auxServoValue);

    lastAuxValue = auxServoValue;
    preferences.putInt("auxAngle", lastAuxValue);
    if (!holdAux) auxDetachTime = millis() + 300;
  }


  static void reconfigureMotorPins(const GpioConfig& current, const GpioConfig& previous) {
    auto detachPin = [](int16_t pin) {
      if (pin >= 0) {
        ledcDetachPin(pin);
        pinMode(pin, INPUT);
      }
    };

    auto attachPin = [](int channel, int16_t pin) {
      if (pin >= 0) {
        pinMode(pin, OUTPUT);
        ledcAttachPin(pin, channel);
        ledcWrite(channel, 0);
        digitalWrite(pin, LOW);
      } else {
        ledcWrite(channel, 0);
      }
    };

    if (gpioPinsInitialized) {
      if (previous.rightMotorIn1 != current.rightMotorIn1) detachPin(previous.rightMotorIn1);
      if (previous.rightMotorIn2 != current.rightMotorIn2) detachPin(previous.rightMotorIn2);
      if (previous.leftMotorIn1  != current.leftMotorIn1)  detachPin(previous.leftMotorIn1);
      if (previous.leftMotorIn2  != current.leftMotorIn2)  detachPin(previous.leftMotorIn2);
      if (previous.armMotorIn1   != current.armMotorIn1)   detachPin(previous.armMotorIn1);
      if (previous.armMotorIn2   != current.armMotorIn2)   detachPin(previous.armMotorIn2);
    }

    attachPin(CH_RIGHT_MOTOR_IN1, current.rightMotorIn1);
    attachPin(CH_RIGHT_MOTOR_IN2, current.rightMotorIn2);
    attachPin(CH_LEFT_MOTOR_IN1,  current.leftMotorIn1);
    attachPin(CH_LEFT_MOTOR_IN2,  current.leftMotorIn2);
    attachPin(CH_ARM_MOTOR_IN1,   current.armMotorIn1);
    attachPin(CH_ARM_MOTOR_IN2,   current.armMotorIn2);
  }

  static void applyGpioConfig(bool initial) {
    const int pwmFreq = 1000;
    const int pwmRes  = 8;

    if (initial || !gpioPinsInitialized) {
      ledcSetup(CH_RIGHT_MOTOR_IN1, pwmFreq, pwmRes);
      ledcSetup(CH_RIGHT_MOTOR_IN2, pwmFreq, pwmRes);
      ledcSetup(CH_LEFT_MOTOR_IN1,  pwmFreq, pwmRes);
      ledcSetup(CH_LEFT_MOTOR_IN2,  pwmFreq, pwmRes);
      ledcSetup(CH_ARM_MOTOR_IN1,   pwmFreq, pwmRes);
      ledcSetup(CH_ARM_MOTOR_IN2,   pwmFreq, pwmRes);
    }

    GpioConfig previous = lastAppliedGpioConfig;
    reconfigureMotorPins(gpioConfig, previous);

    if (previous.bucketServo != gpioConfig.bucketServo) {
      if (previous.bucketServo >= 0) {
        ledc_stop(LEDC_LOW_SPEED_MODE, (ledc_channel_t)CH_BUCKET_SERVO, 0);
        pinMode(previous.bucketServo, INPUT);
      }
      bucketAttached = false;
      bucketDetachTime = 0;
    }
    if (previous.auxServo != gpioConfig.auxServo) {
      if (previous.auxServo >= 0) {
        ledc_stop(LEDC_LOW_SPEED_MODE, (ledc_channel_t)CH_AUX_SERVO, 0);
        pinMode(previous.auxServo, INPUT);
      }
      auxAttached = false;
      auxDetachTime = 0;
    }

    lastAppliedGpioConfig = gpioConfig;
    gpioPinsInitialized = true;

    pixelStart();
  }


  void controlMotorByDirection(const std::string& dir, int speed) {
    // Normalize speed
    int pwm = constrain(abs(speed), 0, 255);

    // Handle stopping
    if (pwm == 0) {
      if (dir == "Arm" || dir == "ArmUp" || dir == "ArmDown") {
        armMotorManual(0);
      } else {
        rightMotorStop();
        leftMotorStop();
      }
      return;
    }

    // Drive logic
    if (dir == "Forward") {
      rightMotorForward(pwm);
      leftMotorForward(pwm);

    } else if (dir == "Backward") {
      rightMotorBackward(pwm);
      leftMotorBackward(pwm);

    } else if (dir == "Left") {
      rightMotorForward(pwm);
      leftMotorBackward(pwm);

    } else if (dir == "Right") {
      rightMotorBackward(pwm);
      leftMotorForward(pwm);

    } else if (dir == "Arm") {
      if (speed == 0) {
        armMotorManual(0);
      } else if (speed > 0) {
        armMotorManual(pwm);
      } else {
        armMotorManual(-pwm);
      }
    } else if (dir == "ArmUp") {
      armMotorUp(pwm);
    } else if (dir == "ArmDown") {
      armMotorDown(pwm);
    }
  }

  void lightControl() {
    if (!light) {
      //digitalWrite(lightPin1, HIGH);
      //digitalWrite(lightPin2, LOW);
      light = true;
      DBG_PRINTLN("Lights ON");
      playSystemSound("/web/pcm/hit.wav");
    } else {
      //digitalWrite(lightPin1, LOW);
      //digitalWrite(lightPin2, LOW);
      light = false;
      DBG_PRINTLN("Lights OFF");
      playSystemSound("/web/pcm/click.wav");
    }
  }

  static void sendWsInitSnapshot(AsyncWebSocketClient* client) {
  // Root: {"t":"init","state":{...},"sliders":{...}}
  // Capacity calc: root obj + state + sliders + headroom
  StaticJsonDocument<
    JSON_OBJECT_SIZE(3) + JSON_OBJECT_SIZE(52) + JSON_OBJECT_SIZE(6) + 300
  > doc;

  doc["t"] = "init";

  JsonObject st = doc.createNestedObject("state");
  st["HoldBucket"]     = holdBucket ? 1 : 0;
  st["HoldAux"]        = holdAux ? 1 : 0;
  st["Switch"]         = horScreen ? 1 : 0;
  st["DarkMode"]       = darkMode ? 1 : 0;
  st["RecordTelemetry"]= tlmEnabled ? 1 : 0;
  st["SystemSounds"]   = sSndEnabled ? 1 : 0;
  st["WsRebootOnDisconnect"] = wsRebootOnDisconnect ? 1 : 0;
  st["GamepadEnabled"] = bluepadEnabled ? 1 : 0;
  st["SystemVolume"]   = sSndVolume;
  st["ModelRotX"]      = modelRotXDeg;
  st["ModelRotY"]      = modelRotYDeg;
  st["ModelRotZ"]      = modelRotZDeg;
  st["ModelDirX"]      = modelDirX;
  st["ModelDirY"]      = modelDirY;
  st["ModelDirZ"]      = modelDirZ;
  st["ModelAxisX"]     = modelAxisX;
  st["ModelAxisY"]     = modelAxisY;
  st["ModelAxisZ"]     = modelAxisZ;
  st["TelemetryMaxKB"] = telemetryFileMaxKB;
  st["SerialLogRateMs"] = serialLogWsMinIntervalMs;
  st["SerialLogKeepLines"] = serialLogRetainLines;
  st["IndicatorsVisible"] = indicatorsVisible ? 1 : 0;
  st["IndicatorsX"]     = indicatorsPosX;
  st["IndicatorsY"]     = indicatorsPosY;
  st["ImuVisible"]      = imuVisible ? 1 : 0;
  st["ImuX"]            = imuPosX;
  st["ImuY"]            = imuPosY;
  st["MediaVisible"]    = mediaVisible ? 1 : 0;
  st["MediaX"]          = mediaPosX;
  st["MediaY"]          = mediaPosY;
  st["PathVisible"]     = pathVisible ? 1 : 0;
  st["PathX"]           = pathPosX;
  st["PathY"]           = pathPosY;
  st["Model3DVisible"]  = model3dVisible ? 1 : 0;
  st["Model3DX"]        = model3dPosX;
  st["Model3DY"]        = model3dPosY;
  st["ViewOverlapFx"]   = viewOverlapFxEnabled ? 1 : 0;
  st["ViewSnapFx"]      = viewSnapFxEnabled ? 1 : 0;
  st["ViewGravityFx"]   = viewGravityFxEnabled ? 1 : 0;
  st["ViewGravityStr"]  = viewGravityFxStrength;

  // Values the UI expects immediately after connect
  st["AUX"]            = lastAuxValue;
  st["Bucket"]         = lastBucketValue;
  st["Beacon"]         = beaconOn ? 1 : 0;
  st["Emergency"]      = emergencyOn ? 1 : 0;

  // Initial slider zeros (keeps your existing semantics)
  JsonObject sl = doc.createNestedObject("sliders");
  sl["Forward"]  = 0;
  sl["Backward"] = 0;
  sl["Left"]     = 0;
  sl["Right"]    = 0;
  sl["ArmUp"]    = 0;
  sl["ArmDown"]  = 0;

  // Serialize into a fixed buffer on the stack to avoid heap churn
  char out[980];
  size_t n = serializeJson(doc, out, sizeof(out));
  if (n > 0 && n < sizeof(out)) {
    client->text(out, n);
  } else {
    // Emergency fallback: if somehow oversized, send compact CSV a single time.
    client->text("INIT,HoldBucket," + String(holdBucket ? 1 : 0) +
                 ",HoldAux," + String(holdAux ? 1 : 0) +
                 ",Switch," + String(horScreen ? 1 : 0) +
                 ",DarkMode," + String(darkMode ? 1 : 0) +
                 ",RecordTelemetry," + String(tlmEnabled ? 1 : 0) +
                 ",SystemSounds," + String(sSndEnabled ? 1 : 0) +
                 ",WsRebootOnDisconnect," + String(wsRebootOnDisconnect ? 1 : 0) +
                 ",GamepadEnabled," + String(bluepadEnabled ? 1 : 0) +
                 ",SystemVolume," + String(sSndVolume) +
                 ",AUX," + String(lastAuxValue) +
                 ",Bucket," + String(lastBucketValue) +
                 ",Beacon," + String(beaconOn ? 1 : 0) +
                 ",Emergency," + String(emergencyOn ? 1 : 0) +
                 ",SliderForward,0,SliderBackward,0,SliderLeft,0,SliderRight,0,SliderArmUp,0,SliderArmDown,0");
  }
}

  void onCarInputWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
    switch (type) {
      case WS_EVT_CONNECT: {
        DBG_PRINTF("WebSocket client #%u connected from %s\n", client->id(), client->remoteIP().toString().c_str());
        lastWsClientIP = client->remoteIP().toString();
        lastWsConnectTime = millis();

        // >>> watchdog book-keeping (preserve)
        wsActiveClients = server->count();
        hadAnyClientSinceBoot = true;
        lastWebActivityMs = millis();
        // <<<

        // Send a single, batched snapshot instead of ~15 tiny frames
        sendWsInitSnapshot(client);
        broadcastGpioConfig(client);
        // Serial terminal history is loaded via /serial/logs to keep websocket traffic clean.

        // (Optional) If you want to immediately broadcast beacon/emergency to all clients too:
        // wsCarInput.textAll(String("Beacon,") + (beaconOn ? 1 : 0));
        // wsCarInput.textAll(String("Emergency,") + (emergencyOn ? 1 : 0));
      } break;

      case WS_EVT_DISCONNECT: {
        DBG_PRINTF("WebSocket client #%u disconnected\n", client->id());
        lastWsClientIP = ""; // Clear
        moveCar(STOP);

        // >>> ADDED: watchdog book-keeping
        wsActiveClients = server->count();
        lastWsDisconnectMs = millis();
        // <<<
      } break;

      // >>> ADDED: count any traffic/pongs as activity
      case WS_EVT_PONG: {
        lastWebActivityMs = millis();
      } break;

      case WS_EVT_ERROR: {
        lastWebActivityMs = millis();
        DBG_PRINTF("WebSocket error on client #%u\n", client->id());
      } break;
      // <<<

      case WS_EVT_DATA: {
        // >>> ADDED: any data counts as activity
        lastWebActivityMs = millis();
        // <<<

        AwsFrameInfo* info = (AwsFrameInfo*)arg;
        if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {

          // ---------- JSON branch for key events ----------
          if (len > 0 && ((const char*)data)[0] == '{') {
            StaticJsonDocument<128> jd;
            DeserializationError derr = deserializeJson(jd, (const char*)data, len);
            if (!derr) {
              const char* t = jd["t"] | "";
              if (strcmp(t, "key") == 0) {
                const char* code = jd["code"]  | "";
                const char* st   = jd["state"] | "down";
                Action a = actionForKeyToken(String(code));
                if (a != ACT_NONE) {
                  bool pressed = (strcmp(st, "down") == 0);
                  dispatchAction(a, pressed);
                }
                return; // handled as JSON; do not run CSV path
              }
            }
            // If it's JSON but not our type, fall through to CSV parsing
          }

          // ---------- CSV parsing path ----------
          // Format: "KEY,value1,value2"
          std::string key, value1, value2;
          char* buf = (char*)alloca(len + 1);   // stack buffer to avoid heap fragmentation
          memcpy(buf, data, len);
          buf[len] = 0;

          char* save = nullptr;
          char* t1 = strtok_r(buf, ",", &save);
          char* t2 = strtok_r(nullptr, ",", &save);
          char* t3 = strtok_r(nullptr, ",", &save);

          if (t1) key.assign(t1);
          if (t2) value1.assign(t2);
          if (t3) value2.assign(t3);

          if (key == "GPIO") {
            GpioConfig updated = gpioConfig;
            bool changed = false;
            std::string payload = value1;
            size_t pos = 0;
            while (pos < payload.size()) {
              size_t sep = payload.find(';', pos);
              std::string token = payload.substr(pos, sep == std::string::npos ? std::string::npos : sep - pos);
              size_t colon = token.find(':');
              if (colon != std::string::npos) {
                std::string field = trimCopy(token.substr(0, colon));
                std::string valStr = trimCopy(token.substr(colon + 1));
                if (!field.empty()) {
                  int value = atoi(valStr.c_str());
                  if (applyGpioValue(updated, field, value)) {
                    changed = true;
                  }
                }
              }
              if (sep == std::string::npos) break;
              pos = sep + 1;
            }
            if (changed) {
              gpioConfig = updated;
              saveGpioConfigToPrefs(gpioConfig);
              applyGpioConfig(false);
            }
            broadcastGpioConfig(nullptr);
            return;
          }

          // --- Media control handlers ---
          if (key == "MEDIA_PLAY") {
            DBG_PRINTF("[WS] MEDIA_PLAY: %s\n", value1.c_str());
            String filename = value1.c_str();
            if (!filename.startsWith("/media/")) filename = "/media/" + filename;

            currentTrack = -1;
            for (int i = 0; i < playlist.size(); i++) {
              if (playlist[i] == filename || playlist[i].endsWith(filename.substring(filename.lastIndexOf('/') + 1))) {
                currentTrack = i;
                break;
              }
            }
            if (currentTrack >= 0) {
              playCurrentTrack();
            } else {
              playWavFileOnSpeaker(filename);
              playbackStarted = true;
              isPaused = false;
            }
            wsSendKeyStr("MEDIA_DEVICE_PLAYING", filename);
            lastMediaProgressSend = millis();
          }
          else if (key == "MEDIA_NEXT") {
            if (!playlist.empty()) {
              nextTrack();
              if (currentTrack >= 0 && currentTrack < playlist.size() && audio.isRunning()) {
                wsSendKeyStr("MEDIA_DEVICE_PLAYING", playlist[currentTrack]);
              }
            }
          }

          else if (key == "RADIO_PLAY") {
            const char* urlc = value1.c_str();     // value1 is std::string
            queueRadioPlay(urlc);                  // defer to main loop to avoid blocking WS task
          }


          else if (key == "MEDIA_STOP")   { stopAudio(); queueAudioEngineReset(); wsCarInput.textAll("MEDIA_DEVICE_STOPPED"); isPaused = false; }
          else if (key == "MEDIA_PAUSE")  { pauseAudio(); wsCarInput.textAll("MEDIA_DEVICE_PAUSED"); }
          else if (key == "MEDIA_RESUME") { resumeAudio(); wsSendKeyStr("MEDIA_DEVICE_PLAYING", playlist[currentTrack]); }
          else if (key == "MEDIA_PREV")   { prevTrack();  wsSendKeyStr("MEDIA_DEVICE_PLAYING", playlist[currentTrack]); }
          else if (key == "MEDIA_LOOP_ON")     { loopMode = true;  }
          else if (key == "MEDIA_LOOP_OFF")    { loopMode = false; }
          else if (key == "MEDIA_SHUFFLE_ON")  { shuffleMode = true;  }
          else if (key == "MEDIA_SHUFFLE_OFF") { shuffleMode = false; }

          // --- MIC STREAM COMMANDS ---
          if (key == "START_MIC_STREAM") { micStreamActive = true;  client->text("MIC_STREAM_ON"); }
          else if (key == "STOP_MIC_STREAM") { micStreamActive = false; client->text("MIC_STREAM_OFF"); }

          // --- Turn signals via Slider ---
          if (key == "Slider") {
            String side = value1.c_str();
            int val = atoi(value2.c_str());
            if (side == "Left") {
              if (val > 5 && !leftSignalActive)  { leftSignalActive = true;  updatePixels(); wsCarInput.textAll("TURN_LEFT,1"); }
              else if (val <= 5 && leftSignalActive) { leftSignalActive = false; updatePixels(); wsCarInput.textAll("TURN_LEFT,0"); }
            } else if (side == "Right") {
              if (val > 5 && !rightSignalActive) { rightSignalActive = true;  updatePixels(); wsCarInput.textAll("TURN_RIGHT,1"); }
              else if (val <= 5 && rightSignalActive) { rightSignalActive = false; updatePixels(); wsCarInput.textAll("TURN_RIGHT,0"); }
            }
          }

          if (key == "Beacon")    { beaconOn    = !beaconOn;    updatePixels(); }
          if (key == "Emergency") { emergencyOn = !emergencyOn; updatePixels(); }

          if (key == "Motor") {
            int pwm = atoi(value2.c_str());
            controlMotorByDirection(value1, pwm);
          }

          DBG_PRINTF("Key [%s] Value1[%s] Value2[%s]\n", key.c_str(), value1.c_str(), value2.c_str());
          int valueInt = atoi(value1.c_str());

          if (key == "MoveCar") {
            int pwm = (value2.empty() ? 255 : atoi(value2.c_str()));
            moveCar(valueInt, pwm);
            DBG_PRINTF("[WS] moveCar called with valueInt=%d pwm=%d\n", valueInt, pwm);
          }
          else if (key == "AUX")    auxControl(valueInt);
          else if (key == "Bucket") bucketTilt(valueInt);
          else if (key == "Light") {
            lightControl(); updatePixels();
            wsSendKeyInt("Light", light ? 1 : 0);
          }
          else if (key == "Switch")          { horScreen = (valueInt != 0); uiPrefs.putBool("Switch", horScreen); }
          else if (key == "HoldBucket")      { holdBucket = (valueInt != 0); uiPrefs.putBool("HoldBucket", holdBucket); }
          else if (key == "HoldAux")         { holdAux = (valueInt != 0); uiPrefs.putBool("HoldAux", holdAux); }
          else if (key == "DarkMode")        { darkMode = (valueInt != 0); uiPrefs.putBool("darkMode", darkMode); }
          else if (key == "RecordTelemetry") {
            const bool on = (valueInt != 0) ||
                            value1 == "true" || value1 == "TRUE" ||
                            value1 == "on" || value1 == "ON" ||
                            value1 == "yes" || value1 == "YES";
            setTelemetryEnabled(on);
            wsSendKeyInt("RecordTelemetry", on ? 1 : 0);
          }
          else if (key == "SystemSounds")    { int v = atoi(value1.c_str()); sSndEnabled = (v != 0); uiPrefs.putBool("SystemSounds", sSndEnabled); }
          else if (key == "WsRebootOnDisconnect") { saveWsRebootWatchdogPref(valueInt != 0); }
          else if (key == "IndicatorsVisible") { indicatorsVisible = (valueInt != 0); uiPrefs.putBool(PREF_INDICATORS_VISIBLE, indicatorsVisible); wsSendKeyInt("IndicatorsVisible", indicatorsVisible ? 1 : 0); }
          else if (key == "IndicatorsX") { indicatorsPosX = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_INDICATORS_X, indicatorsPosX); wsSendKeyInt("IndicatorsX", indicatorsPosX); }
          else if (key == "IndicatorsY") { indicatorsPosY = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_INDICATORS_Y, indicatorsPosY); wsSendKeyInt("IndicatorsY", indicatorsPosY); }
          else if (key == "ImuVisible") { imuVisible = (valueInt != 0); uiPrefs.putBool(PREF_IMU_VISIBLE, imuVisible); wsSendKeyInt("ImuVisible", imuVisible ? 1 : 0); }
          else if (key == "ImuX") { imuPosX = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_IMU_X, imuPosX); wsSendKeyInt("ImuX", imuPosX); }
          else if (key == "ImuY") { imuPosY = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_IMU_Y, imuPosY); wsSendKeyInt("ImuY", imuPosY); }
          else if (key == "MediaVisible") { mediaVisible = (valueInt != 0); uiPrefs.putBool(PREF_MEDIA_VISIBLE, mediaVisible); wsSendKeyInt("MediaVisible", mediaVisible ? 1 : 0); }
          else if (key == "MediaX") { mediaPosX = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_MEDIA_X, mediaPosX); wsSendKeyInt("MediaX", mediaPosX); }
          else if (key == "MediaY") { mediaPosY = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_MEDIA_Y, mediaPosY); wsSendKeyInt("MediaY", mediaPosY); }
          else if (key == "PathVisible") { pathVisible = (valueInt != 0); uiPrefs.putBool(PREF_PATH_VISIBLE, pathVisible); wsSendKeyInt("PathVisible", pathVisible ? 1 : 0); }
          else if (key == "PathX") { pathPosX = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_PATH_X, pathPosX); wsSendKeyInt("PathX", pathPosX); }
          else if (key == "PathY") { pathPosY = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_PATH_Y, pathPosY); wsSendKeyInt("PathY", pathPosY); }
          else if (key == "Model3DVisible") { model3dVisible = (valueInt != 0); uiPrefs.putBool(PREF_MODEL3D_VISIBLE, model3dVisible); wsSendKeyInt("Model3DVisible", model3dVisible ? 1 : 0); }
          else if (key == "Model3DX") { model3dPosX = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_MODEL3D_X, model3dPosX); wsSendKeyInt("Model3DX", model3dPosX); }
          else if (key == "Model3DY") { model3dPosY = constrain(valueInt, -1, 10000); uiPrefs.putInt(PREF_MODEL3D_Y, model3dPosY); wsSendKeyInt("Model3DY", model3dPosY); }
          else if (key == "ViewOverlapFx") { viewOverlapFxEnabled = (valueInt != 0); uiPrefs.putBool(PREF_VIEW_OVERLAP_FX, viewOverlapFxEnabled); wsSendKeyInt("ViewOverlapFx", viewOverlapFxEnabled ? 1 : 0); }
          else if (key == "ViewSnapFx") { viewSnapFxEnabled = (valueInt != 0); uiPrefs.putBool(PREF_VIEW_SNAP_FX, viewSnapFxEnabled); wsSendKeyInt("ViewSnapFx", viewSnapFxEnabled ? 1 : 0); }
          else if (key == "ViewGravityFx") { viewGravityFxEnabled = (valueInt != 0); uiPrefs.putBool(PREF_VIEW_GRAVITY_FX, viewGravityFxEnabled); wsSendKeyInt("ViewGravityFx", viewGravityFxEnabled ? 1 : 0); }
          else if (key == "ViewGravityStr") { viewGravityFxStrength = constrain(valueInt, 0, 100); uiPrefs.putInt(PREF_VIEW_GRAVITY_ST, viewGravityFxStrength); wsSendKeyInt("ViewGravityStr", viewGravityFxStrength); }
          else if (key == "GamepadEnabled")  { bool next = (atoi(value1.c_str()) != 0); handleBluepadStateChange(next, true, true); }
          else if (key == "SystemVolume")    { int v = atoi(value1.c_str()); sSndVolume = v; uiPrefs.putInt("SystemVolume", sSndVolume); }
          else if (key == "ModelRotX")       { modelRotXDeg = constrain(valueInt, -360, 360); uiPrefs.putInt("ModelRotX", modelRotXDeg); wsSendKeyInt("ModelRotX", modelRotXDeg); }
          else if (key == "ModelRotY")       { modelRotYDeg = constrain(valueInt, -360, 360); uiPrefs.putInt("ModelRotY", modelRotYDeg); wsSendKeyInt("ModelRotY", modelRotYDeg); }
          else if (key == "ModelRotZ")       { modelRotZDeg = constrain(valueInt, -360, 360); uiPrefs.putInt("ModelRotZ", modelRotZDeg); wsSendKeyInt("ModelRotZ", modelRotZDeg); }
          else if (key == "ModelDirX")       { modelDirX   = (valueInt < 0) ? -1 : 1; uiPrefs.putInt("ModelDirX", modelDirX); wsSendKeyInt("ModelDirX", modelDirX); }
          else if (key == "ModelDirY")       { modelDirY   = (valueInt < 0) ? -1 : 1; uiPrefs.putInt("ModelDirY", modelDirY); wsSendKeyInt("ModelDirY", modelDirY); }
          else if (key == "ModelDirZ")       { modelDirZ   = (valueInt < 0) ? -1 : 1; uiPrefs.putInt("ModelDirZ", modelDirZ); wsSendKeyInt("ModelDirZ", modelDirZ); }
          else if (key == "ModelAxisX")      { modelAxisX  = constrain(valueInt, 0, 2); uiPrefs.putInt("ModelAxisX", modelAxisX); wsSendKeyInt("ModelAxisX", modelAxisX); }
          else if (key == "ModelAxisY")      { modelAxisY  = constrain(valueInt, 0, 2); uiPrefs.putInt("ModelAxisY", modelAxisY); wsSendKeyInt("ModelAxisY", modelAxisY); }
          else if (key == "ModelAxisZ")      { modelAxisZ  = constrain(valueInt, 0, 2); uiPrefs.putInt("ModelAxisZ", modelAxisZ); wsSendKeyInt("ModelAxisZ", modelAxisZ); }
          else if (key == "TelemetryMaxKB")  {
            telemetryFileMaxKB = clampTelemetryMaxKB(valueInt);
            telemetryFileMaxSizeBytes = (size_t)telemetryFileMaxKB * 1024;
            uiPrefs.putUInt("TelemetryMaxKB", telemetryFileMaxKB);
            wsSendKeyInt("TelemetryMaxKB", telemetryFileMaxKB);
          }
          else if (key == "SerialLogRateMs")  {
            serialLogWsMinIntervalMs = clampSerialLogRateMs(valueInt);
            uiPrefs.putUInt(PREF_SERIALLOG_RATE_MS, serialLogWsMinIntervalMs);
            wsSendKeyInt("SerialLogRateMs", serialLogWsMinIntervalMs);
          }
          else if (key == "SerialLogKeepLines")  {
            serialLogRetainLines = clampSerialLogKeepLines(valueInt);
            uiPrefs.putUInt(PREF_SERIALLOG_KEEP_LINES, serialLogRetainLines);
            clearSerialLogBuffer();
            wsSendKeyInt("SerialLogKeepLines", serialLogRetainLines);
          }

        } // if (frame ok)
        break;           // <-- IMPORTANT: end of WS_EVT_DATA case
      }                  // <-- end of case block
    }
  }

  // ---------- Helpers to (re)seed and read maps ----------
  static void initInputMapsIfEmpty() {
    for (size_t i = 0; i < KEYMAP_N; ++i) {
      const char* k = KEYMAP_DEFAULTS[i].action;
      String cur = keymapPrefs.getString(k, "");
      if (cur.length() == 0) keymapPrefs.putString(k, KEYMAP_DEFAULTS[i].def);
    }
    for (size_t i = 0; i < JOYMAP_N; ++i) {
      const char* k = JOYMAP_DEFAULTS[i].action;
      String cur = joymapPrefs.getString(k, "");
      if (cur.length() == 0) joymapPrefs.putString(k, JOYMAP_DEFAULTS[i].defBtn);
    }
  }

  static inline void joymapLoadToJson(JsonObject root) {
    for (size_t i=0;i<JOYMAP_N;++i) {
      const char* k = JOYMAP_DEFAULTS[i].action;
      const char* d = JOYMAP_DEFAULTS[i].defBtn;
      root[k] = normJoyBtn( joymapPrefs.getString(k, d) );   // canonicalize
    }
  }


  static inline void keymapResetDefaults() {
    for (size_t i=0;i<KEYMAP_N;++i)
      keymapPrefs.putString(KEYMAP_DEFAULTS[i].action, KEYMAP_DEFAULTS[i].def);
  }
  static inline void joymapResetDefaults() {
    for (size_t i=0;i<JOYMAP_N;++i)
      joymapPrefs.putString(JOYMAP_DEFAULTS[i].action, JOYMAP_DEFAULTS[i].defBtn);
  }

  // ---------- Resolve helpers you can call at runtime ----------
  static Action actionFromName(const String& name) {
    if (name=="forward") return ACT_FORWARD;
    if (name=="backward") return ACT_BACKWARD;
    if (name=="left") return ACT_LEFT;
    if (name=="right") return ACT_RIGHT;
    if (name=="stop") return ACT_STOP;
    if (name=="bucket_up") return ACT_BUCKET_UP;
    if (name=="bucket_down") return ACT_BUCKET_DOWN;
    if (name=="aux_up") return ACT_AUX_UP;
    if (name=="aux_down") return ACT_AUX_DOWN;
    if (name=="light_toggle") return ACT_LIGHT_TOGGLE;
    if (name=="beacon_toggle") return ACT_BEACON_TOGGLE;
    if (name=="emergency_toggle") return ACT_EMERGENCY_TOGGLE;
    if (name=="horn") return ACT_HORN;
    return ACT_NONE;
  }

  // Normalize keyboard key token (e.g. "W" -> "w", "Space" -> " ")
  static String normKey(String k) {
    k.trim();
    k.toLowerCase();
    // common aliases
    if (k=="space" || k=="spacebar") return " ";
    if (k=="arrowup")    return "arrowup";
    if (k=="arrowdown")  return "arrowdown";
    if (k=="arrowleft")  return "arrowleft";
    if (k=="arrowright") return "arrowright";
    return k;
  }

  static Action actionForKeyToken(String keyToken) {
    String k = normKey(keyToken);
    for (size_t i=0;i<KEYMAP_N;++i) {
      String bound = keymapPrefs.getString(KEYMAP_DEFAULTS[i].action, KEYMAP_DEFAULTS[i].def);
      bound = normKey(bound);
      if (k == bound) return actionFromName(KEYMAP_DEFAULTS[i].action);
    }
    return ACT_NONE;
  }


  // ---------- Central dispatcher (call your actual robot functions here) ----------
  // NOTE: Replace the TODOs with your real control functions.
  static void dispatchAction(Action a, bool pressed) {
    // Movement: act on press; release to stop if needed
    switch (a) {
      case ACT_FORWARD:       /* TODO: on press go forward; on release stop/neutral */ break;
      case ACT_BACKWARD:      /* TODO */ break;
      case ACT_LEFT:          /* TODO */ break;
      case ACT_RIGHT:         /* TODO */ break;
      case ACT_STOP:          if (pressed) {/* TODO: stop all motion */} break;

      case ACT_BUCKET_UP:     if (pressed) {/* TODO: bucketTilt(+step) or start hold */} break;
      case ACT_BUCKET_DOWN:   if (pressed) {/* TODO: bucketTilt(-step) or start hold */} break;
      case ACT_AUX_UP:        if (pressed) {/* TODO: auxControl(+step) */} break;
      case ACT_AUX_DOWN:      if (pressed) {/* TODO: auxControl(-step) */} break;

      case ACT_LIGHT_TOGGLE:  if (pressed) {/* TODO: toggle light */} break;
      case ACT_BEACON_TOGGLE: if (pressed) {/* TODO */} break;
      case ACT_EMERGENCY_TOGGLE: if (pressed) {/* TODO */} break;
      case ACT_HORN:          /* on press: start horn; on release: stop horn */ break;
      default: break;
    }
  }

  //--------------------------Joystick helpers------------------------------------------

  // --- Joystick button normalizer (accept RB/LB/RT/LT etc., return canonical tokens) ---
  static String normJoyBtn(String s) {
    s.trim(); s.toUpperCase();

    // Face
    if (s == "A" || s == "BTN_A") return "A";
    if (s == "B" || s == "BTN_B") return "B";
    if (s == "X" || s == "BTN_X") return "X";
    if (s == "Y" || s == "BTN_Y") return "Y";

    // D-Pad
    if (s == "UP" || s == "DPAD-UP" || s == "DUP") return "DPAD_UP";
    if (s == "DOWN" || s == "DPAD-DOWN" || s == "DDOWN") return "DPAD_DOWN";
    if (s == "LEFT" || s == "DPAD-LEFT" || s == "DLEFT") return "DPAD_LEFT";
    if (s == "RIGHT" || s == "DPAD-RIGHT" || s == "DRIGHT") return "DPAD_RIGHT";

    // Bumpers
    if (s == "RB" || s == "R1" || s == "BUTTON_R1") return "R1";
    if (s == "LB" || s == "L1" || s == "BUTTON_L1") return "L1";

    // Triggers-as-click (digital)
    if (s == "RT" || s == "RT_CLICK" || s == "TRIGGER_RIGHT") return "R2_CLICK";
    if (s == "LT" || s == "LT_CLICK" || s == "TRIGGER_LEFT")  return "L2_CLICK";

    // Stick clicks
    if (s == "LS" || s == "L3" || s == "L_STICK") return "L3";
    if (s == "RS" || s == "R3" || s == "R_STICK") return "R3";

    // Menu
    if (s == "START" || s == "BTN_START") return "BTN_START";
    if (s == "BACK" || s == "SELECT" || s == "BTN_BACK") return "BTN_BACK";

    // Digital stick directions (if you use them)
    if (s.startsWith("LS_") || s.startsWith("RS_")) return s; // already canonical

    return s; // return uppercased as-is if unknown
  }


  // --- Joy button -> Action cache ---
  struct JoyPair { String btn; Action act; };
  static JoyPair g_joyCache[32];
  static size_t  g_joyCacheN = 0;

  static void rebuildJoyActionCache() {
    g_joyCacheN = 0;
    for (size_t i=0; i<JOYMAP_N && g_joyCacheN<32; ++i) {
      const char* fw = JOYMAP_DEFAULTS[i].action;
      String btn = normJoyBtn( joymapPrefs.getString(fw, JOYMAP_DEFAULTS[i].defBtn) );
      if (!btn.length()) continue;            // allow unassigned
      Action a = actionFromName(String(fw));  // your existing helper
      if (a != ACT_NONE) g_joyCache[g_joyCacheN++] = { btn, a };
    }
    DBG_PRINTF("[JOYMAP] cache rebuilt: %u entries\n", (unsigned)g_joyCacheN);
  }

  static Action actionForJoyButtonCached(const String& btnName) {
    String key = normJoyBtn(btnName);
    for (size_t i=0; i<g_joyCacheN; ++i)
      if (g_joyCache[i].btn.equalsIgnoreCase(key)) return g_joyCache[i].act;
    return ACT_NONE;
  }



//----------------------------------------------------------------------Bluepad32 Functions---------------------------------------------------------

  //#if USE_BLUEPAD32

  static int connectedPadCount() {
    int n = 0;
    for (int i = 0; i < BP32_MAX_GAMEPADS; ++i) if (myControllers[i]) ++n;
    return n;
  }

  void onConnectedController(ControllerPtr ctl) {
    for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
      if (myControllers[i] == nullptr) {
        myControllers[i] = ctl;
        DBG_PRINTF("Controller connected! Index=%d\n", i);
        break;
      }
    }
    // Stop discovery/ads while a pad is connected → less RF contention
    BP32.enableNewBluetoothConnections(false);
  }

  void onDisconnectedController(ControllerPtr ctl) {
    for (int i = 0; i < BP32_MAX_GAMEPADS; i++) {
      if (myControllers[i] == ctl) {
        myControllers[i] = nullptr;
        DBG_PRINTF("Controller disconnected! Index=%d\n", i);
        break;
      }
    }
    // If all gone, allow pairing again
    if (connectedPadCount() == 0) {
      BP32.enableNewBluetoothConnections(true);
    }
  }

    // Call mapped action on button edge using the joy cache
    static inline void joyEdgeDispatch(const char* token, bool now, bool& last) {
      if (now == last) return;
      last = now;
      Action a = actionForJoyButtonCached(String(token)); // token examples: "R1", "L2_CLICK", "A", "X", ...
      if (a != ACT_NONE) {
        dispatchAction(a, now);   // 'now' == true on press, false on release
      }
    }


    void handleControllerInput(ControllerPtr ctl) {
      if (!ctl) return;

      // --- RIGHT STICK: DRIVE (arcade) ---
      int rx = ctl->axisRY();
      int ry = ctl->axisRX();
      const int deadzone = 100;

      if (abs(rx) < deadzone) rx = 0;
      if (abs(ry) < deadzone) ry = 0;

      int speed = ::map(ry, -511, 511, -255, 255);  // Forward +, reverse -
      int turn  = ::map(rx, -511, 511, -255, 255);  // Left -, right +

      int leftPWM  = constrain(speed + turn, -255, 255);
      int rightPWM = constrain(speed - turn, -255, 255);

      static int lastLeftPWM = 0, lastRightPWM = 0;
      if (leftPWM != lastLeftPWM || rightPWM != lastRightPWM) {
        if (leftPWM == 0 && rightPWM == 0) {
          rightMotorStop();
          leftMotorStop();
        } else {
          if (leftPWM > 0)  leftMotorForward( leftPWM);
          else              leftMotorBackward(-leftPWM);
          if (rightPWM > 0) rightMotorForward( rightPWM);
          else              rightMotorBackward(-rightPWM);
        }
        lastLeftPWM  = leftPWM;
        lastRightPWM = rightPWM;
      }

      // --- LEFT STICK (Y only): ARM (analog) ---
      int ly = -ctl->axisY();                 // Up = positive
      int armPWM = (abs(ly) > deadzone) ? ::map(ly, -511, 511, -255, 255) : 0;

      static int lastArmPWM = 0;
      if (armPWM != lastArmPWM) {
        if (armPWM == 0) {
          armMotorStop();
        } else if (armPWM > 0) {
          armMotorUp( armPWM);
        } else {
          armMotorDown(-armPWM);
        }
        lastArmPWM = armPWM;
      }

      // --- BUTTONS -> mapped actions (IMMEDIATE via joy cache) ---
      // We treat L2 / R2 as "click" digital tokens for mapping purposes.
      static bool pR1=false, pR2=false, pL1=false, pL2=false;
      static bool pA=false, pB=false, pX=false, pY=false;

      bool r1 = ctl->r1();
      bool r2 = ctl->r2();
      bool l1 = ctl->l1();
      bool l2 = ctl->l2();

      bool a  = ctl->a();
      bool b  = ctl->b();
      bool x  = ctl->x();
      bool y  = ctl->y();

      // Shoulder / triggers
      joyEdgeDispatch("R1",       r1, pR1);
      joyEdgeDispatch("R2_CLICK", r2, pR2);
      joyEdgeDispatch("L1",       l1, pL1);
      joyEdgeDispatch("L2_CLICK", l2, pL2);

      // Face buttons
      joyEdgeDispatch("A", a, pA);
      joyEdgeDispatch("B", b, pB);
      joyEdgeDispatch("X", x, pX);
      joyEdgeDispatch("Y", y, pY);

      // --- (Optional) add START/BACK if your controller API exposes them ---
      // Example (uncomment if ctl->start() / ctl->back() exist):
      /*
      static bool pStart=false, pBack=false;
      bool start = ctl->start();
      bool back  = ctl->back();
      joyEdgeDispatch("BTN_START", start, pStart);
      joyEdgeDispatch("BTN_BACK",  back,  pBack);
      */

      // --- (Optional) D-Pad mapping ---
      // If your API gives discrete booleans (e.g. ctl->dpadUp()), wire them like below:
      /*
      static bool pDU=false, pDD=false, pDL=false, pDR=false;
      joyEdgeDispatch("DPAD_UP",    ctl->dpadUp(),    pDU);
      joyEdgeDispatch("DPAD_DOWN",  ctl->dpadDown(),  pDD);
      joyEdgeDispatch("DPAD_LEFT",  ctl->dpadLeft(),  pDL);
      joyEdgeDispatch("DPAD_RIGHT", ctl->dpadRight(), pDR);
      */
      // If you only have an enum-based dpad(), add a small switch that sets four booleans and call joyEdgeDispatch for each.
    }


  //#endif

//-----------------------------------------------------------------------Robot I2S Audio------------------------------------------------------------

  void stopAudio() {
    audio.stopSong();
    sirenPlaying = false;
    isSystemSoundPlaying = false;
    if (gpioConfig.i2sSpkPa >= 0) {
      pinMode(gpioConfig.i2sSpkPa, OUTPUT);
      digitalWrite(gpioConfig.i2sSpkPa, LOW);
    }
    playbackStarted = false;
    currentlyPlayingFile = "";

    // Release exclusive SD if we own it
    if (g_gateHeldByAudio) {
      g_gateHeldByAudio = false;
      xSemaphoreGive(g_sdStreamGate);
    }
  }

  void queueAudioEngineReset() {
    g_audioEngineResetQueued = true;
  }

  void processQueuedAudioEngineReset() {
    if (!g_audioEngineResetQueued) return;
    if (audio.isRunning()) return;
    if (isSystemSoundPlaying) return;

    g_audioEngineResetQueued = false;
    audio.~Audio();
    new (&audio) Audio();
    audio.setBufsize(AUDIO_STREAM_RAM_BUF_BYTES, AUDIO_STREAM_PSRAM_BUF_BYTES);
    audio.setVolume(currentVolume);
    currentI2SMode = I2S_NONE;

    DBG_PRINTF("[AUDIO] Engine reset complete, heap=%u psram=%u\n", ESP.getFreeHeap(), ESP.getFreePsram());
  }

  void releaseMediaResources() {
    stopAudio();
    queueAudioEngineReset();
    isPaused = false;
    playbackStarted = false;
    currentlyPlayingFile = "";
    playlist.clear();
    folderIndex.clear();
    playlistLoaded = false;
    currentTrack = 0;

    if (currentI2SMode == I2S_SPEAKER) {
      esp_err_t res = i2s_driver_uninstall(MY_I2S_PORT);
      if (res != ESP_OK && res != ESP_ERR_INVALID_STATE) {
        DBG_PRINTF("[AUDIO] releaseMediaResources: i2s uninstall returned %d\n", res);
      }
      currentI2SMode = I2S_NONE;
    }

    if (g_gateHeldByAudio) {
      g_gateHeldByAudio = false;
      xSemaphoreGive(g_sdStreamGate);
    }
  }


    // Call once when enabling mic (after i2s_driver_install)
  void setupI2SMic() {
    static const i2s_config_t i2s_config = {
      .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
      .sample_rate = I2S_SAMPLE_RATE,
      .bits_per_sample = I2S_SAMPLE_BITS,
      .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
      .communication_format = I2S_COMM_FORMAT_I2S,
      .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
      .dma_buf_count = 4,
      .dma_buf_len = 256,
      .use_apll = false,
      .tx_desc_auto_clear = false,
      .fixed_mclk = 0
    };
    i2s_pin_config_t pin_config = {
      .bck_io_num = gpioConfig.i2sMicSck,
      .ws_io_num  = gpioConfig.i2sMicWs,
      .data_out_num = -1,
      .data_in_num  = gpioConfig.i2sMicSd
    };

    i2s_driver_install(MY_I2S_PORT, &i2s_config, 0, NULL);
    i2s_set_pin(MY_I2S_PORT, &pin_config);
    i2s_zero_dma_buffer(MY_I2S_PORT);

    if (!micBuf) {
  #if USE_PSRAM
      micBuf = (int16_t*)ps_malloc(micBufBytes);
  #else
      micBuf = (int16_t*)malloc(micBufBytes);
  #endif
    }
    micLastSendMs = millis();
  }

  void enableMic() {
    if (currentI2SMode == I2S_MIC) { DBG_PRINTLN("[I2S] Mic already enabled."); return; }
    DBG_PRINTLN("[I2S] Switching to MIC: stopping audio, uninstalling I2S, and initializing mic...");
    stopAudio();
    esp_err_t res = i2s_driver_uninstall(MY_I2S_PORT);
    if (res == ESP_OK)          DBG_PRINTLN("[I2S] I2S driver uninstalled successfully (for MIC).");
    else if (res == ESP_ERR_INVALID_STATE) DBG_PRINTLN("[I2S] I2S driver not installed, nothing to uninstall.");
    else                      DBG_PRINTF("[I2S] I2S driver uninstall for MIC returned code: %d\n", res);

    setupI2SMic();
    currentI2SMode = I2S_MIC;
    DBG_PRINTLN("[I2S] MIC enabled and ready.");
  }

  void disableMic() {
    if (currentI2SMode == I2S_MIC) {
      DBG_PRINTLN("[I2S] Disabling MIC: uninstalling I2S driver...");
      esp_err_t res = i2s_driver_uninstall(MY_I2S_PORT);
      if (res == ESP_OK) DBG_PRINTLN("[I2S] I2S driver uninstalled successfully (MIC off).");
      else               DBG_PRINTF("[I2S] I2S driver uninstall for MIC returned code: %d\n", res);
      currentI2SMode = I2S_NONE;
    } else {
      DBG_PRINTLN("[I2S] MIC not enabled, nothing to disable.");
    }
    if (micBuf) { free(micBuf); micBuf = nullptr; }
  }

  void streamMicToWebSocket() {
    if (soundIsPlaying()) return;
    if (!micStreamActive) return;
    if (currentI2SMode != I2S_MIC) return;

    // Only if someone’s listening
    if (wsCarInput.count() == 0) {
      // Small sleep to avoid spinning CPU if called in a tight loop
      delay(1);
      return;
    }

    // Throttle a bit (e.g., ~50 packets/sec) to avoid WS queue piling up
    const uint32_t now = millis();
    if (now - micLastSendMs < 20) return;

    if (!micBuf) return; // should not happen; safety

    size_t bytesRead = 0;
    // Short timeout; don't block the async loop
    esp_err_t res = i2s_read(MY_I2S_PORT,
                            (void*)micBuf,
                            micBufBytes,
                            &bytesRead,
                            10 / portTICK_PERIOD_MS);

    if (res == ESP_OK && bytesRead > 0) {
      // Send as binary; clients that don't care (UI) ignore non-text frames
      wsCarInput.binaryAll((uint8_t*)micBuf, bytesRead);
      micLastSendMs = now;
    }

    // Cooperative yield
    delay(0);
  }

  static void queueRadioPlay(const char* url) {
    if (!url || !url[0]) return;
    pendingRadioUrl = url;
    radioPlayQueued = true;
  }

  static void pumpRadioPlayRequest() {
    if (!radioPlayQueued) return;
    String url = pendingRadioUrl;
    radioPlayQueued = false;
    pendingRadioUrl = "";
    url.trim();
    if (!url.length()) return;

    DBG_PRINTF("[AUDIO] RADIO_PLAY %s\n", url.c_str());
    g_audioEngineResetQueued = false;

    disableMic();
    stopAudio();
    xSemaphoreTake(g_sdStreamGate, portMAX_DELAY);
    g_gateHeldByAudio = true;

    enableSpeaker();
    audio.setVolume(currentVolume);
    bool ok = audio.connecttohost(url.c_str());

    // Many radio URLs are HTTPS; try HTTP fallback for device playback if HTTPS connect fails.
    if (!ok && url.startsWith("https://")) {
      String httpUrl = "http://" + url.substring(8);
      DBG_PRINTF("[AUDIO] RADIO_PLAY retry over HTTP %s\n", httpUrl.c_str());
      ok = audio.connecttohost(httpUrl.c_str());
      if (ok) {
        url = httpUrl;
      }
    }

    if (!ok) {
      DBG_PRINTLN("[AUDIO] RADIO_PLAY failed to start stream");
      stopAudio(); // also releases gate
      wsCarInput.textAll("MEDIA_DEVICE_STOPPED");
      wsSendKeyStr("MEDIA_DEVICE_ERROR", "RADIO_CONNECT_FAILED");
      return;
    }

    playbackStarted = true;
    isPaused = false;

    wsSendKeyStr("MEDIA_DEVICE_PLAYING", url);
  }


  void playWavFileOnSpeaker(const String& filename) {
    DBG_PRINTF("[AUDIO] playWavFileOnSpeaker: %s\n", filename.c_str());
    g_audioEngineResetQueued = false;
    { SdLock lk; if (!SD.exists(filename.c_str())) { DBG_PRINTF("[ERROR] File not found on SD: %s\n", filename.c_str()); return; } }

    // If long media is playing, pause it and mark that we’ll need to resume
    if (audio.isRunning() && !isSystemSoundPlaying) {
      pauseAudio();                 // you already restart from start; good enough
      g_mediaPausedBySystem = true; // remember to resume afterwards
    }

    // Take exclusive SD gate for this short system sound
    xSemaphoreTake(g_sdStreamGate, portMAX_DELAY);
    g_gateHeldByAudio = true;

    disableMic();
    stopAudio();
    delay(60);
    enableSpeaker();
    audio.setVolume(sSndVolume);    // you already do this in queue path
    audio.connecttoFS(SD, filename.c_str());

    currentlyPlayingFile = filename;
    lastMediaProgressSend = 0;
    delay(30);

    if (!audio.isRunning()) DBG_PRINTLN("[AUDIO] Playback did not start!");
    else DBG_PRINTLN("[AUDIO] Playback started OK.");
    isSystemSoundPlaying = true;
  }

  static inline bool isDeviceMediaPath(const String& path) {
    return path.startsWith("/media/");
  }

  void handleDevicePlaybackCompletion() {
    if (!isDeviceMediaPath(currentlyPlayingFile)) {
      playbackStarted = false;
      return;
    }

    playbackStarted = false;
    bool startedNew = false;
    int previousTrack = currentTrack;

    if (!playlist.empty()) {
      nextTrack();
      if (playbackStarted) {
        startedNew = true;
        String nowPlaying = currentlyPlayingFile.length() ? currentlyPlayingFile : playlist[currentTrack];
        wsSendKeyStr("MEDIA_DEVICE_PLAYING", nowPlaying);
        lastMediaProgressSend = millis();
      } else {
        if (previousTrack >= 0 && previousTrack < (int)playlist.size()) {
          currentTrack = previousTrack;
        } else if (!playlist.empty()) {
          currentTrack = playlist.size() - 1;
        }
      }
    }

    if (!startedNew) {
      stopAudio();
      currentlyPlayingFile = "";
      wsCarInput.textAll("MEDIA_DEVICE_STOPPED");
    }
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
      if (gpioConfig.i2sSpkPa >= 0) {
          pinMode(gpioConfig.i2sSpkPa, OUTPUT);
          digitalWrite(gpioConfig.i2sSpkPa, HIGH);  // Enable NS4168 PA
      }

      if (currentI2SMode == I2S_SPEAKER) {
          DBG_PRINTLN("[I2S] Speaker already enabled.");
          return;
      }
      DBG_PRINTLN("[I2S] Switching to SPEAKER: stopping audio, uninstalling I2S, and initializing speaker...");

      // Always stop audio regardless of state
      audio.stopSong();

      // Only uninstall if previously MIC or SPEAKER was initialized
      if (currentI2SMode != I2S_NONE) {
          esp_err_t res = i2s_driver_uninstall(MY_I2S_PORT);
          delay(20); // Allow I2S peripheral to settle
          if (res == ESP_OK) {
              DBG_PRINTLN("[I2S] I2S driver uninstalled successfully (for SPEAKER).");
          } else {
              DBG_PRINTF("[I2S] I2S driver uninstall for SPEAKER returned code: %d\n", res);
          }
      }

      // Re-setup speaker I2S pinout and volume every time
      audio.setPinout(gpioConfig.i2sSpkBclk, gpioConfig.i2sSpkLrck, gpioConfig.i2sSpkSd);
      audio.setVolume(currentVolume);  // restore user-selected volume
      currentI2SMode = I2S_SPEAKER;
      DBG_PRINTLN("[I2S] SPEAKER enabled and ready.");
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
              wsPrintfAll("MEDIA_DEVICE_PROGRESS,%s,%d,%d", currentlyPlayingFile.c_str(), pos, duration);
          }
      }
  }

  void pauseAudio() {
    if (audio.isRunning()) {
      audio.stopSong();
      isPaused = true;
      DBG_PRINTLN("[AUDIO] Paused (returns to start on resume)");
    }
    playbackStarted = false;
  }

  void resumeAudio() {
    if (!isPaused) return;
    if (!ensurePlaylistLoaded() || playlist.empty()) return;
    DBG_PRINTF("[AUDIO] Resuming %s from start\n", playlist[currentTrack].c_str());
    g_audioEngineResetQueued = false;

    // Take exclusive SD for long media playback
    xSemaphoreTake(g_sdStreamGate, portMAX_DELAY);
    g_gateHeldByAudio = true;

    enableSpeaker();
    audio.connecttoFS(SD, playlist[currentTrack].c_str());
    audio.setVolume(currentVolume);
    playbackStarted = true;
    isPaused = false;
  }


  void playCurrentTrack() {
      if (!ensurePlaylistLoaded() || playlist.empty() || currentTrack < 0 || currentTrack >= playlist.size()) {
          DBG_PRINTLN("[playCurrentTrack] Playlist empty or currentTrack invalid!");
          return;
      }
      String filename = playlist[currentTrack];
      if (!filename.startsWith("/media/")) filename = "/media/mp3/" + filename;

      playWavFileOnSpeaker(filename);
      audio.setVolume(currentVolume);
      playbackStarted = true;
      isPaused = false;
  }

  void nextTrack() {
      if (!ensurePlaylistLoaded() || playlist.empty()) return;
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
    if (!ensurePlaylistLoaded() || playlist.empty()) return;
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
    DBG_PRINTF("[VOLUME] %d\n", currentVolume);
  }

  void randomTrack() {
    if (!ensurePlaylistLoaded() || playlist.empty()) return;
    currentTrack = random(0, playlist.size());
    DBG_PRINTF("[RANDOM] %s (Volume: %d)\n", playlist[currentTrack].c_str(), currentVolume);
    playCurrentTrack();
  }

  void nextFolder() {
    if (!ensurePlaylistLoaded() || folderIndex.size() <= 1) {
      DBG_PRINTLN("Only one folder in list.");
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
    DBG_PRINTF("[NEXTFOLDER] Now playing from folder %s\n", mediaFolders[folder]);
    playCurrentTrack();
  }

  void resetESP() {
    DBG_PRINTLN("Resetting ESP32...");
    delay(200);
    ESP.restart();
  }


//-------------------------------------------------------------------------PSRAM VERSION------------------------------------------------------------

  bool loadPlaylistFromIndex(const char* folder) {
      SdLock lock; // 🔒 protect SD card access

      playlist.clear();
      playlistLoaded = false;
      String indexPath = String(folder) + "/.index";
      File idx = SD.open(indexPath);
      if (!idx) {
          DBG_PRINTF("[ERROR] Can't open index: %s\n", indexPath.c_str());
          return false;
      }

      char lineBuf[256]; // Reasonable max line size for filenames
      size_t lineLen = 0;

      while (idx.available()) {
          lineLen = idx.readBytesUntil('\n', lineBuf, sizeof(lineBuf) - 1);
          lineBuf[lineLen] = '\0';

          // Remove trailing CR/LF/spaces/tabs
          while (lineLen > 0 && 
                (lineBuf[lineLen - 1] == '\r' || lineBuf[lineLen - 1] == ' ' || lineBuf[lineLen - 1] == '\t')) {
              lineBuf[--lineLen] = '\0';
          }
          if (lineLen == 0) continue;

          // Find first comma and cut it off
          char* firstComma = strchr(lineBuf, ',');
          if (firstComma) *firstComma = '\0';

          // Trim leading spaces/tabs
          char* fileOnly = lineBuf;
          while (*fileOnly == ' ' || *fileOnly == '\t') ++fileOnly;

          // Trim trailing spaces/tabs
          char* end = fileOnly + strlen(fileOnly) - 1;
          while (end > fileOnly && (*end == ' ' || *end == '\t')) *end-- = '\0';

          // Build full path
          String fullPath;
          if (fileOnly[0] == '/') {
              fullPath = fileOnly;
          } else {
              fullPath.reserve(strlen(folder) + 1 + strlen(fileOnly));
              fullPath = folder;
              if (!fullPath.isEmpty() && fullPath[fullPath.length() - 1] != '/') fullPath += '/';
              fullPath += fileOnly;
          }

          playlist.push_back(fullPath); // PSRAM-friendly push_back
      }

      idx.close();
      currentTrack = 0;
      playlistLoaded = !playlist.empty();
      return playlistLoaded;
  }

  static bool ensurePlaylistLoaded() {
    if (playlistLoaded && !playlist.empty()) return true;
    return loadPlaylistFromIndex(mediaFolders[0]);
  }


//-------------------------------------------------------------------------Firmware OTA-------------------------------------------------------------

  void otaUpdate(){
      // OTA (unchanged)
    ElegantOTA.begin(&server);  // Works with AsyncWebServer
    DBG_PRINTLN("OTA ready: http://<device_ip>/update");
    ElegantOTA.onEnd([](bool success) {
        DBG_PRINTLN("ElegantOTA finished, restarting...");
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

//----------------------------------------------------------------------MEDIA CAPTURE FUNCTIONS-----------------------------------------------------

  // Utility: Get timestamp filename

  #if USE_PSRAM
  std::vector<std::vector<uint8_t, psram_allocator<uint8_t>>, psram_allocator<std::vector<uint8_t, psram_allocator<uint8_t>>>> frameBuffer;
  #else
  std::vector<std::vector<uint8_t>> frameBuffer;
  #endif


  String getMediaTimestamp(const char* prefix, const char* ext) {
      struct timeval tv;
      gettimeofday(&tv, NULL);
      struct tm* tm_info = localtime(&tv.tv_sec);
      char buf[32];
      strftime(buf, sizeof(buf), "%Y%m%d_%H%M%S", tm_info);
      char path[80];
      snprintf(path, sizeof(path), "/media/capture/%s/%s.%s", prefix, buf, ext);
      return String(path);
  }

  void recordVideoTask(void* parameter) {
    const int durationSec = *((int*)parameter);
    delete (int*)parameter;

    // Ensure folder exists
    {
      SdLock lk;
      if (!SD.exists("/media/capture/video")) SD.mkdir("/media/capture/video");
    }

    const String filePath = getMediaTimestamp("video", "mjpeg");

    File f;
    {
      SdLock lk;                                  // lock only while opening
      f = SD.open(filePath, FILE_WRITE);
    }
    if (!f) {
      videoRecording  = false;
      videoTaskActive = false;
      vTaskDelete(NULL);
      return;
    }

    videoRecording  = true;
    videoTaskActive = true;

    static constexpr char BOUNDARY[] =
        "\r\n--123456789000000000000987654321\r\n";

    const unsigned long endTime = millis() + (unsigned long)durationSec * 1000UL;

    while (videoRecording && millis() < endTime) {
      camera_fb_t *fb = esp_camera_fb_get();
      if (fb) {
        // Prepare header outside the lock
        char header[64];
        const int hdrLen = snprintf(header, sizeof(header),
            "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);

        // Do the SD writes under a short lock
        {
          SdLock lk;
          f.write((const uint8_t*)BOUNDARY, sizeof(BOUNDARY) - 1);
          f.write((const uint8_t*)header,   hdrLen);
          f.write(fb->buf, fb->len);
          // Optionally flush every few frames if you want extra safety
          // if ((millis() & 0x1F) == 0) f.flush();
        }

        esp_camera_fb_return(fb);
      }

      // Be cooperative; don't block the system
      vTaskDelay(pdMS_TO_TICKS(90));   // ~10–11 fps
    }

    {
      SdLock lk;                        // lock while closing
      f.close();
    }

    videoRecording  = false;
    videoTaskActive = false;

    // Safe to play the WAV now: SD is free and we’re outside the handler
    playSystemSound("/web/pcm/vreccomplete.wav");

    vTaskDelete(NULL);
  }

//---------------------------------------------------------------DEBUG Helpers for get/set_keymap handlers------------------------------------------

  #ifndef DBG_PRINTF
    #define DBG_PRINTF(...) do { Serial.printf(__VA_ARGS__); } while (0)
  #endif

  // Print current stored keymap from Preferences
  static void dumpKeymapToSerial(const char* tag) {
    DBG_PRINTF("[KEYMAP] %s\n", tag ? tag : "");
    for (size_t i = 0; i < KEYMAP_N; ++i) {
      const char* a = KEYMAP_DEFAULTS[i].action;
      String cur = keymapPrefs.getString(a, KEYMAP_DEFAULTS[i].def);
      DBG_PRINTF("  %-16s = '%s'\n", a, cur.c_str());
    }
  }

  // For POST: tell whether a JSON field name is recognized (snake_case or alias)
  static bool isKnownActionField(const String& field) {
    for (size_t i = 0; i < ACTION_ALIASES_N; ++i) {
      if (field.equalsIgnoreCase(ACTION_ALIASES[i].fw)) return true;
      if (ACTION_ALIASES[i].alias && field.equalsIgnoreCase(ACTION_ALIASES[i].alias)) return true;
    }
    return false;
  }


//---------------------------------------------------------------------------ServerStart------------------------------------------------------------

  static void ensureFullServerRoutes();

  void startLobbyServer() {
    if (lobbyServerStarted) return;

    // Optional: start from a clean Wi-Fi state
    if (WiFi.getMode() != WIFI_OFF) WiFi.mode(WIFI_OFF);
    WiFi.persistent(false);

    // ---- Always boot into AP lobby (AP+STA) ----
    startApLobby();                 // shows AP IP on OLED, sets wifiState = WIFI_AP_LOBBY
    scheduleApSpeechSoon(700);      // optional voice line "AP mode" + IP

    DBG_PRINTLN("🟠 Starting AP mode for setup / UI...");
    DBG_PRINT("AP SSID: "); DBG_PRINTLN(getS3Id());
    DBG_PRINT("AP IP:   "); DBG_PRINTLN(WiFi.softAPIP());

    // Minimal routes to keep lobby light; escalate to full server on demand
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
      ensureFullServerRoutes();
      handleRoot(request);
    });

    server.on("/setup",    HTTP_GET,  handleWiFiSetup);
    server.on("/savewifi", HTTP_POST, handleSaveWiFi);
    server.on("/listwifi", HTTP_GET,  handleListWiFi);
    server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest *request){ request->redirect("/setup"); });
    server.on("/fwlink",       HTTP_GET, [](AsyncWebServerRequest *request){ request->redirect("/setup"); });

    server.onNotFound([](AsyncWebServerRequest* request){
      if (!fullServerStarted) {
        ensureFullServerRoutes();
        request->redirect(request->url());
      } else {
        request->send(404, "text/plain", "Not found");
      }
    });

    server.begin();
    lobbyServerStarted = true;
    DBG_PRINTF("[SERVER] Lobby server started, heap=%u\n", ESP.getFreeHeap());
  }

  static void ensureFullServerRoutes() {
    if (fullServerStarted) return;
    serverStart();
  }

  void serverStart() {
    if (fullServerStarted) return;
    fullServerStarted = true;

    // Optional: start from a clean Wi-Fi state
    if (!lobbyServerStarted && WiFi.getMode() != WIFI_OFF) WiFi.mode(WIFI_OFF);
    WiFi.persistent(false);

    // ---- Always boot into AP lobby (AP+STA) ----
    if (!lobbyServerStarted) {
      startApLobby();                 // shows AP IP on OLED, sets wifiState = WIFI_AP_LOBBY
      scheduleApSpeechSoon(700);      // optional voice line "AP mode" + IP

      DBG_PRINTLN("🟠 Starting AP mode for setup / UI...");
      DBG_PRINT("AP SSID: "); DBG_PRINTLN(getS3Id());
      DBG_PRINT("AP IP:   "); DBG_PRINTLN(WiFi.softAPIP());
    }

    // ---- Core routes ----
    // When escalating from lobby -> full routes, these paths are already present.
    // Avoid duplicate handler objects to save heap.
    if (!lobbyServerStarted) {
      server.on("/", HTTP_GET, handleRoot);

      // Wi-Fi pages / endpoints (keep your route names)
      server.on("/setup",    HTTP_GET,  handleWiFiSetup);
      server.on("/savewifi", HTTP_POST, handleSaveWiFi);
      server.on("/listwifi", HTTP_GET,  handleListWiFi);

      // Captive-portal helpers
      server.on("/generate_204", HTTP_GET, [](AsyncWebServerRequest *request){ request->redirect("/setup"); });
      server.on("/fwlink",       HTTP_GET, [](AsyncWebServerRequest *request){ request->redirect("/setup"); });
    }

    // Favicon
    server.on("/favicon.ico", HTTP_GET, [](AsyncWebServerRequest *request){
      if (SD.exists("/favicon.ico")) request->send(SD, "/favicon.ico", "image/x-icon");
      else                           request->send(404, "text/plain", "favicon.ico not found on SD card");
    });

    // Offline upload fallback (serve at http://<S3_ID>.local/upload)
    server.on("/upload", HTTP_GET, [](AsyncWebServerRequest *request){
      sendUploadFallbackPage(request);
    });
    server.on("/recovery", HTTP_GET, [](AsyncWebServerRequest *request){
      sendRecoveryBrowserPage(request);
    });

    server.on("/fs/list", HTTP_GET, [](AsyncWebServerRequest *request){
      // Default AsyncJsonResponse capacity is small and can truncate larger folder listings.
      auto *resp = new AsyncJsonResponse(false, 8192);
      JsonObject root = resp->getRoot().to<JsonObject>();
      String dirPath = "";
      if (request->hasParam("dir")) dirPath = urlDecode(request->getParam("dir")->value());
      if (dirPath.length()) {
        if (!dirPath.startsWith("/")) dirPath = "/" + dirPath;
        while (dirPath.endsWith("/") && dirPath.length() > 1) dirPath.remove(dirPath.length() - 1);
        if (dirPath != "/" && !pathUnderWeb(dirPath)) {
          root["ok"] = false;
          root["error"] = "path_not_allowed";
          resp->setCode(400);
          resp->setLength();
          request->send(resp);
          return;
        }
        JsonArray entries = root.createNestedArray("entries");
        listSdDirEntries(dirPath, entries);
        root["ok"] = true;
        root["dir"] = dirPath;
      } else {
        JsonArray files = root.createNestedArray("files");
        bool hasWeb = false;
        { SdLock lock; hasWeb = SD.exists("/web"); }
        if (hasWeb) {
          listSdFilesRecursive("/web", files);
        }
        root["ok"] = true;
      }
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    server.on("/fs/mkdir", HTTP_POST, [](AsyncWebServerRequest *request){
      String path = "/web/new_folder";
      if (request->hasParam("path", true))        path = urlDecode(request->getParam("path", true)->value());
      else if (request->hasParam("path", false))  path = urlDecode(request->getParam("path", false)->value());
      if (!path.startsWith("/")) path = "/" + path;
      while (path.endsWith("/") && path.length() > 1) path.remove(path.length() - 1);

      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();
      if (!pathUnderWeb(path)) {
        root["ok"] = false;
        root["error"] = "path_not_allowed";
        resp->setCode(400);
      } else {
        bool ok = false;
        {
          SdLock lock;
          if (SD.exists(path)) ok = true;
          else ok = SD.mkdir(path);
        }
        root["ok"] = ok;
        root["path"] = path;
        if (!ok) {
          root["error"] = "mkdir_failed";
          resp->setCode(500);
        } else {
          resp->setCode(200);
        }
      }
      resp->setLength();
      request->send(resp);
    });

    server.on("/fs/download", HTTP_GET, [](AsyncWebServerRequest *request){
      if (!request->hasParam("path")) {
        request->send(400, "text/plain", "missing_path");
        return;
      }
      String path = urlDecode(request->getParam("path")->value());
      if (!path.startsWith("/")) path = "/" + path;
      if (!pathUnderWeb(path)) {
        request->send(400, "text/plain", "path_not_allowed");
        return;
      }
      sendFileFromSDWithMime(request, path, mimeFor(path), /*asAttachment=*/true);
    });

    server.on("/fs/delete", HTTP_POST, [](AsyncWebServerRequest *request){
      String path = "/web";
      if (request->hasParam("path", true))        path = urlDecode(request->getParam("path", true)->value());
      else if (request->hasParam("path", false))  path = urlDecode(request->getParam("path", false)->value());
      if (!path.startsWith("/")) path = "/" + path;
      while (path.endsWith("/") && path.length() > 1) path.remove(path.length() - 1);

      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!pathUnderWeb(path)) {
        root["ok"] = false;
        root["error"] = "path_not_allowed";
        resp->setCode(400);
      } else {
        bool exists = false;
        {
          SdLock lock;
          exists = SD.exists(path);
        }
        bool ok = exists ? deletePathRecursive(path, path == "/web") : true;
        if (path == "/web") {
          SdLock lock;
          if (!SD.exists("/web")) SD.mkdir("/web");
        }
        root["ok"] = ok;
        if (!ok) {
          root["error"] = "delete_failed";
          resp->setCode(500);
        } else {
          resp->setCode(200);
        }
      }
      resp->setLength();
      request->send(resp);
    });

    server.on("/fs/upload", HTTP_POST,
      [](AsyncWebServerRequest *request){
        auto *ctx = reinterpret_cast<WebUploadCtx*>(request->_tempObject);
        if (ctx) {
          if (ctx->file) {
            SdLock lock;
            ctx->file.close();
          }
          if (ctx->error.length() && ctx->destPath.length()) {
            SdLock lock;
            if (SD.exists(ctx->destPath)) SD.remove(ctx->destPath);
          }
          request->_tempObject = nullptr;
        }

        int code = 200;
        String body = "ok";
        if (ctx && ctx->error.length()) {
          code = 400;
          body = ctx->error;
        }
        delete ctx;
        request->send(code, "text/plain", body);
      },
      [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final){
        WebUploadCtx *ctx = reinterpret_cast<WebUploadCtx*>(request->_tempObject);
        if (!ctx) {
          ctx = new WebUploadCtx();
          request->_tempObject = ctx;
        }

        if (index == 0) {
          String basePath = "/web/";
          if (request->hasParam("path", true))        basePath = urlDecode(request->getParam("path", true)->value());
          else if (request->hasParam("path", false))  basePath = urlDecode(request->getParam("path", false)->value());
          if (!basePath.startsWith("/")) basePath = "/" + basePath;
          if (!basePath.endsWith("/"))   basePath += "/";

          ctx->destPath = basePath + filename;
          if (!pathUnderWeb(ctx->destPath)) {
            ctx->error = "path_not_allowed";
            return;
          }
          ensureFolderExists(ctx->destPath);
          {
            SdLock lock;
            // Replace existing file instead of appending.
            if (SD.exists(ctx->destPath)) SD.remove(ctx->destPath);
            ctx->file = SD.open(ctx->destPath, FILE_WRITE);
            if (!ctx->file) {
              ctx->error = "open_failed";
              return;
            }
          }
        }

        if (ctx->error.length()) {
          if (final && ctx->file) {
            SdLock lock;
            ctx->file.close();
          }
          return;
        }

        if (!ctx->file) return;

        {
          SdLock lock;
          size_t wrote = ctx->file.write(data, len);
          if (wrote != len) {
            ctx->error = "write_failed";
          }
          if (final) {
            ctx->file.close();
          }
        }
      });

    setupRadioBrowserRelay(server);

    // Try-connect endpoint (kept, useful for manual tests)
    // /wifi_try_connect (purely reports status now)
    server.on("/wifi_try_connect", HTTP_POST, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();
      if (request->hasParam("ssid", true)) {
        String ssid = normalizedSSID(request->getParam("ssid", true)->value());
        bool ok = (WiFi.status() == WL_CONNECTED && WiFi.SSID() == ssid);
        root["ok"]   = ok;
        root["ssid"] = ssid;
        if (ok) { root["ip"] = WiFi.localIP().toString(); resp->setCode(200); }
        else    { root["error"] = "not_connected";        resp->setCode(503); }
      } else {
        root["ok"] = false; root["error"] = "missing_ssid";
        resp->setCode(400);
      }
      resp->setLength();
      request->send(resp);
    });

    // /wifi_set_priority (set preferred only; the loop will try it on next scan)
    server.on("/wifi_set_priority", HTTP_POST, [](AsyncWebServerRequest* req){
      if (!req->hasParam("ssid", true)) {
        req->send(400, "application/json", "{\"ok\":false,\"err\":\"ssid required\"}");
        return;
      }
      String ssid = normalizedSSID(req->getParam("ssid", true)->value());
      wifiPrefs.putString("preferred_ssid", ssid);
      req->send(200, "application/json", "{\"ok\":true}");
    });

    // /delete_saved_wifi (no WIFI_LOG_DISC here)
    server.on("/delete_saved_wifi", HTTP_POST, [](AsyncWebServerRequest* req){
      if (!req->hasParam("ssid", true)) {
        req->send(400, "application/json", "{\"ok\":false,\"err\":\"ssid required\"}");
        return;
      }
      String ssid = normalizedSSID(req->getParam("ssid", true)->value());

      wifiPrefs.remove(("wifi_"  + ssid).c_str());
      wifiPrefs.remove(("retry_" + ssid).c_str());
      wifiPrefs.remove(("aRt_"   + ssid).c_str());

      String list = wifiPrefs.getString("networks", "");
      String newList; int last = 0;
      while (true) {
        int next = list.indexOf(',', last);
        String item = normalizedSSID((next == -1) ? list.substring(last) : list.substring(last, next));
        if (item.length() && item != ssid) {
          if (newList.length()) newList += ",";
          newList += item;
        }
        if (next == -1) break;
        last = next + 1;
      }
      wifiPrefs.putString("networks", newList);

      // If currently connected to that SSID, disconnect once (non-blocking)
      if (WiFi.status() == WL_CONNECTED && WiFi.SSID() == ssid) WiFi.disconnect(true, false);

      req->send(200, "application/json", "{\"ok\":true}");
    });


    // Report AP password state
    server.on("/get_ap_password", HTTP_GET, [](AsyncWebServerRequest* req){
      bool isOpen = (g_apPassword.length() == 0);
      String payload = String("{\"ok\":true,\"open\":") + (isOpen ? "true" : "false") +
                      ",\"min\":8,\"max\":63}";
      req->send(200, "application/json", payload);
    });

    // Set AP password (empty => OPEN AP)
    server.on("/set_ap_password", HTTP_POST, [](AsyncWebServerRequest* req){
      if (!req->hasParam("ap_pass", true)) {
        return req->send(400, "application/json", "{\"ok\":false,\"err\":\"missing\"}");
      }
      String pw = req->getParam("ap_pass", true)->value();
      if (!setApPassword(pw)) {
        return req->send(400, "application/json", "{\"ok\":false,\"err\":\"len\"}");
      }
      req->send(200, "application/json", "{\"ok\":true}");
    });

    // /calibrate_imu  (POST)  ->  {"status":"stored", sys, gyro, accel, mag} | {"status":"requested"}
    server.on("/calibrate_imu", HTTP_POST, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      bool stored = imuPrefs.getBool("stored", false);
      int sys=imuPrefs.getInt("sys",-1), gyro=imuPrefs.getInt("gyro",-1),
          accel=imuPrefs.getInt("accel",-1), mag=imuPrefs.getInt("mag",-1);

      if (stored && sys>=0 && gyro>=0 && accel>=0 && mag>=0) {
        root["status"]="stored"; root["sys"]=sys; root["gyro"]=gyro; root["accel"]=accel; root["mag"]=mag;
      } else {
        root["status"]="requested";
      }
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // /get_calibration  (GET)  ->  {"sys":..., "gyro":..., "accel":..., "mag":..., "stored":bool}
    server.on("/get_calibration", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      bool stored = imuPrefs.getBool("stored", false);
      int sys=imuPrefs.getInt("sys",-1), gyro=imuPrefs.getInt("gyro",-1),
          accel=imuPrefs.getInt("accel",-1), mag=imuPrefs.getInt("mag",-1);

      if (stored && sys>=0 && gyro>=0 && accel>=0 && mag>=0) {
        root["sys"]=sys; root["gyro"]=gyro; root["accel"]=accel; root["mag"]=mag; root["stored"]=true;
      } else {
        root["sys"]=0; root["gyro"]=0; root["accel"]=0; root["mag"]=0; root["stored"]=false;
      }
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // GET /get_keymap
    server.on("/get_keymap", HTTP_GET, [](AsyncWebServerRequest* request){
      auto* resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot().to<JsonObject>();

      // Build response
      for (size_t i = 0; i < KEYMAP_N; ++i) {
        const char* k = KEYMAP_DEFAULTS[i].action;
        String v = keymapPrefs.getString(k, KEYMAP_DEFAULTS[i].def);
        root[k] = v;  // normalized ("arrowup", " ")
      }

      // Log the JSON we are about to send
      String out; serializeJson(root, out);
      DBG_PRINTF("[/get_keymap] response: %s\n", out.c_str());

      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---- POST /set_keymap ----
    {
      auto* h = new AsyncCallbackJsonWebHandler("/set_keymap",
        [](AsyncWebServerRequest* request, JsonVariant& json){
          auto* out = new AsyncJsonResponse();
          JsonObject root = out->getRoot().to<JsonObject>();

          if (!json.is<JsonObject>()) {
            root["error"] = "object json expected";
            out->setCode(400); out->setLength(); request->send(out); return;
          }

          JsonObject obj = json.as<JsonObject>();

          // Log raw payload
          String in; serializeJson(obj, in);
          DBG_PRINTF("[/set_keymap] payload: %s\n", in.c_str());

          // Log all fields we received and flag unknowns
          for (JsonPair kv : obj) {
            String k = kv.key().c_str();
            String v = kv.value().as<String>();
            DBG_PRINTF("    recv field '%s' = '%s'%s\n",
              k.c_str(), v.c_str(), isKnownActionField(k) ? "" : "  (UNKNOWN)");
          }

          size_t updated = 0;

          // Accept both firmware snake_case and UI camelCase aliases
          for (size_t i = 0; i < ACTION_ALIASES_N; ++i) {
            const char* fw    = ACTION_ALIASES[i].fw;
            const char* alias = ACTION_ALIASES[i].alias;

            String raw; const char* used = nullptr;
            if (obj.containsKey(fw))         { raw = obj[fw].as<String>(); used = fw; }
            else if (alias && obj.containsKey(alias)) { raw = obj[alias].as<String>(); used = alias; }
            else continue;

            String norm = normKeyToken(raw);     // "ArrowUp"->"arrowup", "Space"->" ", "E"->"e"
            DBG_PRINTF("    apply %-16s from '%s': '%s' -> '%s'\n",
                      fw, used, raw.c_str(), norm.c_str());

            keymapPrefs.putString(fw, norm);
            ++updated;
          }

          if (updated == 0) {
            DBG_PRINTF("[/set_keymap] WARNING: no fields matched known actions (updated=0)\n");
          }

          // Dump what is now stored after writes
          dumpKeymapToSerial("after set_keymap");

          root["status"]  = "ok";
          root["updated"] = (int)updated;
          out->setCode(200); out->setLength(); request->send(out);
        });
      h->setMethod(HTTP_POST);
      h->setMaxContentLength(1024);
      server.addHandler(h);

      wsCarInput.textAll("KEYMAP_UPDATED");
    }

    // POST /reset_keymap
    server.on("/reset_keymap", HTTP_POST, [](AsyncWebServerRequest* request){
      keymapResetDefaults();
      auto* ok = new AsyncJsonResponse(); ok->getRoot()["status"]="ok";
      ok->setCode(200); ok->setLength(); request->send(ok);
    });

    // GET /get_joymap
    server.on("/get_joymap", HTTP_GET, [](AsyncWebServerRequest* request){
      auto* resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot().to<JsonObject>();
      joymapLoadToJson(root);
      resp->setCode(200); resp->setLength(); request->send(resp);
    });

    // POST /set_joymap   body: {"forward":"DPAD_UP","horn":"A",...}
    {
      auto* h = new AsyncCallbackJsonWebHandler("/set_joymap",
        [](AsyncWebServerRequest* request, JsonVariant& json){
          auto* out = new AsyncJsonResponse();
          JsonObject root = out->getRoot().to<JsonObject>();

          if (!json.is<JsonObject>()) {
            root["ok"] = false; root["error"]="object json expected";
            out->setCode(400); out->setLength(); request->send(out); return;
          }

          JsonObject obj = json.as<JsonObject>();
          size_t updated = 0;

          for (JsonPair kv : obj) {
            String fw = aliasToFw(String(kv.key().c_str()));   // accept UI alias or fw key
            // Only accept known action keys from JOYMAP_DEFAULTS
            bool known = false;
            for (size_t i=0;i<JOYMAP_N;++i)
              if (fw.equalsIgnoreCase(JOYMAP_DEFAULTS[i].action)) { known = true; break; }
            if (!known) continue;

            String btn = normJoyBtn(kv.value().as<String>());
            joymapPrefs.putString(fw.c_str(), btn);
            ++updated;
            DBG_PRINTF("[set_joymap] %-16s <- '%s'\n", fw.c_str(), btn.c_str());
          }

          rebuildJoyActionCache();   // <-- take effect immediately

          root["ok"] = true;
          root["updated"] = (int)updated;
          out->setCode(200); out->setLength(); request->send(out);
        });

      h->setMethod(HTTP_POST);
      h->setMaxContentLength(1024);
      server.addHandler(h);
    }

    // POST /reset_joymap
    server.on("/reset_joymap", HTTP_POST, [](AsyncWebServerRequest* request){
      joymapResetDefaults();
      rebuildJoyActionCache();   // <-- keep runtime in sync
      auto* ok = new AsyncJsonResponse(); ok->getRoot()["ok"]=true;
      ok->setCode(200); ok->setLength(); request->send(ok);
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

    // ---------- /version (GET) ----------
    server.on("/version", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      resp->getRoot()["current"] = FIRMWARE_VERSION;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /serial/logs (GET) ----------
    server.on("/serial/logs", HTTP_GET, [](AsyncWebServerRequest *request){
      auto* resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot().to<JsonObject>();
      JsonArray lines = root.createNestedArray("lines");
      const size_t cap = serialLogActiveCapacity();
      const size_t start = (serialLogHead + cap - serialLogCount) % cap;
      for (size_t i = 0; i < serialLogCount; ++i) {
        const size_t idx = (start + i) % cap;
        if (serialLogRing) lines.add(serialLogSlot(idx));
      }
      root["count"] = (int)serialLogCount;
      root["ok"] = true;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /serial/command (POST|GET) ----------
    server.on("/serial/command", HTTP_ANY, [](AsyncWebServerRequest *request){
      String cmd;
      if (request->hasParam("cmd", true)) cmd = request->getParam("cmd", true)->value();
      else if (request->hasParam("cmd")) cmd = request->getParam("cmd")->value();

      auto* resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot().to<JsonObject>();
      if (cmd.isEmpty()) {
        root["ok"] = false;
        root["error"] = "missing_cmd";
        resp->setCode(400);
      } else {
        serialLogPushLine(String("> ") + cmd, true);
        executeSerialCommand(cmd);
        root["ok"] = true;
      }
      resp->setLength();
      request->send(resp);
    });

    // ---------- /ota/latest (GET) ----------
    // Device-side GitHub latest release lookup for browser fallback.
    server.on("/ota/latest", HTTP_GET, [](AsyncWebServerRequest *request){
      auto* resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot().to<JsonObject>();
      root["ok"] = false;
      root["repo"] = "elik745i/miniexco.v2";

      int ghStatus = -1;
      const String body = httpsGet("https://api.github.com/repos/elik745i/miniexco.v2/releases/latest", &ghStatus);
      if (body.isEmpty()) {
        root["error"] = "github_fetch_failed";
        root["http_status"] = ghStatus;
        resp->setCode(502);
        resp->setLength();
        request->send(resp);
        return;
      }

      DynamicJsonDocument filter(512);
      filter["tag_name"] = true;
      filter["assets"][0]["name"] = true;
      filter["assets"][0]["browser_download_url"] = true;

      DynamicJsonDocument doc(12288);
      const DeserializationError err = deserializeJson(doc, body, DeserializationOption::Filter(filter));
      if (err) {
        root["error"] = "json_parse_failed";
        root["detail"] = err.c_str();
        root["http_status"] = ghStatus;
        resp->setCode(500);
        resp->setLength();
        request->send(resp);
        return;
      }

      const String tagName = doc["tag_name"] | "";
      String binUrl;
      JsonArray assets = doc["assets"].as<JsonArray>();
      for (JsonObject a : assets) {
        const String n = a["name"] | "";
        const String u = a["browser_download_url"] | "";
        if (u.isEmpty()) continue;
        if (n.endsWith(".ino.bin")) {
          binUrl = u;
          break;
        }
      }
      if (binUrl.isEmpty()) {
        for (JsonObject a : assets) {
          const String n = a["name"] | "";
          const String u = a["browser_download_url"] | "";
          if (u.isEmpty()) continue;
          if (n.endsWith(".bin") && n.indexOf("bootloader") < 0 && n.indexOf("partitions") < 0) {
            binUrl = u;
            break;
          }
        }
      }

      if (tagName.isEmpty() || binUrl.isEmpty()) {
        root["error"] = "release_asset_not_found";
        root["http_status"] = ghStatus;
        resp->setCode(500);
        resp->setLength();
        request->send(resp);
        return;
      }

      root["ok"] = true;
      root["tag_name"] = tagName;
      root["bin_url"] = binUrl;
      root["source"] = "device";
      root["http_status"] = ghStatus;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /ota/update_from_url (POST/GET) ----------
    // Device-side OTA downloader so updates can work even if browser can't reach GitHub.
    server.on("/ota/update_from_url", HTTP_ANY, [](AsyncWebServerRequest *request){
      String url;
      if (request->hasParam("url", true)) {
        url = request->getParam("url", true)->value();
      } else if (request->hasParam("url")) {
        url = request->getParam("url")->value();
      }

      auto* resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot().to<JsonObject>();
      root["ok"] = false;

      if (url.isEmpty()) {
        root["error"] = "missing_url";
        resp->setCode(400);
        resp->setLength();
        request->send(resp);
        return;
      }

      String otaErr;
      const bool ok = otaDownloadAndApplyFromUrl(url, otaErr);
      if (!ok) {
        root["error"] = otaErr;
        resp->setCode(500);
        resp->setLength();
        request->send(resp);
        return;
      }

      root["ok"] = true;
      root["rebooting"] = true;
      root["message"] = "OTA applied, reboot scheduled";
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
      shouldReboot = true;
    });

    // ---------- /list_saved_wifi (GET) ----------
    // Returns: [ { ssid, password, retry, autoReconnect, preferred }, ... ]
    server.on("/list_saved_wifi", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonArray arr = resp->getRoot().to<JsonArray>();

      const String pref = wifiPrefs.getString("preferred_ssid", "");
      bool prefExistsInList = false;

      String savedList = wifiPrefs.getString("networks", "");
      int last = 0;
      while (true) {
        int next = savedList.indexOf(',', last);
        String ssid = (next == -1) ? savedList.substring(last) : savedList.substring(last, next);
        ssid = normalizedSSID(ssid);

        if (ssid.length()) {
          String wifiKey = "wifi_" + ssid;
          String pass    = wifiPrefs.getString(wifiKey.c_str(), "");
          int    retry   = wifiPrefs.getInt(("retry_" + ssid).c_str(), 5);
          bool   autoRec = wifiPrefs.getBool(("aRt_" + ssid).c_str(), false);

          JsonObject it = arr.createNestedObject();
          it["ssid"]          = ssid;
          it["password"]      = pass;
          it["retry"]         = retry;
          it["autoReconnect"] = autoRec;

          bool isPreferred = (ssid == pref);
          it["preferred"] = isPreferred;         // <-- NEW

          if (isPreferred) prefExistsInList = true;
        }

        if (next == -1) break;
        last = next + 1;
      }

      // If a preferred SSID is set but no longer saved, clear the preference
      if (pref.length() && !prefExistsInList) {
        wifiPrefs.remove("preferred_ssid");
      }

      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });


    // ---------- /wifi_set_autoreconnect (POST, form/query params) ----------
    server.on("/wifi_set_autoreconnect", HTTP_POST, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (request->hasParam("ssid", true) && request->hasParam("enabled", true)) {
        String ssid = normalizedSSID(request->getParam("ssid", true)->value());
        String enabledStr = request->getParam("enabled", true)->value();
        bool enabled = (enabledStr == "1" || enabledStr == "true");
        String key = "aRt_" + ssid;
        wifiPrefs.putBool(key.c_str(), enabled);
        bool verify = wifiPrefs.getBool(key.c_str(), !enabled);
        root["ok"]=(verify==enabled); root["ssid"]=ssid; root["enabled"]=enabled; root["verified"]=(verify==enabled);
        resp->setCode((verify==enabled)?200:500);
      } else {
        root["ok"]=false; root["error"]="missing_params";
        resp->setCode(400);
      }
      resp->setLength();
      request->send(resp);
    });

    // ---------- /update_wifi_password (GET, query params) ----------
    server.on("/update_wifi_password", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (request->hasParam("ssid") && request->hasParam("password")) {
        String ssid = normalizedSSID(request->getParam("ssid")->value());
        String password = request->getParam("password")->value();
        String wifiKey = "wifi_" + ssid;
        bool ok = wifiPrefs.putString(wifiKey.c_str(), password);
        root["ok"]=ok; root["ssid"]=ssid; root["saved"]=ok;
        resp->setCode(ok?200:500);
      } else {
        root["ok"]=false; root["error"]="missing_params";
        resp->setCode(400);
      }
      resp->setLength();
      request->send(resp);
    });

    // ---------- /connect_saved_wifi (GET -> JSON) ----------
    server.on("/connect_saved_wifi", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("ssid")) {
        root["ok"]=false; root["error"]="missing_ssid";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }

      String ssid = normalizedSSID(request->getParam("ssid")->value());
      String pass = wifiPrefs.getString(("wifi_" + ssid).c_str(), "");
      if (pass == "") {
        root["ok"]=false; root["error"]="ssid_not_found"; root["ssid"]=ssid;
        resp->setCode(404); resp->setLength(); request->send(resp); return;
      }

      wifiPrefs.putString("ssid", ssid);
      wifiPrefs.putString("password", pass);

      DBG_PRINTLN("🔄 Switching to saved Wi-Fi: " + ssid);
      stopWebServerAndWS();
      delay(300);
      connectToWiFiWithRetries(ssid, pass, wifiRetryCount);
      wifiSSID = ssid; wifiPassword = pass; wifiConnecting = true; wifiConnectStartTime = millis();

      root["ok"]=true; root["ssid"]=ssid; root["status"]="switching";
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /update_retry_count (GET -> JSON) ----------
    server.on("/update_retry_count", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!(request->hasParam("ssid") && request->hasParam("count"))) {
        root["ok"]=false; root["error"]="missing_params";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }

      String ssid = normalizedSSID(request->getParam("ssid")->value());
      int count = request->getParam("count")->value().toInt();
      if (count < 1 || count > 10) {
        root["ok"]=false; root["error"]="invalid_range"; root["min"]=1; root["max"]=10;
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }

      bool ok = wifiPrefs.putInt(("retry_" + ssid).c_str(), count);
      root["ok"]=ok; root["ssid"]=ssid; root["count"]=count;
      resp->setCode(ok?200:500);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /setsettings (POST JSON -> apply + save) ----------
    {
      auto *setSettings = new AsyncCallbackJsonWebHandler(
        "/setsettings",
        [](AsyncWebServerRequest *request, JsonVariant &json){
          if (!json.is<JsonObject>()) {
            auto *err = new AsyncJsonResponse();
            err->getRoot()["error"] = "Invalid JSON (object expected)";
            err->setCode(400); err->setLength(); request->send(err); return;
          }
          JsonObject obj = json.as<JsonObject>();

          // SAVE: persist ints & bools to camPrefs.
          // (OK to omit camPrefs.begin/end here if you've already begun("camera") in setup())
          for (JsonPair kv : obj) {
            const char* key = kv.key().c_str();
            JsonVariant v = kv.value();
            // normalize any type to int-ish for booleans too
            if (strcmp(key, "auto_res") == 0) {
              camPrefs.putBool("auto_res", v.as<int>() != 0);
            } else if (strcmp(key, "adaptive_q") == 0) {
              camPrefs.putBool("adaptive_q", v.as<int>() != 0);
            } else if (v.is<int>()) {
              camPrefs.putInt(key, v.as<int>());
            }
            // (add putString if you ever send strings)
          }

          // APPLY: use stream-safe update for res/quality; direct setters for others
          sensor_t *s = esp_camera_sensor_get();
          if (s) {
            auto getI = [&](const char* k, int def=0){ return obj.containsKey(k) ? obj[k].as<int>() : def; };

            if (obj.containsKey("res") || obj.containsKey("quality")) {
              framesize_t fs = (framesize_t)(obj.containsKey("res") ? obj["res"].as<int>() : s->status.framesize);
              int q = obj.containsKey("quality") ? obj["quality"].as<int>() : s->status.quality;
              requestCameraParams(fs, q);               // <-- stream-safe apply
            }

          // DO NOT set framesize/quality directly here (avoid double-applying)
          if (obj.containsKey("contrast"))       s->set_contrast(s, getI("contrast"));
          if (obj.containsKey("brightness"))     s->set_brightness(s, getI("brightness"));
          if (obj.containsKey("saturation"))     s->set_saturation(s, getI("saturation"));
          if (obj.containsKey("gray"))           s->set_special_effect(s, getI("gray") ? 2 : 0);
            if (obj.containsKey("hmirror"))        s->set_hmirror(s, getI("hmirror"));
            if (obj.containsKey("vflip"))          s->set_vflip(s, getI("vflip"));
            if (obj.containsKey("awb"))            s->set_whitebal(s, getI("awb"));
            if (obj.containsKey("wb_mode"))        s->set_wb_mode(s, getI("wb_mode"));
            if (obj.containsKey("aec"))            s->set_exposure_ctrl(s, getI("aec"));
            if (obj.containsKey("ae_level"))       s->set_ae_level(s, getI("ae_level"));
            if (obj.containsKey("aec_value"))      s->set_aec_value(s, getI("aec_value"));
            if (obj.containsKey("agc"))            s->set_gain_ctrl(s, getI("agc"));
            if (obj.containsKey("agc_gain"))       s->set_agc_gain(s, getI("agc_gain"));
            if (obj.containsKey("gainceiling"))    s->set_gainceiling(s, (gainceiling_t)getI("gainceiling"));
            if (obj.containsKey("awb_gain"))       s->set_awb_gain(s, getI("awb_gain"));
            if (obj.containsKey("colorbar"))       s->set_colorbar(s, getI("colorbar"));
            if (obj.containsKey("lenc"))           s->set_lenc(s, getI("lenc"));
            if (obj.containsKey("bpc"))            s->set_bpc(s, getI("bpc"));
            if (obj.containsKey("wpc"))            s->set_wpc(s, getI("wpc"));
            if (obj.containsKey("dcw"))            s->set_dcw(s, getI("dcw"));
            if (obj.containsKey("raw_gma"))        s->set_raw_gma(s, getI("raw_gma"));
            if (obj.containsKey("special_effect")) s->set_special_effect(s, getI("special_effect"));
          }

          // Set LIVE flags immediately (so toggles take effect now), then kick
          if (obj.containsKey("auto_res"))   allowFsAuto      = obj["auto_res"].as<int>() != 0;
          if (obj.containsKey("adaptive_q")) adaptiveQEnabled = obj["adaptive_q"].as<int>() != 0;
          adaptiveKickNow();

          // Auto-resume streaming after settings apply if camera is enabled
          appHttpdResumeStreaming();

          playSystemSound("/web/pcm/click.wav");

          auto *ok = new AsyncJsonResponse();
          ok->getRoot()["status"] = "saved";
          ok->setCode(200);
          ok->setLength();
          request->send(ok);
        }
      );
      setSettings->setMethod(HTTP_POST);
      setSettings->setMaxContentLength(2048);
      server.addHandler(setSettings);
    }

    // ---------- /getsettings (GET) ----------
    server.on("/getsettings", HTTP_GET, [](AsyncWebServerRequest *request) {
      // Build JSON in RAM, then send with a known Content-Length (no chunked)
      DynamicJsonDocument doc(1536);
      JsonObject root = doc.to<JsonObject>();

      // Camera block
      const char* modelName = "Unknown";
      sensor_t* s = esp_camera_sensor_get();
      if (s) {
        switch (s->id.PID) {
          case OV2640_PID: modelName = "OV2640"; break;
          case OV3660_PID: modelName = "OV3660"; break;
          case OV5640_PID: modelName = "OV5640"; break;
          case GC2145_PID: modelName = "GC2145"; break;
          default:         modelName = "Unknown"; break;
        }
        root["model"]          = modelName;
        root["res"]            = (int)s->status.framesize;
        root["quality"]        = (int)s->status.quality;
        root["contrast"]       = (int)s->status.contrast;
        root["brightness"]     = (int)s->status.brightness;
        root["saturation"]     = (int)s->status.saturation;
        root["gray"]           = (int)(s->status.special_effect == 2 ? 1 : 0);
        root["hmirror"]        = (int)s->status.hmirror;
        root["vflip"]          = (int)s->status.vflip;
        root["awb"]            = (int)s->status.awb;
        root["wb_mode"]        = (int)s->status.wb_mode;
        root["aec"]            = (int)s->status.aec;
        root["ae_level"]       = (int)s->status.ae_level;
        root["aec_value"]      = (int)s->status.aec_value;
        root["agc"]            = (int)s->status.agc;
        root["agc_gain"]       = (int)s->status.agc_gain;
        root["gainceiling"]    = (int)s->status.gainceiling;
        root["awb_gain"]       = (int)s->status.awb_gain;
        root["colorbar"]       = (int)s->status.colorbar;
        root["lenc"]           = (int)s->status.lenc;
        root["bpc"]            = (int)s->status.bpc;
        root["wpc"]            = (int)s->status.wpc;
        root["dcw"]            = (int)s->status.dcw;
        root["raw_gma"]        = (int)s->status.raw_gma;
        root["special_effect"] = (int)s->status.special_effect;
      } else {
        root["model"] = modelName;
      }

      // UI / app flags (assumes these globals exist)
      root["darkMode"]         = (int)(darkMode ? 1 : 0);
      root["holdBucket"]       = (int)(holdBucket ? 1 : 0);
      root["holdAux"]          = (int)(holdAux ? 1 : 0);
      root["horizontalScreen"] = (int)(horScreen ? 1 : 0);
      root["RecordTelemetry"]  = (int)(tlmEnabled ? 1 : 0);
      root["SystemSounds"]     = (int)(sSndEnabled ? 1 : 0);
      root["WsRebootOnDisconnect"] = (int)(wsRebootOnDisconnect ? 1 : 0);
      root["BluepadEnabled"] = (int)(bluepadEnabled ? 1 : 0);
      root["SystemVolume"]     = (int)sSndVolume;
      root["ModelRotX"]        = modelRotXDeg;
      root["ModelRotY"]        = modelRotYDeg;
      root["ModelRotZ"]        = modelRotZDeg;
      root["ModelDirX"]        = modelDirX;
      root["ModelDirY"]        = modelDirY;
      root["ModelDirZ"]        = modelDirZ;
      root["ModelAxisX"]       = modelAxisX;
      root["ModelAxisY"]       = modelAxisY;
      root["ModelAxisZ"]       = modelAxisZ;
      root["TelemetryMaxKB"]   = telemetryFileMaxKB;
      root["SerialLogRateMs"]  = serialLogWsMinIntervalMs;
      root["SerialLogKeepLines"]  = serialLogRetainLines;
      root["IndicatorsVisible"] = (int)(indicatorsVisible ? 1 : 0);
      root["IndicatorsX"]      = indicatorsPosX;
      root["IndicatorsY"]      = indicatorsPosY;
      root["ImuVisible"]       = (int)(imuVisible ? 1 : 0);
      root["ImuX"]             = imuPosX;
      root["ImuY"]             = imuPosY;
      root["MediaVisible"]     = (int)(mediaVisible ? 1 : 0);
      root["MediaX"]           = mediaPosX;
      root["MediaY"]           = mediaPosY;
      root["PathVisible"]      = (int)(pathVisible ? 1 : 0);
      root["PathX"]            = pathPosX;
      root["PathY"]            = pathPosY;
      root["Model3DVisible"]   = (int)(model3dVisible ? 1 : 0);
      root["Model3DX"]         = model3dPosX;
      root["Model3DY"]         = model3dPosY;
      root["ViewOverlapFx"]    = (int)(viewOverlapFxEnabled ? 1 : 0);
      root["ViewSnapFx"]       = (int)(viewSnapFxEnabled ? 1 : 0);
      root["ViewGravityFx"]    = (int)(viewGravityFxEnabled ? 1 : 0);
      root["ViewGravityStr"]   = viewGravityFxStrength;

      // NEW: controller toggles from prefs
      root["auto_res"]   = (int)camPrefs.getBool("auto_res", 0); // default OFF
      root["adaptive_q"] = (int)camPrefs.getBool("adaptive_q", 1); // default ON

      String payload;
      serializeJson(doc, payload);

      AsyncWebServerResponse *resp = request->beginResponse(200, "application/json", payload);
      resp->addHeader("Cache-Control", "no-store");
      request->send(resp);
    });


    // ---------- /list_sd_files (GET -> JSON, chunked) ----------
    server.on("/list_sd_files", HTTP_GET, [](AsyncWebServerRequest *request) {
      DBG_PRINTLN("📁 /list_sd_files requested (INDEX)");

      int start = request->hasParam("start") ? request->getParam("start")->value().toInt() : 0;
      int count = request->hasParam("count") ? request->getParam("count")->value().toInt() : 40;
      if (count < 1 || count > 256) count = 40;

      String path = request->hasParam("path") ? request->getParam("path")->value() : "/";
      if (!path.startsWith("/")) path = "/" + path;
      if (path.endsWith("/") && path.length() > 1) path.remove(path.length() - 1);

      bool showSystem = request->hasParam("showSystem") && (request->getParam("showSystem")->value().toInt() != 0);

      // /telemetry is actively written, so .index gets stale quickly.
      // For this folder, return live directory metadata (size/date) with pagination.
      if (path == "/telemetry") {
        auto *resp = new AsyncJsonResponse(false, 8192);
        JsonArray arr = resp->getRoot().to<JsonArray>();

        int visibleSeen = 0;
        int added = 0;

        {
          SdLock lk;
          File dir = SD.open(path);
          if (dir && dir.isDirectory()) {
            File f = dir.openNextFile();
            while (f) {
              String name = f.name();
              bool isFolder = f.isDirectory();
              uint32_t size = isFolder ? 0 : (uint32_t)f.size();
              uint32_t date = (uint32_t)f.getLastWrite();

              int slash = name.lastIndexOf('/');
              if (slash >= 0) name = name.substring(slash + 1);

              bool skip = (!showSystem && (
                name.endsWith(".path") ||
                name.endsWith(".bak")  ||
                name.endsWith(".meta") ||
                name.startsWith(".")   ||
                name.startsWith(".csv")||
                name.equalsIgnoreCase("System Volume Information") ||
                name.startsWith("FOUND.") ||
                name == "Thumbs.db"
              ));

              if (!skip) {
                if (visibleSeen++ >= start && added < count) {
                  JsonObject obj = arr.createNestedObject();
                  obj["name"] = name;
                  obj["isFolder"] = isFolder;
                  if (!isFolder) obj["size"] = size;
                  obj["type"] = isFolder ? "folder" : "default";
                  if (date > 0) obj["date"] = (uint64_t)date * 1000ULL;
                  added++;
                }
              }

              f.close();
              if (added >= count) break;
              f = dir.openNextFile();
            }
            dir.close();
          }
        }

        resp->setCode(200);
        resp->setLength();
        request->send(resp);
        return;
      }

      // -- If folder doesn't exist: return []
      {
        SdLock lk;
        if (!SD.exists(path)) {
          auto *resp = new AsyncJsonResponse(false, 8192);      // array
          resp->getRoot().to<JsonArray>();                // []
          resp->setCode(200);
          resp->setLength();
          request->send(resp);
          return;
        }
      }

      // -- If index missing OR reindex pending
      bool needIndex = false;
      {
        SdLock lk;
        needIndex = (!SD.exists(path + "/.index") || pendingReindex);
      }
      if (needIndex) {
        bool isEmpty = false;
        {
          SdLock lk;
          File dir = SD.open(path);
          if (dir && dir.isDirectory()) {
            File f = dir.openNextFile();
            if (!f) isEmpty = true;
            else f.close();
            dir.close();
          }
        }

        if (isEmpty) {
          auto *resp = new AsyncJsonResponse(false, 8192);      // array
          resp->getRoot().to<JsonArray>();                // []
          resp->setCode(200);
          resp->setLength();
          request->send(resp);
          return;
        }

        if (!pendingReindex) {
          reindexPath  = path;
          pendingReindex = true;
          reindexCount  = 0;
        }

        auto *resp = new AsyncJsonResponse();             // object
        resp->getRoot()["status"] = "reindexing";
        resp->setCode(202);
        resp->setLength();
        request->send(resp);
        return;
      }

      // -- Index exists: read a page
      auto *resp = new AsyncJsonResponse(false, 8192);   // array
      JsonArray arr = resp->getRoot().to<JsonArray>();

      // readSdIndexBatch() already locks & yields
      readSdIndexBatch(path + "/.index", start, count, arr, showSystem);

      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });


    // ---------- /sd_reindex (POST -> JSON) ----------
    server.on("/sd_reindex", HTTP_POST, [](AsyncWebServerRequest *request){
      String path = "/";

      // accept ?path=... (query) or body param
      if (request->hasParam("path", true))        path = urlDecode(request->getParam("path", true)->value());
      else if (request->hasParam("path", false))  path = urlDecode(request->getParam("path", false)->value());
      if (!path.startsWith("/")) path = "/" + path;
      while (path.indexOf("//") >= 0) path.replace("//","/");
      if (path.endsWith("/") && path.length() > 1) path.remove(path.length()-1);

      AsyncJsonResponse *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      // 404 if path doesn't exist
      {
        SdLock lock;
        if (!SD.exists(path)) {
          root["ok"]    = false;
          root["error"] = "not_found";
          root["path"]  = path;
          resp->setCode(404);
          resp->setLength();
          request->send(resp);
          return;
        }
      }

      if (pendingReindex) {
        root["ok"]    = false;
        root["error"] = "already_in_progress";
        root["path"]  = path;
        resp->setCode(409);
        resp->setLength();
        request->send(resp);
        return;
      }

      // kick off background reindex (your loop/task should consume these)
      reindexPath      = path;
      pendingReindex   = true;
      reindexCount     = 0;          // how many files processed so far
      reindexTotal     = 0;          // optional: fill later when you count
      reindexCounting  = true;       // optional flag if you use it

      root["ok"]     = true;
      root["status"] = "started";
      root["path"]   = path;
      resp->setCode(202);
      resp->setLength();             // ← required
      request->send(resp);
    });

    // ---------- /sd_reindex_status (GET -> JSON) ----------
    server.on("/sd_reindex_status", HTTP_GET, [](AsyncWebServerRequest *request){
      AsyncJsonResponse *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      root["pending"]  = pendingReindex;
      root["path"]     = String(reindexPath);
      root["count"]    = reindexCount;
      root["total"]    = reindexTotal;
      root["counting"] = reindexCounting;

      resp->setCode(200);
      resp->setLength();             // ← required
      request->send(resp);
    });

    // ---------- /sd_info (GET -> JSON) ----------
    server.on("/sd_info", HTTP_GET, [](AsyncWebServerRequest *request){
        uint64_t total = SD.totalBytes();
        uint64_t used = SD.usedBytes();
        uint64_t free = total - used;

        String json = "{\"total\":" + String(total) +
                      ",\"used\":" + String(used) +
                      ",\"free\":" + String(free) + "}";
        request->send(200, "application/json", json);
    });

    // ---------- /download_sd (GET -> file download) ----------
    server.on("/download_sd", HTTP_GET, [](AsyncWebServerRequest *request){
      if (!request->hasParam("path")) {
        auto *resp = new AsyncJsonResponse();
        resp->getRoot()["error"] = "missing_path";
        resp->setCode(400);
        resp->setLength();
        request->send(resp);
        return;
      }
      String path = urlDecode(request->getParam("path")->value());
      if (!path.startsWith("/")) path = "/" + path;

      {
        SdLock lock;
        if (!SD.exists(path)) {
          auto *resp = new AsyncJsonResponse();
          resp->getRoot()["error"] = "not_found";
          resp->getRoot()["path"]  = path;
          resp->setCode(404);
          resp->setLength();
          request->send(resp);
          return;
        }
      }
      sendFileFromSDWithMime(request, path, mimeFor(path), /*asAttachment=*/true); // attachment
    });

    // ---------- /play_radio (GET -> queue remote stream on device) ----------
    server.on("/play_radio", HTTP_GET, [](AsyncWebServerRequest *request){
      if (!request->hasParam("url")) {
        auto *resp = new AsyncJsonResponse();
        resp->getRoot()["ok"] = false;
        resp->getRoot()["error"] = "missing_url";
        resp->setCode(400);
        resp->setLength();
        request->send(resp);
        return;
      }

      String url = urlDecode(request->getParam("url")->value());
      url.trim();
      if (!url.length()) {
        auto *resp = new AsyncJsonResponse();
        resp->getRoot()["ok"] = false;
        resp->getRoot()["error"] = "invalid_url";
        resp->setCode(400);
        resp->setLength();
        request->send(resp);
        return;
      }

      queueRadioPlay(url.c_str());

      auto *resp = new AsyncJsonResponse();
      resp->getRoot()["ok"] = true;
      resp->getRoot()["queued"] = true;
      resp->getRoot()["url"] = url;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /recover_sd (GET -> JSON) ----------
    server.on("/recover_sd", HTTP_GET, [](AsyncWebServerRequest *request) {
      SdLock lock;

      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("name")) {
        root["ok"] = false; root["error"] = "missing_name";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }

      String name = urlDecode(request->getParam("name")->value());
      String recycleFile = "/recycle/" + name;
      String pathFile    = recycleFile + ".path";
      String dst         = "/" + name;

      if (SD.exists(pathFile)) {
        File f = SD.open(pathFile, FILE_READ);
        if (f) { String orig = f.readString(); f.close(); orig.trim(); if (orig.startsWith("/")) dst = orig; }
      }

      if (SD.exists(dst)) {
        root["ok"] = false; root["error"] = "dest_exists"; root["dest"] = dst;
        resp->setCode(409); resp->setLength(); request->send(resp); return;
      }

      int lastSlash = dst.lastIndexOf('/');
      if (lastSlash > 0) {
        String folderPath = dst.substring(0, lastSlash);
        if (!SD.exists(folderPath)) SD.mkdir(folderPath.c_str());
      }

      if (SD.rename(recycleFile, dst)) {
        if (SD.exists(pathFile)) SD.remove(pathFile);
        if (SD.exists("/recycle/.index")) SD.remove("/recycle/.index");
        String folder = dst.substring(0, dst.lastIndexOf('/')); if (folder == "") folder = "/";
        String idxPath = folder + "/.index"; if (SD.exists(idxPath)) SD.remove(idxPath);

        root["ok"] = true; root["file"] = name; root["path"] = dst;
        resp->setCode(200);
      } else {
        root["ok"] = false; root["error"] = "recover_failed";
        resp->setCode(500);
      }
      resp->setLength(); request->send(resp);
    });

    // ---------- /permadelete_sd (POST -> JSON) ----------
    server.on("/permadelete_sd", HTTP_POST, [](AsyncWebServerRequest *request) {
      SdLock lock;

      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("path")) {
        root["ok"] = false; root["error"] = "missing_path";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }

      String path = urlDecode(request->getParam("path")->value());
      if (!path.startsWith("/")) path = "/" + path;

      if (!SD.exists(path)) {
        root["ok"] = false; root["error"] = "not_found"; root["path"] = path;
        resp->setCode(404); resp->setLength(); request->send(resp); return;
      }

      File f = SD.open(path);
      if (!f) { root["ok"]=false; root["error"]="open_failed"; root["path"]=path;
        resp->setCode(404); resp->setLength(); request->send(resp); return; }
      bool isDir = f.isDirectory(); f.close();

      bool ok = isDir ? SD.rmdir(path.c_str()) : SD.remove(path.c_str());
      if (ok) {
        String folder = path.substring(0, path.lastIndexOf('/')); if (folder == "") folder = "/";
        String idxPath = folder + "/.index"; if (SD.exists(idxPath)) SD.remove(idxPath);
        root["ok"] = true; root["path"] = path; root["type"] = isDir ? "dir" : "file";
        resp->setCode(200);
      } else {
        root["ok"] = false; root["error"] = "delete_failed";
        resp->setCode(500);
      }
      resp->setLength(); request->send(resp);
    });

    // ---------- /delete_sd (POST -> JSON) ----------
    server.on("/delete_sd", HTTP_POST, [](AsyncWebServerRequest *request) {
      SdLock lock;

      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      String originalPath;
      bool permanent = false;

      if (request->hasParam("permanent")) {
        String perm = request->getParam("permanent")->value();
        permanent = (perm == "1" || perm == "true" || perm == "yes");
      } else if (request->hasArg("permanent")) {
        String perm = request->arg("permanent");
        permanent = (perm == "1" || perm == "true" || perm == "yes");
      }

      if (request->hasParam("path"))        originalPath = urlDecode(request->getParam("path")->value());
      else if (request->hasArg("path"))     originalPath = urlDecode(request->arg("path"));
      else if (request->contentType().startsWith("application/x-www-form-urlencoded")) {
        String body = request->arg(0);
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
        root["ok"] = false; root["error"] = "missing_path";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }

      if (!originalPath.startsWith("/")) originalPath = "/" + originalPath;
      if (!SD.exists(originalPath)) {
        root["ok"] = false; root["error"] = "not_found"; root["path"] = originalPath;
        resp->setCode(404); resp->setLength(); request->send(resp); return;
      }

      if (permanent) {
        if (SD.remove(originalPath)) {
          String folder = originalPath.substring(0, originalPath.lastIndexOf('/')); if (folder == "") folder = "/";
          String idxPath = folder + "/.index"; if (SD.exists(idxPath)) SD.remove(idxPath);
          root["ok"] = true; root["mode"] = "permanent"; root["path"] = originalPath;
          resp->setCode(200);
        } else {
          root["ok"] = false; root["error"] = "permanent_failed";
          resp->setCode(500);
        }
        resp->setLength(); request->send(resp); return;
      }

      // Recycle flow
      if (!SD.exists("/recycle")) SD.mkdir("/recycle");
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
      { File meta = SD.open(pathMetaFile, FILE_WRITE); if (meta) { meta.print(originalPath); meta.close(); } }

      if (SD.rename(originalPath, recyclePath)) {
        String folder = originalPath.substring(0, originalPath.lastIndexOf('/')); if (folder == "") folder = "/";
        String idxPath = folder + "/.index"; if (SD.exists(idxPath)) SD.remove(idxPath);
        root["ok"] = true; root["mode"] = "recycle"; root["original"] = originalPath; root["recyclePath"] = recyclePath;
        resp->setCode(200);
      } else {
        if (SD.exists(pathMetaFile)) SD.remove(pathMetaFile);
        root["ok"] = false; root["error"] = "move_failed";
        resp->setCode(500);
      }
      resp->setLength(); request->send(resp);
    });

    // /upload_sd  — safe upload: write to temp, then atomically replace on success (+ optional sha256)
    server.on("/upload_sd", HTTP_POST,

      // Final JSON response
      [](AsyncWebServerRequest *request) {
        auto *ctx = reinterpret_cast<UploadCtx*>(request->_tempObject);

        auto *resp = new AsyncJsonResponse();
        if (!ctx || ctx->error.length()) {
          resp->getRoot()["ok"]    = false;
          resp->getRoot()["error"] = ctx ? ctx->error : "unknown";
          resp->setCode(500);
        } else {
          resp->getRoot()["ok"]     = true;
          resp->getRoot()["path"]   = ctx->uploadPath;
          resp->getRoot()["bytes"]  = (int)ctx->bytesWritten;
          if (ctx->verifySha) {
            resp->getRoot()["sha256"] = toHexLower(ctx->digest, sizeof(ctx->digest));
            resp->getRoot()["sha_ok"] = true;
          }
          resp->setCode(200);
        }
        resp->setLength();
        request->send(resp);

        if (ctx && ctx->error.length() == 0) playSystemSound("/web/pcm/click.wav");
        else                                  playSystemSound("/web/pcm/error.wav");

        delete ctx; request->_tempObject = nullptr;
      },

      // Chunk handler
      [](AsyncWebServerRequest *request, String filename, size_t index,
        uint8_t *data, size_t len, bool final) {

        auto *ctx = reinterpret_cast<UploadCtx*>(request->_tempObject);

        if (index == 0) {
          if (!ctx) { ctx = new UploadCtx(); request->_tempObject = (void*)ctx; }

          // Resolve final destination path
          String uploadPath;
          if (request->hasParam("path", true))       uploadPath = urlDecode(request->getParam("path", true)->value());
          else if (request->hasParam("path", false)) uploadPath = urlDecode(request->getParam("path", false)->value());
          else                                       uploadPath = "/" + filename;
          if (!uploadPath.startsWith("/")) uploadPath = "/" + uploadPath;
          ctx->uploadPath = uploadPath;

          // Optional sha256 (query/body)
          String shaHex;
          if (request->hasParam("sha256", true))       shaHex = request->getParam("sha256", true)->value();
          else if (request->hasParam("sha256", false)) shaHex = request->getParam("sha256", false)->value();
          shaHex = normHex64(shaHex);
          if (shaHex.length() == 64) {
            ctx->verifySha = true;
            ctx->expectedShaHex = shaHex;
            mbedtls_sha256_init(&ctx->sha);
            mbedtls_sha256_starts_ret(&ctx->sha, 0 /* 0 = SHA-256, 1 = SHA-224 */);
          }

          DBG_PRINTF(">>> Starting upload: %s (verify=%d)\n", ctx->uploadPath.c_str(), ctx->verifySha);

          // Ensure directory exists for final & temp
          { SdLock lock; ensureFolderExists(ctx->uploadPath); }

          // Build temp path in same directory, hidden-ish, unique
          String dir  = dirName(ctx->uploadPath);
          String name = baseName(ctx->uploadPath);
          { SdLock lock;
            String tmpWant = dir + "/." + name + ".upload.tmp";
            ctx->tmpPath = SD.exists(tmpWant) ? uniqueInDir(dir, "." + name + ".upload.tmp") : tmpWant;
          }

          // Open temp for write. Do NOT touch the final yet.
          { SdLock lock; ctx->uploadFile = SD.open(ctx->tmpPath, FILE_WRITE); }
          if (!ctx->uploadFile) { ctx->error = "open_tmp_failed"; return; }
        }

        // Stream chunk -> temp, with periodic flush + tiny yield, and update SHA if enabled
        // Robust, throttled streaming write (chunked + retries + reopen)
        if (ctx && ctx->uploadFile && len && ctx->error.length() == 0) {
          const size_t CHUNK       = 4096;   // write granularity
          const int    RETRIES     = 4;      // attempts per write before escalate
          const size_t FLUSH_EVERY = 8192;   // periodic flush/yield

          size_t off = 0;
          while (off < len) {
            size_t toWrite = len - off;
            if (toWrite > CHUNK) toWrite = CHUNK;

            size_t wrote = 0;
            int attempts = 0;

            // Try a few times, with tiny backoff
            while (attempts < RETRIES && wrote == 0) {
              { SdLock lock; wrote = ctx->uploadFile.write(data + off, toWrite); }
              if (wrote == 0) {
                { SdLock lock; ctx->uploadFile.flush(); }
                sdTinyYield(3 + attempts * 2);   // backoff 3ms,5ms,7ms,9ms
              }
              attempts++;
            }

            // Last resort: reopen file and try again
            if (wrote == 0) {
              { SdLock lock; ctx->uploadFile.close(); }
              sdTinyYield(10);
              { SdLock lock; ctx->uploadFile = SD.open(ctx->tmpPath, FILE_APPEND); }
              if (!ctx->uploadFile) {
                ctx->error = "sd_reopen_failed";
                DBG_PRINTF("!!! SD reopen failed at index=%u\n", (unsigned)index);
              } else {
                attempts = 0;
                while (attempts < RETRIES && wrote == 0) {
                  { SdLock lock; wrote = ctx->uploadFile.write(data + off, toWrite); }
                  if (wrote == 0) {
                    { SdLock lock; ctx->uploadFile.flush(); }
                    sdTinyYield(4 + attempts * 2);
                  }
                  attempts++;
                }
              }
            }

            // Still failed → abort safely (keep original file intact)
            if (wrote == 0 || ctx->error.length() != 0) {
              if (ctx->error.length() == 0) ctx->error = "sd_write_error";
              { SdLock lock; if (ctx->uploadFile) ctx->uploadFile.close(); }
              { SdLock lock; SD.remove(ctx->tmpPath); }
              DBG_PRINTF("!!! SD write error at index=%u\n", (unsigned)index);
              break;
            }

            // Hash exactly what we wrote
            if (ctx->verifySha) mbedtls_sha256_update_ret(&ctx->sha, data + off, wrote);

            off += wrote;
            ctx->bytesWritten    += wrote;
            ctx->bytesSinceYield += wrote;

            // Periodic flush + breather
            if (ctx->bytesSinceYield >= FLUSH_EVERY) {
              { SdLock lock; ctx->uploadFile.flush(); }
              sdTinyYield(2);
              ctx->bytesSinceYield = 0;
            }
          }

          // If we set an error above, bail so the final block skips promotion
          if (ctx->error.length() != 0) return;
        }


        if (final) {
          // Close temp file first, then give SD a short pause
          {
            SdLock lock;
            if (ctx && ctx->uploadFile) { ctx->uploadFile.flush(); ctx->uploadFile.close(); }
          }
          sdTinyYield(5);   // final breather before sha/rename

          // Finalize SHA and verify (if requested)
          if (ctx && ctx->verifySha && ctx->error.length() == 0) {
            mbedtls_sha256_finish_ret(&ctx->sha, ctx->digest);
            mbedtls_sha256_free(&ctx->sha);
            String got = toHexLower(ctx->digest, sizeof(ctx->digest));
            if (got != ctx->expectedShaHex) {
              ctx->error = "sha256_mismatch";
              DBG_PRINTF("!!! SHA256 mismatch: got=%s expected=%s\n",
                        got.c_str(), ctx->expectedShaHex.c_str());
              SdLock lock; if (SD.exists(ctx->tmpPath)) SD.remove(ctx->tmpPath);
            }
          }

          if (ctx && ctx->error.length() == 0) {
            SdLock lock;

            // 1) Move existing FINAL to /recycle (only now)
            if (SD.exists(ctx->uploadPath)) {
              String recDir = "/recycle";
              if (!SD.exists(recDir)) SD.mkdir(recDir);
              String recPath = uniqueInDir(recDir, baseName(ctx->uploadPath));
              if (!SD.rename(ctx->uploadPath, recPath)) {
                ctx->error = "rename_to_recycle_failed";
                DBG_PRINTF("!!! Failed to move old file to recycle: %s\n", recPath.c_str());
              } else {
                DBG_PRINTF("Moved old file to recycle: %s\n", recPath.c_str());
              }
            }

            // 2) Promote temp -> final if OK
            if (ctx->error.length() == 0) {
              if (!SD.rename(ctx->tmpPath, ctx->uploadPath)) {
                ctx->error = "rename_tmp_to_final_failed";
                DBG_PRINTF("!!! Failed to promote temp to final: %s -> %s\n",
                          ctx->tmpPath.c_str(), ctx->uploadPath.c_str());
              } else {
                DBG_PRINTF("<<< Upload finished. Promoted %s -> %s (bytes=%u)\n",
                          ctx->tmpPath.c_str(), ctx->uploadPath.c_str(), (unsigned)ctx->bytesWritten);

                // 3) Invalidate .index in the same folder
                String folder = dirName(ctx->uploadPath);
                if (folder == "") folder = "/";
                String idxPath = folder + "/.index";
                if (SD.exists(idxPath)) SD.remove(idxPath);
              }
            }

            // 4) Cleanup temp if anything failed
            if (ctx->error.length() != 0 && SD.exists(ctx->tmpPath)) SD.remove(ctx->tmpPath);
          } else {
            // Had error: ensure temp removed
            SdLock lock;
            if (ctx && SD.exists(ctx->tmpPath)) SD.remove(ctx->tmpPath);
          }
          // JSON goes out via the first lambda
        }
      }
    );

    server.on("/create_file", HTTP_POST, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("path")) {
        root["ok"]=false; root["error"]="missing_path";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }
      String path = urlDecode(request->getParam("path")->value());
      if (!path.startsWith("/")) path = "/" + path;

      {
        SdLock lock;
        path = ensureUniqueFilename(path);
        File file = SD.open(path, FILE_WRITE);
        if (!file) {
          root["ok"]=false; root["error"]="create_failed"; root["path"]=path;
          resp->setCode(500); resp->setLength(); request->send(resp); return;
        }
        file.close();
        String folder = path.substring(0, path.lastIndexOf('/')); if (folder == "") folder="/";
        String idxPath = folder + "/.index"; if (SD.exists(idxPath)) SD.remove(idxPath);
      }

      root["ok"]=true; root["path"]=path;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    server.on("/create_folder", HTTP_POST, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("path")) {
        root["ok"]=false; root["error"]="missing_path";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }

      String path = urlDecode(request->getParam("path")->value());
      if (!path.startsWith("/")) path = "/" + path;

      String newPath;
      {
        SdLock lock;
        String base = path; newPath = path; int count = 1;
        while (SD.exists(newPath.c_str())) newPath = base + "(" + String(count++) + ")";
        if (SD.mkdir(newPath.c_str())) {
          String folder = newPath.substring(0, newPath.lastIndexOf('/')); if (folder=="") folder="/";
          String idxPath = folder + "/.index"; if (SD.exists(idxPath)) SD.remove(idxPath);
          root["ok"]=true; root["path"]=newPath; resp->setCode(200);
        } else {
          root["ok"]=false; root["error"]="mkdir_failed"; root["path"]=newPath; resp->setCode(500);
        }
      }
      resp->setLength();
      request->send(resp);
    });

    server.on("/reboot", HTTP_POST, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      resp->getRoot()["ok"] = true;
      resp->getRoot()["status"] = "rebooting";
      resp->setCode(200);
      resp->setLength();
      request->send(resp);

      delay(100);
      playSystemSound("/web/pcm/reboot.wav");
      delay(2000);
      resetESP();
    });

    // ---------- /clear_paired_prefs (POST) ----------
    server.on("/clear_paired_prefs", HTTP_POST, [](AsyncWebServerRequest *request){
      DBG_PRINTLN("[DOCK] /clear_paired_prefs requested; clearing dock pairing prefs");
      clearDockPairing();

      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();
      root["ok"] = true;
      root["status"] = "cleared";
      root["discovery_enabled"] = dockDiscoveryEnabled;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    server.on("/control", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      sensor_t *s = esp_camera_sensor_get();
      if (!s) { root["ok"]=false; root["error"]="no_sensor"; resp->setCode(500); resp->setLength(); request->send(resp); return; }

      bool changed=false;
      auto updatePref = [&](const char* key, int value){ if (camPrefs.getInt(key, INT32_MIN)!=value){ camPrefs.putInt(key,value); changed=true; } };

      if (request->hasParam("res"))  { int v=request->getParam("res")->value().toInt();  if (camPrefs.getInt("camRes",FRAMESIZE_QVGA)!=v) camPrefs.putInt("camRes", v); }
      if (request->hasParam("fps"))  { int v=request->getParam("fps")->value().toInt();  updatePref("camFps", v); s->set_quality(s, v); }
      if (request->hasParam("rot"))  { int v=request->getParam("rot")->value().toInt();  updatePref("camRot", v); s->set_hmirror(s,(v==1||v==3)); s->set_vflip(s,(v==2||v==3)); }
      if (request->hasParam("sat"))  { int v=request->getParam("sat")->value().toInt();  updatePref("camSat", v); s->set_saturation(s, v); }
      if (request->hasParam("gray")) { int v=request->getParam("gray")->value().toInt(); updatePref("camGray", v); s->set_special_effect(s, v?2:0); }
      if (request->hasParam("led"))  { int v=request->getParam("led")->value().toInt();  updatePref("camLed", v); }
      if (request->hasParam("bright")){int v=request->getParam("bright")->value().toInt();updatePref("camBright", v); s->set_brightness(s, v); }
      if (request->hasParam("contrast")){int v=request->getParam("contrast")->value().toInt();updatePref("camContrast", v); s->set_contrast(s, v); }
      if (request->hasParam("sharp")){ int v=request->getParam("sharp")->value().toInt(); updatePref("camSharp", v); if (s->id.PID==OV2640_PID) s->set_sharpness(s, v); }
      if (request->hasParam("denoise")){int v=request->getParam("denoise")->value().toInt();updatePref("camDenoise", v); if (s->id.PID==OV2640_PID && s->set_denoise) s->set_denoise(s, v); }
      if (request->hasParam("gamma")) { int v=request->getParam("gamma")->value().toInt(); updatePref("camGamma", v); }
      if (request->hasParam("compression")){int v=request->getParam("compression")->value().toInt();updatePref("camCompression", v); if (s->id.PID==OV2640_PID && s->set_quality) s->set_quality(s, v); }
      if (request->hasParam("quality")){int v=request->getParam("quality")->value().toInt(); updatePref("camQuality", v); s->set_quality(s, v); }

      root["ok"]=true; root["changed"]=changed;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    server.onNotFound([](AsyncWebServerRequest* request) {
      String path = request->url();

      // strip query (?v=123) before filesystem lookup
      int q = path.indexOf('?');
      if (q >= 0) path = path.substring(0, q);

      // 1) /telemetry/* served as CSV straight from SD
      if (path.startsWith("/telemetry/")) {
        SdLock lock;
        if (SD.exists(path)) {
          sendFileFromSDWithMime(request, path, "text/csv");
        } else {
          DBG_PRINTF("[HTTP] 404 /telemetry %s\n", path.c_str());
          request->send(404, "text/plain", "File Not Found");
        }
        return;
      }

      // 2) /media/* served with correct content-type
      if (path.startsWith("/media/")) {
        sendFileFromSD(request, path);
        return;
      }

      // 3) everything else from /web (this covers /img/*.png, /modal.css, /modalScript.js, etc.)
      sendStaticFromWeb(request, path);
    });

    // ---------- /list_media_files (GET -> JSON, index-first with live fallback) ----------
    server.on("/list_media_files", HTTP_GET, [](AsyncWebServerRequest *request){
      DBG_PRINTF(">> Handler start: %s, heap=%u\n", __func__, ESP.getFreeHeap());

      int start = request->hasParam("start") ? request->getParam("start")->value().toInt() : 0;
      int count = request->hasParam("count") ? request->getParam("count")->value().toInt() : 40;
      if (start < 0) start = 0;
      if (count < 1 || count > 256) count = 40;

      auto *resp = new AsyncJsonResponse(false, 8192);
      JsonObject root = resp->getRoot().to<JsonObject>();
      JsonArray files = root.createNestedArray("files");

      auto isMedia = [](const String &name) -> bool {
        int dot = name.lastIndexOf('.');
        if (dot < 0) return false;
        String ext = name.substring(dot + 1);
        ext.toLowerCase();
        return ext == "mp3" || ext == "wav" || ext == "ogg" ||
               ext == "mp4" || ext == "webm" || ext == "mov";
      };

      int total = 0;
      int emitted = 0;
      bool usedIndex = false;
      const bool includeTotal = request->hasParam("includeTotal") && request->getParam("includeTotal")->value().toInt() == 1;
      const int scanLimit = includeTotal ? 2147483647 : (start + count + 1);
      bool hasMore = false;

      for (const auto &folder : mediaFolders) {
        const String idxPath = String(folder) + "/.index";
        File idx;
        {
          SdLock lk;
          idx = SD.open(idxPath, FILE_READ);
        }
        if (!idx) continue;

        usedIndex = true;
        uint32_t tick = 0;
        while (idx.available()) {
          String line;
          {
            SdLock lk;
            line = idx.readStringUntil('\n');
          }
          line.trim();
          if (!line.length()) continue;

          int comma = line.indexOf(',');
          if (comma >= 0) line = line.substring(0, comma);
          line.trim();
          if (!line.length()) continue;

          String full = line.startsWith("/") ? line : (String(folder) + "/" + line);
          full.replace("//", "/");
          if (!isMedia(full)) continue;

          total++;
          if (total > start && emitted < count) {
            files.add(full);
            emitted++;
          }
          if (total >= scanLimit) {
            hasMore = true;
            break;
          }

          if (((++tick) & 0x7F) == 0) delay(0);
        }
        {
          SdLock lk;
          idx.close();
        }
        delay(0);
        if (hasMore) break;
      }

      // Fallback: if .index is unavailable, scan folder directly.
      if (!usedIndex) {
        total = 0;
        emitted = 0;
        uint32_t tick = 0;

        for (const auto &folder : mediaFolders) {
          File dir;
          {
            SdLock lk;
            dir = SD.open(folder);
          }
          if (!dir || !dir.isDirectory()) {
            if (dir) {
              SdLock lk;
              dir.close();
            }
            continue;
          }

          while (true) {
            File f;
            {
              SdLock lk;
              f = dir.openNextFile();
            }
            if (!f) break;

            bool isDir = false;
            String name;
            {
              SdLock lk;
              isDir = f.isDirectory();
              name = f.name();
            }

            if (!isDir) {
              String full = name.startsWith("/") ? name : (String(folder) + "/" + name);
              full.replace("//", "/");
              if (isMedia(full)) {
                total++;
                if (total > start && emitted < count) {
                  files.add(full);
                  emitted++;
                }
                if (total >= scanLimit) {
                  hasMore = true;
                }
              }
            }

            {
              SdLock lk;
              f.close();
            }

            if (((++tick) & 0x3F) == 0) delay(0);
            if (hasMore) break;
          }

          {
            SdLock lk;
            dir.close();
          }
          delay(0);
          if (hasMore) break;
        }
      }

      root["start"] = start;
      root["count"] = emitted;
      if (includeTotal) {
        root["total"] = total;
      } else {
        root["total"] = -1;
      }
      root["hasMore"] = hasMore || (includeTotal ? false : (emitted >= count));
      root["indexed"] = usedIndex;

      resp->setCode(200);
      resp->setLength();
      request->send(resp);
      DBG_PRINTF("<< Handler end: %s, heap=%u\n", __func__, ESP.getFreeHeap());
    });

    // ---------- /play_on_device (GET -> JSON) ----------
    server.on("/play_on_device", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("file")) {
        root["ok"]=false; root["error"]="missing_file";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }
      String file = urlDecode(request->getParam("file")->value());

      if (!hasSupportedExtension(file)) {
        root["ok"]=false; root["error"]="unsupported_type"; root["file"]=file;
        resp->setCode(403); resp->setLength(); request->send(resp); return;
      }

      { SdLock lock; if (!SD.exists(file)) {
          root["ok"]=false; root["error"]="not_found"; root["file"]=file;
          resp->setCode(404); resp->setLength(); request->send(resp); return;
        }
      }

      DBG_PRINTF("[MEDIA] Switching to speaker, playing: %s\n", file.c_str());
      playWavFileOnSpeaker(file);

      root["ok"]=true; root["status"]="playing"; root["file"]=file;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /stop_playback (GET -> text) ----------
    server.on("/stop_playback", HTTP_GET, [](AsyncWebServerRequest *request){
      DBG_PRINTLN("[AUDIO] stop_playback called");
      stopAudio();                       // your function that stops speaker I2S
      request->send(200, "text/plain", "OK");
    });

    // ---------- /release_media_resources (GET -> JSON) ----------
    server.on("/release_media_resources", HTTP_GET, [](AsyncWebServerRequest *request){
      DBG_PRINTLN("[AUDIO] release_media_resources called");
      releaseMediaResources();

      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();
      root["ok"] = true;
      root["heap_free"] = ESP.getFreeHeap();
      root["heap_total"] = ESP.getHeapSize();
      root["psram_free"] = ESP.getFreePsram();
      root["psram_total"] = ESP.getPsramSize();
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });
    
    // ---------- /enable_mic (GET -> text) ----------
    server.on("/enable_mic", HTTP_GET, [](AsyncWebServerRequest *request){
      DBG_PRINTLN("[MIC] enable_mic called");
      enableMic();                          // your function
      request->send(200, "text/plain", "OK");
    });

    // ---------- /disable_mic (GET -> text) ----------
    server.on("/disable_mic", HTTP_GET, [](AsyncWebServerRequest *request){
      DBG_PRINTLN("[MIC] disable_mic called (flagging stream stop)");
      micStreamActive = false;
      request->send(200, "text/plain", "OK");
    });

    server.on("/mic_stream", HTTP_GET, [](AsyncWebServerRequest *request){
      struct MicState {
        bool headerSent = false;
        int16_t* audioBuffer = nullptr;
        size_t audioBufferBytes = I2S_READ_LEN * sizeof(int16_t);

        MicState() {
        #if USE_PSRAM
          audioBuffer = (int16_t*)ps_malloc(audioBufferBytes);
        #else
          audioBuffer = (int16_t*)malloc(audioBufferBytes);
        #endif
          if (!audioBuffer) {
            // Fallback to smaller buffer if needed.
            audioBufferBytes = 512 * sizeof(int16_t);
            audioBuffer = (int16_t*)malloc(audioBufferBytes);
          }
        }

        ~MicState() {
          if (audioBuffer) {
            free(audioBuffer);
            audioBuffer = nullptr;
          }
        }
      };
      auto *state = new MicState();
      if (!state->audioBuffer) {
        delete state;
        request->send(500, "text/plain", "alloc_failed");
        return;
      }

      micStreamActive = true;

      auto *response = request->beginChunkedResponse("audio/wav",
        [state](uint8_t *buffer, size_t maxLen, size_t /*index*/) -> size_t {
          if (!state->headerSent) {
            uint8_t wavHeader[44];
            makeWavHeader(wavHeader, 16000, 1, 16, 0x7FFFFFFF);
            memcpy(buffer, wavHeader, 44);
            state->headerSent = true;
            return 44;
          }

          if (!micStreamActive) {
            // return 0 once -> AsyncWebServer will close the response cleanly
            return 0;
          }

          size_t bytesRead = 0;
          esp_err_t res = i2s_read(MY_I2S_PORT, (void*)state->audioBuffer, state->audioBufferBytes,
                                  &bytesRead, 30 / portTICK_RATE_MS);
          if (res != ESP_OK || bytesRead == 0) {
            // brief yield to avoid tight loop on transient errors
            delay(0);
            return 0; // end the stream; client can reconnect
          }

          memcpy(buffer, state->audioBuffer, bytesRead);
          // Cooperative yield every N chunks (optional)
          return bytesRead;
        }
      );
      response->addHeader("Access-Control-Allow-Origin", "*");
      response->addHeader("Cache-Control", "no-store");
      request->send(response);
    });

    // ---------- /set_volume (GET -> JSON) ----------
    server.on("/set_volume", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("value")) {
        root["ok"]=false; root["error"]="missing_value";
        resp->setCode(400); resp->setLength(); request->send(resp); return;
      }
      int v = request->getParam("value")->value().toInt();
      if (v < 0) v = 0; if (v > 21) v = 21;
      setVolume(v);

      root["ok"]=true; root["volume"]=v;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /set_ws_reboot_watchdog (GET -> JSON) ----------
    server.on("/set_ws_reboot_watchdog", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      if (!request->hasParam("value")) {
        root["ok"] = false;
        root["error"] = "missing_value";
        resp->setCode(400);
        resp->setLength();
        request->send(resp);
        return;
      }

      const int v = request->getParam("value")->value().toInt();
      saveWsRebootWatchdogPref(v != 0);
      wsSendKeyInt("WsRebootOnDisconnect", wsRebootOnDisconnect ? 1 : 0);

      root["ok"] = true;
      root["value"] = wsRebootOnDisconnect ? 1 : 0;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /get_oled_settings (GET -> JSON) ----------
    server.on("/get_oled_settings", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();
      root["layout"] = oledPrefs.getString("layout", "default");
      root["showIP"] = oledPrefs.getBool("showIP", true);
      root["showBattery"] = oledPrefs.getBool("showBattery", true);
      root["showWiFi"] = oledPrefs.getBool("showWiFi", true);
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /set_oled_settings (POST JSON -> save) ----------
    {
      auto *setOLED = new AsyncCallbackJsonWebHandler(
        "/set_oled_settings",
        [](AsyncWebServerRequest *request, JsonVariant &json){
          if (!json.is<JsonObject>()) {
            auto *err = new AsyncJsonResponse();
            err->getRoot()["error"] = "Invalid JSON (object expected)";
            err->setCode(400); err->setLength(); request->send(err); return;
          }

          JsonObject obj = json.as<JsonObject>();
          String layout      = obj.containsKey("layout")      ? obj["layout"].as<String>() : "default";
          bool   showIP      = obj.containsKey("showIP")      ? obj["showIP"].as<bool>()   : true;
          bool   showBattery = obj.containsKey("showBattery") ? obj["showBattery"].as<bool>() : true;
          bool   showWiFi    = obj.containsKey("showWiFi")    ? obj["showWiFi"].as<bool>() : true;

          oledPrefs.putString("layout", layout);
          oledPrefs.putBool("showIP", showIP);
          oledPrefs.putBool("showBattery", showBattery);
          oledPrefs.putBool("showWiFi", showWiFi);

          auto *ok = new AsyncJsonResponse();
          ok->getRoot()["status"] = "OK";
          ok->setCode(200);
          ok->setLength();
          request->send(ok);
        }
      );
      setOLED->setMethod(HTTP_POST);
      setOLED->setMaxContentLength(512);
      server.addHandler(setOLED);
    }

    // ---------- /upload_oled_anim (POST -> upload file, JSON ack) ----------
    server.on("/upload_oled_anim", HTTP_POST,
      [](AsyncWebServerRequest *request){ /* response sent in upload lambda */ },
      [](AsyncWebServerRequest *request, String filename, size_t index, uint8_t *data, size_t len, bool final){
        static File uploadFile;

        if (index == 0) {
          DBG_PRINTF("📤 Uploading OLED animation file: %s\n", filename.c_str());
          SdLock lock;
          uploadFile = SD.open("/oled_anim.xbm", FILE_WRITE);
          if (!uploadFile) {
            auto *err = new AsyncJsonResponse();
            err->getRoot()["ok"]=false; err->getRoot()["error"]="open_failed";
            err->setCode(500); err->setLength(); request->send(err); return;
          }
        }

        if (uploadFile) {
          if (len) {
            SdLock lock;
            if (uploadFile.write(data, len) != len) {
              uploadFile.close();
              auto *err = new AsyncJsonResponse();
              err->getRoot()["ok"]=false; err->getRoot()["error"]="write_failed";
              err->setCode(500); err->setLength(); request->send(err); return;
            }
          }
          if (final) {
            SdLock lock; uploadFile.close();
            auto *ok = new AsyncJsonResponse();
            ok->getRoot()["ok"]=true; ok->getRoot()["path"]="/oled_anim.xbm";
            ok->setCode(200); ok->setLength(); request->send(ok);
          }
        }
      }
    );

    // ---------- /list_telemetry_files (GET -> JSON) ----------
    server.on("/list_telemetry_files", HTTP_GET, [](AsyncWebServerRequest *request){
    AsyncJsonResponse *resp = new AsyncJsonResponse(false, 8192);
    JsonArray arr = resp->getRoot().to<JsonArray>();

    {
        SdLock lock; // Ensure SD card is safe to access
        File dir = SD.open("/telemetry");
        if (dir && dir.isDirectory()) {
            File f = dir.openNextFile();
            while (f) {
                String name = f.name();
                if (!f.isDirectory() && name.endsWith(".csv")) {
                    if (!name.startsWith("/")) name = "/telemetry/" + name;
                    arr.add(name);
                }
                f.close();
                f = dir.openNextFile();
            }
            dir.close();
        }
    }

    resp->setCode(200);
    resp->setLength();
    request->send(resp);
});


    //-------------Media Capture Handlers------------------------------------------//
    // ---------- /capture_photo (GET -> JSON) ----------
    server.on("/capture_photo", HTTP_GET, [](AsyncWebServerRequest *request){
      // 1) Grab a frame first (no SD yet)
      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) {
        auto *err = new AsyncJsonResponse();
        err->getRoot()["status"]  = "error";
        err->getRoot()["message"] = "Camera capture failed";
        err->setCode(500);
        err->setLength();
        request->send(err);
        return;
      }

      String filePath;
      bool   okWrite = true;

      // 2) SD write (guarded, chunked, with yields)
      {
        SdLock lock; // 🔒 Only hold SD lock while actually touching SD
        String folder = "/media/capture/photo";
        if (!SD.exists(folder)) SD.mkdir(folder);

        // If your getMediaTimestamp already returns a full path, keep as-is:
        filePath = getMediaTimestamp("photo", "jpg");  // e.g. "/media/capture/photo/2025-08-13_12-34-56.jpg"
        File f = SD.open(filePath, FILE_WRITE);
        if (!f) {
          okWrite = false;
        } else {
          const uint8_t* p   = fb->buf;
          size_t         rem = fb->len;
          while (rem && okWrite) {
            size_t n = rem > 4096 ? 4096 : rem;
            size_t w = f.write(p, n);
            if (w != n) {
              okWrite = false;
              f.close();
              SD.remove(filePath);                  // delete partial file
              break;
            }
            p   += w;
            rem -= w;
            vTaskDelay(1);                          // give time to lwIP/WiFi/etc.
          }
          if (okWrite) f.close();
        }
      } // 🔓 SD lock released here

      // 3) Return frame buffer to camera driver ASAP
      esp_camera_fb_return(fb);

      // 4) Respond
      if (!okWrite) {
        auto *err = new AsyncJsonResponse();
        err->getRoot()["status"]  = "error";
        err->getRoot()["message"] = "SD write/open failed";
        err->setCode(500);
        err->setLength();
        request->send(err);
        return;
      }

      auto *resp = new AsyncJsonResponse();
      resp->getRoot()["status"] = "ok";
      resp->getRoot()["path"]   = filePath;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);

      // 5) Play the sound AFTER all SD/camera work is done (no contention)
      playSystemSound("/web/pcm/screenshot.wav");
    });

    // ---------- /start_record_video (GET -> JSON) ----------
    server.on("/start_record_video", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      // Block duplicates (race-safe)
      if (videoTaskActive || videoRecording) {
        root["status"]  = "error";
        root["message"] = "Already recording";
        resp->setCode(409);
        resp->setLength();
        request->send(resp);
        return;
      }

      // Parse & clamp duration
      int duration = 5;
      if (request->hasParam("duration")) {
        duration = request->getParam("duration")->value().toInt();
        if (duration < 1)  duration = 1;
        if (duration > 60) duration = 60;
      }

      // Play sound BEFORE starting the task (keeps SD contention low)
      playSystemSound("/web/pcm/videorecord.wav");

      // Create task
      int* arg = new int(duration);
      BaseType_t ok =
      #if CONFIG_FREERTOS_UNICORE
          xTaskCreate(recordVideoTask, "RecordVideo", 12288, arg, 1, &videoTaskHandle);
      #else
          xTaskCreatePinnedToCore(recordVideoTask, "RecordVideo", 12288, arg, 1, &videoTaskHandle, ARDUINO_RUNNING_CORE);
      #endif

      if (ok != pdPASS) {
        delete arg;
        root["status"]  = "error";
        root["message"] = "task_create_failed";
        resp->setCode(500);
        resp->setLength();
        request->send(resp);
        return;
      }

      // Pre-arm the guard so a 2nd start can’t slip in before the task sets flags
      videoTaskActive = true;

      root["status"]   = "recording";
      root["duration"] = duration;
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---------- /stop_record_video (GET -> JSON) ----------
    server.on("/stop_record_video", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot();

      // If a stop arrives very early, treat it as success-like
      if (!videoTaskActive && !videoRecording) {
        root["status"] = "stopped";
        resp->setCode(200);
        resp->setLength();
        request->send(resp);
        return;
      }

      // Signal the task to exit; it will close the file and then play the sound
      videoRecording = false;

      // Match the frontend expectation so it doesn’t toast an error
      root["status"] = "stopped";
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });

    // ---- /play_sd_mjpeg (per-request state; simpler loop) ----
    server.on("/play_sd_mjpeg", HTTP_GET, [](AsyncWebServerRequest *request) {
        if (!request->hasParam("path")) {
            auto *err = new AsyncJsonResponse();
            err->getRoot()["error"] = "missing_path";
            err->setCode(400);
            request->send(err);
            return;
        }

        String path = request->getParam("path")->value();

        File f;
        {
            SdLock lock; // 🔒 Lock only while opening
            f = SD.open(path, FILE_READ);
        }

        if (!f) {
            auto *err = new AsyncJsonResponse();
            err->getRoot()["error"] = "not_found";
            err->getRoot()["path"]  = path;
            err->setCode(404);
            request->send(err);
            return;
        }

        struct MJState {
            File file;
            bool inFrame = false;
            #if USE_PSRAM
              std::vector<uint8_t, psram_allocator<uint8_t>> frame;
            #else
              std::vector<uint8_t> frame;
            #endif
            uint8_t* readBuf = nullptr;
            size_t readBufSize = 4096;

            MJState(File &&f) : file(std::move(f)) {
            #if USE_PSRAM
              readBuf = (uint8_t*)ps_malloc(readBufSize);
            #else
              readBuf = (uint8_t*)malloc(readBufSize);
            #endif
              if (!readBuf) {
                // Fallback to a smaller internal buffer instead of failing hard.
                readBufSize = 1024;
                readBuf = (uint8_t*)malloc(readBufSize);
              }
            }

            ~MJState() {
              if (readBuf) {
                free(readBuf);
                readBuf = nullptr;
              }
            }
        };

        auto *st = new MJState(std::move(f));
        if (!st->readBuf) {
            {
                SdLock lock;
                st->file.close();
            }
            delete st;
            auto *err = new AsyncJsonResponse();
            err->getRoot()["error"] = "alloc_failed";
            err->setCode(500);
            request->send(err);
            return;
        }

        AsyncWebServerResponse *response = request->beginChunkedResponse(
            "multipart/x-mixed-replace;boundary=frame",
            [st](uint8_t *buffer, size_t maxLen, size_t /*index*/) -> size_t {
                st->frame.clear();

                // Read from SD in chunks until one JPEG frame is complete
                {
                    SdLock lock; // 🔒 Lock during SD read
                    while (st->file && st->file.available()) {
                        size_t toRead = st->readBufSize;
                        if (toRead > (size_t)st->file.available()) {
                            toRead = st->file.available();
                        }
                        size_t bytesRead = st->file.read(st->readBuf, toRead);
                        if (bytesRead == 0) break;

                        for (size_t i = 0; i < bytesRead; i++) {
                            uint8_t b = st->readBuf[i];
                            if (!st->inFrame) {
                                if (b == 0xFF && i + 1 < bytesRead && st->readBuf[i + 1] == 0xD8) {
                                    st->inFrame = true;
                                    st->frame.push_back(b);
                                }
                            } else {
                                st->frame.push_back(b);
                                size_t n = st->frame.size();
                                if (n >= 2 && st->frame[n - 2] == 0xFF && st->frame[n - 1] == 0xD9) {
                                    st->inFrame = false; // frame complete
                                    goto frame_done;
                                }
                            }

                            if (st->frame.size() >= 200000) { // sanity stop
                                st->inFrame = false;
                                goto frame_done;
                            }
                        }
                    }
                } // lock released here

            frame_done:
                if (st->frame.empty()) {
                    {
                        SdLock lock; // 🔒 Lock during file close
                        st->file.close();
                    }
                    delete st;
                    return 0; // end stream
                }

                static String head;
                head  = "\r\n--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ";
                head += st->frame.size();
                head += "\r\n\r\n";

                size_t written = 0;
                size_t hlen = head.length();
                size_t toCopy = min(maxLen, hlen);
                memcpy(buffer, head.c_str(), toCopy);
                written += toCopy;

                size_t remain = maxLen - written;
                if (remain > 0) {
                    size_t fn = min(remain, st->frame.size());
                    memcpy(buffer + written, st->frame.data(), fn);
                    written += fn;
                }

                return written;
            }
        );

        request->send(response);
    });

    // ---------- /get_mqtt (GET -> JSON) ----------
    server.on("/get_mqtt", HTTP_GET, [](AsyncWebServerRequest *request){
      DBG_PRINTLN("[MQTT] /get_mqtt requested.");
      loadMqttConfig();

      auto *resp = new AsyncJsonResponse();            // object
      JsonObject root = resp->getRoot().to<JsonObject>();
      root["enable"]       = mqttCfg.enable;
      root["host"]         = mqttCfg.host;
      root["port"]         = mqttCfg.port;
      root["user"]         = mqttCfg.user;
      root["pass"]         = mqttCfg.pass;
      root["topic_prefix"] = mqttCfg.topic_prefix;

      resp->setCode(200);
      resp->setLength();                                // ✅ avoid chunked
      request->send(resp);
    });


    // ---------- /set_mqtt (POST JSON -> save) ----------
    {
      auto *setMqtt = new AsyncCallbackJsonWebHandler(
        "/set_mqtt",
        [](AsyncWebServerRequest *request, JsonVariant &json){
          if (!json.is<JsonObject>()) {
            auto *err = new AsyncJsonResponse();
            err->getRoot()["error"] = "Invalid JSON (object expected)";
            err->setCode(400); err->setLength(); request->send(err); return;
          }
          JsonObject obj = json.as<JsonObject>();

          MQTTConfig cfg;
          cfg.enable       = obj.containsKey("enable")       ? obj["enable"].as<bool>()    : false;
          cfg.host         = obj.containsKey("host")         ? obj["host"].as<String>()    : "";
          cfg.port         = obj.containsKey("port")         ? obj["port"].as<uint16_t>()  : 1883;
          cfg.user         = obj.containsKey("user")         ? obj["user"].as<String>()    : "";
          cfg.pass         = obj.containsKey("pass")         ? obj["pass"].as<String>()    : "";
          cfg.topic_prefix = obj.containsKey("topic_prefix") ? obj["topic_prefix"].as<String>() : "";

          saveMqttConfig(cfg);
          mqttNeedsReconnect = true;

          DBG_PRINTF("[MQTT] Saved: enable=%d host='%s' port=%d user='%s' topic_prefix='%s'\n",
            cfg.enable, cfg.host.c_str(), cfg.port, cfg.user.c_str(), cfg.topic_prefix.c_str());

          // Frontend expects text here
          request->send(200, "text/plain", "OK");
        }
      );
      setMqtt->setMethod(HTTP_POST);
      setMqtt->setMaxContentLength(1024);
      server.addHandler(setMqtt);
    }

    // ---------- /mqtt_test (POST -> text) ----------
    server.on("/mqtt_test", HTTP_POST, [](AsyncWebServerRequest *request){
      DBG_PRINTLN("[MQTT] /mqtt_test requested.");
      loadMqttConfig();

      // Quick validation
      if (mqttCfg.host.isEmpty() || mqttCfg.port == 0) {
        request->send(200, "text/plain", "❌ Invalid host/port");
        return;
      }

      // Keep this short & cooperative
      WiFiClient wifiClient;
      #if defined(ARDUINO_ARCH_ESP32)
        wifiClient.setTimeout(2000);  // read timeout safeguard
      #endif

      PubSubClient testClient(wifiClient);
      testClient.setServer(mqttCfg.host.c_str(), mqttCfg.port);
      testClient.setSocketTimeout(2);   // seconds
      String clientId = "MiniExcoTest-" + String((uint32_t)millis());

      bool connected = false;
      // Try connect (keep it snappy)
      yield();
      if (mqttCfg.user.length() > 0) {
        DBG_PRINTF("[MQTT] Connecting (user='%s')\n", mqttCfg.user.c_str());
        connected = testClient.connect(clientId.c_str(),
                                      mqttCfg.user.c_str(),
                                      mqttCfg.pass.c_str());
      } else {
        DBG_PRINTLN("[MQTT] Connecting anonymously.");
        connected = testClient.connect(clientId.c_str());
      }
      yield();

      if (connected) testClient.disconnect();

      request->send(200, "text/plain",
                    connected ? "✅ MQTT connection OK" : "❌ MQTT connection failed");
    });

    // ---------- /mqtt_status (GET -> JSON) ----------
    server.on("/mqtt_status", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse();
      JsonObject root = resp->getRoot().to<JsonObject>();
      root["connected"]  = mqttConnected;
      if (!mqttConnected && mqttLastError.length()) {
        root["last_error"] = mqttLastError;
      }
      resp->setCode(200);
      resp->setLength();                                // ✅
      request->send(resp);
    });

    // ---------- /mqtt_discovery (POST -> text) ----------
    server.on("/mqtt_discovery", HTTP_POST, [](AsyncWebServerRequest *request){
      if (mqtt.connected()) {
        publishMqttDiscovery();
        mqttDiscoveryPublished = true;
        request->send(200, "text/plain", "📢 Discovery published");
      } else {
        request->send(200, "text/plain", "❌ MQTT not connected");
      }
    });

    // ---------- /camera_enable (GET -> JSON) ----------
    server.on("/camera_enable", HTTP_GET, [](AsyncWebServerRequest *request){
      AsyncResponseStream *resp = request->beginResponseStream("application/json");
      StaticJsonDocument<256> doc;

      if (!request->hasParam("val")) {
        doc["ok"] = false;
        doc["error"] = "missing_val";
        serializeJson(doc, *resp);
        request->send(resp);
        return;
      }

      const bool wantEnable = (request->getParam("val")->value().toInt() == 1);

      if (wantEnable == cameraEnabled) {
        // Reconcile inconsistent states from older behavior.
        if (!wantEnable && cameraInitialized) {
          disableCamera();
          doc["ok"] = true;
          doc["status"] = "reconciled_disabled";
          doc["enabled"] = false;
          serializeJson(doc, *resp);
          request->send(resp);
          return;
        }
        if (wantEnable && !cameraInitialized) {
          const bool repaired = enableCamera();
          doc["ok"] = repaired;
          doc["status"] = repaired ? "reconciled_enabled" : "enable_failed";
          doc["enabled"] = repaired;
          serializeJson(doc, *resp);
          request->send(resp);
          return;
        }
        doc["ok"] = true;
        doc["status"] = "nochange";
        doc["enabled"] = cameraEnabled;
        serializeJson(doc, *resp);
        request->send(resp);
        return;
      }

      bool ok = true;
      if (wantEnable) {
        if (!cameraInitialized) {
          ok = enableCamera();
        }
        if (ok) {
          appHttpdResumeStreaming();
          cameraEnabled = true;
          saveCameraPrefs(true);
          doc["status"] = "enabled";
        } else {
          doc["status"] = "enable_failed";
          char errHex[16];
          snprintf(errHex, sizeof(errHex), "0x%X", (unsigned int)lastCameraInitErr);
          doc["error"] = "camera_init_failed";
          doc["camera_err"] = errHex;
          doc["heap"] = ESP.getFreeHeap();
        }
      } else {
        ok = disableCamera();
        doc["status"] = ok ? "disabled" : "disable_failed";
      }

      doc["ok"] = ok;
      doc["enabled"] = cameraEnabled;

      serializeJson(doc, *resp);
      request->send(resp);
    });

    // ---------- /camera_status (GET) ----------
    server.on("/camera_status", HTTP_GET, [](AsyncWebServerRequest *request){
      AsyncResponseStream *resp = request->beginResponseStream("application/json");

    StaticJsonDocument<128> doc;
      doc["enabled"] = cameraEnabled;
      doc["initialized"] = cameraInitialized;
      doc["boot_restore_pending"] = cameraBootRestorePending;

      serializeJson(doc, *resp);
      request->send(resp);
    });

    // ---------- /heap_report (GET -> JSON) ----------
    server.on("/heap_report", HTTP_GET, [](AsyncWebServerRequest *request){
      auto *resp = new AsyncJsonResponse(false, 8192);
      JsonObject root = resp->getRoot().to<JsonObject>();

      auto fragPercent = [](uint32_t freeBytes, uint32_t largestBlock) -> uint32_t {
        if (freeBytes == 0 || largestBlock >= freeBytes) return 0;
        return (uint32_t)(100.0f * (1.0f - ((float)largestBlock / (float)freeBytes)));
      };

      const uint32_t heapTotal   = ESP.getHeapSize();
      const uint32_t heapFree    = ESP.getFreeHeap();
      const uint32_t heapMinFree = ESP.getMinFreeHeap();
      const uint32_t heapLargest = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);

      const uint32_t intFree    = heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
      const uint32_t intMinFree = heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
      const uint32_t intLargest = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);

      const uint32_t psTotal   = ESP.getPsramSize();
      const uint32_t psFree    = ESP.getFreePsram();
      const uint32_t psMinFree = heap_caps_get_minimum_free_size(MALLOC_CAP_SPIRAM);
      const uint32_t psLargest = heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM);

      JsonObject heap = root.createNestedObject("heap");
      heap["total"] = heapTotal;
      heap["free"] = heapFree;
      heap["used"] = (heapTotal > heapFree) ? (heapTotal - heapFree) : 0;
      heap["min_free"] = heapMinFree;
      heap["largest_free_block"] = heapLargest;
      heap["frag_pct"] = fragPercent(heapFree, heapLargest);

      JsonObject internal = root.createNestedObject("internal_heap");
      internal["free"] = intFree;
      internal["min_free"] = intMinFree;
      internal["largest_free_block"] = intLargest;
      internal["frag_pct"] = fragPercent(intFree, intLargest);

      JsonObject psram = root.createNestedObject("psram");
      psram["total"] = psTotal;
      psram["free"] = psFree;
      psram["used"] = (psTotal > psFree) ? (psTotal - psFree) : 0;
      psram["min_free"] = psMinFree;
      psram["largest_free_block"] = psLargest;
      psram["frag_pct"] = fragPercent(psFree, psLargest);

#if (configUSE_TRACE_FACILITY == 1)
      UBaseType_t taskCount = uxTaskGetNumberOfTasks();
    #if USE_PSRAM
      std::vector<TaskStatus_t, psram_allocator<TaskStatus_t>> taskStats;
    #else
      std::vector<TaskStatus_t> taskStats;
    #endif
      taskStats.resize((size_t)taskCount + 4);
      uint32_t totalRuntime = 0;
      UBaseType_t got = uxTaskGetSystemState(taskStats.data(), taskStats.size(), &totalRuntime);
      JsonArray tasks = root.createNestedArray("tasks");
      for (UBaseType_t i = 0; i < got; ++i) {
        const TaskStatus_t &ts = taskStats[i];
        JsonObject t = tasks.createNestedObject();
        t["name"] = ts.pcTaskName ? ts.pcTaskName : "unknown";
        t["priority"] = (int)ts.uxCurrentPriority;
        t["stack_hwm_words"] = (uint32_t)ts.usStackHighWaterMark;
        t["stack_hwm_bytes"] = (uint32_t)ts.usStackHighWaterMark * (uint32_t)sizeof(StackType_t);
      }
      root["tasks_supported"] = true;
#else
      root["tasks_supported"] = false;
#endif

      root["uptime_ms"] = millis();
      resp->setCode(200);
      resp->setLength();
      request->send(resp);
    });


    //---------------------------------------------------------------------------------------------------HANDLERS END-----------------------------------------------------------

    // ---------- WS + server start ----------
    if (!wsAttached) {
      wsCarInput.onEvent(onCarInputWebSocketEvent);
      server.addHandler(&wsCarInput);
      wsAttached = true;
    }
    if (!lobbyServerStarted) {
      server.begin();
      lobbyServerStarted = true;
    }
    DBG_PRINTLN("HTTP server started");
    PRINT_HEAP("after_full_server");
  }

//----------------------------------------------------------------------------Telemetry-------------------------------------------------------------

  void updateDockHeartbeatState(int batteryPercent, float batteryVoltage, float chargerVoltage, const char* chargingState) {
    dockHeartbeatState.batteryPercent = batteryPercent;
    dockHeartbeatState.batteryVoltage = batteryVoltage;
    dockHeartbeatState.chargerVoltage = chargerVoltage;
    dockHeartbeatState.chargingState = chargingState ? chargingState : "UNKNOWN";
    dockHeartbeatState.lastUpdateMs = millis();
  }

  void loadDockPairingFromPrefs() {
    dockPair.paired   = dockPrefs.getBool("paired", false);
    dockPair.roverId  = dockPrefs.getString("rover_id", "");
    dockPair.hwId     = dockPrefs.getString("hw_id", getHardwareId());
    dockPair.dockId   = dockPrefs.getString("dock_id", "");
    dockPair.dockMac  = dockPrefs.getString("dock_mac", "");
    dockPair.dockPort = dockPrefs.getUShort("dock_port", DOCK_UDP_PORT);
    String ipStr      = dockPrefs.getString("dock_ip", "");
    if (ipStr.length()) {
      dockPair.dockIp.fromString(ipStr);
    }
    if (!dockPair.hwId.length()) {
      dockPair.hwId = getHardwareId();
    }
    dockDiscoveryEnabled = !dockPair.paired;
  }

  void saveDockPairingToPrefs() {
    dockPrefs.putBool("paired", dockPair.paired);
    dockPrefs.putString("rover_id", dockPair.roverId);
    dockPrefs.putString("hw_id", dockPair.hwId);
    dockPrefs.putString("dock_id", dockPair.dockId);
    dockPrefs.putString("dock_mac", dockPair.dockMac);
    dockPrefs.putUShort("dock_port", dockPair.dockPort);
    dockPrefs.putString("dock_ip", dockPair.dockIp.toString());
  }

  bool isWifiReadyForUdp() {
    wifi_mode_t mode;
    if (esp_wifi_get_mode(&mode) != ESP_OK) return false;
    return mode != WIFI_MODE_NULL;
  }

  void ensureDockUdpStarted() {
    if (!dockUdpStarted) {
      if (!isWifiReadyForUdp()) return;
      dockUdpStarted = dockUdp.begin(DOCK_UDP_PORT);
      if (!dockUdpStarted) {
        DBG_PRINTLN("[DOCK] UDP begin failed");
      }
    }
  }

  IPAddress getBroadcastAddress() {
    if (WiFi.status() != WL_CONNECTED) return IPAddress(0,0,0,0);
    IPAddress ip = WiFi.localIP();
    IPAddress mask = WiFi.subnetMask();
    IPAddress broadcast(ip[0] | ~mask[0], ip[1] | ~mask[1], ip[2] | ~mask[2], ip[3] | ~mask[3]);
    return broadcast;
  }

  bool sendDockDiscoveryNow() {
    ensureDockUdpStarted();
    if (!dockUdpStarted) return false;
    IPAddress broadcastIp = getBroadcastAddress();
    if (!broadcastIp) return false;

    StaticJsonDocument<160> doc;
    doc["type"] = "discover";
    doc["id"] = getS3Id();
    doc["hw_id"] = getHardwareId();

    char body[160];
    size_t len = serializeJson(doc, body, sizeof(body));
    if (!dockUdp.beginPacket(broadcastIp, DOCK_UDP_PORT)) {
      return false;
    }
    dockUdp.write((uint8_t*)body, len);
    return dockUdp.endPacket() == 1;
  }

  void pumpDockDiscovery() {
    if (!dockDiscoveryEnabled) return;
    if (dockPair.paired) return;
    const unsigned long now = millis();
    if (now - lastDockDiscoveryMs < 5000) return;
    if (sendDockDiscoveryNow()) {
      DBG_PRINTLN("[DOCK] discovery sent");
    }
    lastDockDiscoveryMs = now;
  }

  void sendDockPairAck(IPAddress remoteIp, uint16_t remotePort, const String& roverId, const String& hwId, bool accepted) {
    ensureDockUdpStarted();
    if (!dockUdpStarted) return;
    StaticJsonDocument<160> doc;
    doc["type"] = "pair_ack";
    doc["id"] = roverId;
    doc["hw_id"] = hwId;
    doc["accepted"] = accepted;

    char body[160];
    size_t len = serializeJson(doc, body, sizeof(body));
    if (!dockUdp.beginPacket(remoteIp, remotePort)) {
      DBG_PRINTLN("[DOCK] UDP beginPacket failed (pair_ack)");
      return;
    }
    dockUdp.write((uint8_t*)body, len);
    if (dockUdp.endPacket() != 1) {
      DBG_PRINTLN("[DOCK] UDP send failed (pair_ack)");
    }
  }

  void handleDockPairRequest(JsonDocument& doc, IPAddress remoteIp, uint16_t remotePort) {
    const String incomingHwId = doc["hw_id"] | "";
    const String incomingRoverId = doc["id"] | getS3Id();
    const String incomingDockId = doc["dock_id"] | "";
    const String incomingDockMac = doc["dock_mac"] | "";

    if (incomingHwId.length() && incomingHwId != getHardwareId()) {
      DBG_PRINTLN("[DOCK] pair_request hw_id mismatch, ignoring");
      return;
    }

    dockPair.paired  = true;
    dockPair.roverId = incomingRoverId;
    dockPair.hwId    = getHardwareId();
    dockPair.dockId  = incomingDockId;
    dockPair.dockMac = incomingDockMac;
    dockPair.dockIp  = remoteIp;
    dockPair.dockPort = remotePort;
    saveDockPairingToPrefs();

    sendDockPairAck(remoteIp, remotePort, incomingRoverId, dockPair.hwId, true);
    DBG_PRINTLN("[DOCK] pair_request accepted");
    dockDiscoveryEnabled = false;
  }

  bool sendDockDataResponse(IPAddress remoteIp, uint16_t remotePort) {
    ensureDockUdpStarted();
    if (!dockUdpStarted) return false;
    if (dockHeartbeatState.lastUpdateMs == 0) {
      DBG_PRINTLN("[DOCK] No telemetry yet to send");
      return false;
    }
    StaticJsonDocument<224> doc;
    const String roverId = dockPair.roverId.length() ? dockPair.roverId : getS3Id();
    doc["id"] = roverId;
    doc["hw_id"] = dockPair.hwId.length() ? dockPair.hwId : getHardwareId();
    doc["battery_voltage"] = dockHeartbeatState.batteryVoltage;
    doc["charger_voltage"] = dockHeartbeatState.chargerVoltage;
    doc["charging_state"] = dockHeartbeatState.chargingState;
    doc["battery_percent"] = dockHeartbeatState.batteryPercent;
    int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : lastRssiDbm;
    doc["rssi"] = rssi;

    char body[224];
    size_t len = serializeJson(doc, body, sizeof(body));
    if (!dockUdp.beginPacket(remoteIp, remotePort)) {
      DBG_PRINTLN("[DOCK] UDP beginPacket failed (data_response)");
      return false;
    }
    dockUdp.write((uint8_t*)body, len);
    bool ok = dockUdp.endPacket() == 1;
    if (!ok) {
      DBG_PRINTLN("[DOCK] UDP send failed (data_response)");
    }
    return ok;
  }

  void handleDockDataRequest(JsonDocument& doc, IPAddress remoteIp, uint16_t remotePort) {
    if (!dockPair.paired) {
      DBG_PRINTLN("[DOCK] data_request ignored, not paired");
      return;
    }
    const String reqRoverId = doc["id"] | "";
    const String reqHwId = doc["hw_id"] | "";
    const String reqDockMac = doc["dock_mac"] | "";
    const String reqDockId = doc["dock_id"] | "";

    if (reqRoverId.length() && dockPair.roverId.length() && reqRoverId != dockPair.roverId) return;
    if (reqHwId.length() && reqHwId != dockPair.hwId) return;
    if (reqDockMac.length() && dockPair.dockMac.length() && reqDockMac != dockPair.dockMac) return;
    if (reqDockId.length() && dockPair.dockId.length() && reqDockId != dockPair.dockId) return;

    dockPair.dockIp = remoteIp;
    dockPair.dockPort = remotePort;
    if (!reqDockMac.isEmpty()) dockPair.dockMac = reqDockMac;
    if (!reqDockId.isEmpty()) dockPair.dockId = reqDockId;
    saveDockPairingToPrefs();

    sendDockDataResponse(remoteIp, remotePort);
  }

  void clearDockPairing() {
    dockPair.paired = false;
    dockPair.roverId = "";
    dockPair.dockId = "";
    dockPair.dockMac = "";
    dockPair.dockIp = IPAddress(0,0,0,0);
    dockPair.dockPort = DOCK_UDP_PORT;
    saveDockPairingToPrefs();
    dockDiscoveryEnabled = true;
    lastDockDiscoveryMs = 0; // allow immediate discovery
  }

  void sendDockUnpairAck(IPAddress remoteIp, uint16_t remotePort, const String& roverId, const String& hwId, bool accepted) {
    ensureDockUdpStarted();
    if (!dockUdpStarted) return;
    StaticJsonDocument<160> doc;
    doc["type"] = "unpair_ack";
    doc["id"] = roverId;
    doc["hw_id"] = hwId;
    doc["accepted"] = accepted;

    char body[160];
    size_t len = serializeJson(doc, body, sizeof(body));
    if (!dockUdp.beginPacket(remoteIp, remotePort)) {
      DBG_PRINTLN("[DOCK] UDP beginPacket failed (unpair_ack)");
      return;
    }
    dockUdp.write((uint8_t*)body, len);
    if (dockUdp.endPacket() != 1) {
      DBG_PRINTLN("[DOCK] UDP send failed (unpair_ack)");
    }
  }

  void handleDockUnpairRequest(JsonDocument& doc, IPAddress remoteIp, uint16_t remotePort) {
    const String reqRoverId = doc["id"] | "";
    const String reqHwId    = doc["hw_id"] | "";
    const String reqDockMac = doc["dock_mac"] | "";
    const String reqDockId  = doc["dock_id"] | "";

    if (dockPair.paired) {
      if (reqRoverId.length() && dockPair.roverId.length() && reqRoverId != dockPair.roverId) return;
      if (reqHwId.length() && reqHwId != dockPair.hwId) return;
      if (reqDockMac.length() && dockPair.dockMac.length() && reqDockMac != dockPair.dockMac) return;
      if (reqDockId.length() && dockPair.dockId.length() && reqDockId != dockPair.dockId) return;
    } else {
      // If not paired, accept unpair if it references us (id/hw_id) to resume discovery.
      if (reqHwId.length() && reqHwId != getHardwareId()) return;
      if (reqRoverId.length() && reqRoverId != getS3Id()) return;
    }

    clearDockPairing();
    sendDockUnpairAck(remoteIp, remotePort,
                      reqRoverId.length() ? reqRoverId : (dockPair.roverId.length() ? dockPair.roverId : getS3Id()),
                      getHardwareId(),
                      true);
    DBG_PRINTLN("[DOCK] unpair_request processed");
  }

  void handleDockSoundRequest(JsonDocument& doc, const String& msgType) {
    const String reqDockMac = doc["dock_mac"] | "";
    const String reqDockId  = doc["dock_id"] | "";
    const String reason     = doc["reason"] | "";
    const String robotHw    = doc["robot_hw"] | doc["hw_id"] | "";
    const String robotId    = doc["robot_id"] | doc["id"] | "";

    // Require a paired dock before honoring sound requests
    if (!dockPair.paired) {
      DBG_PRINTLN("[DOCK] sound req ignored; not paired");
      return;
    }

    // Only honor if dock MAC matches saved pairing (if present)
    if (dockPair.dockMac.length()) {
      if (!reqDockMac.length() || !equalsIgnoreCase(reqDockMac, dockPair.dockMac)) {
        DBG_PRINTLN("[DOCK] sound req ignored; dock_mac mismatch");
        return;
      }
    }
    if (dockPair.dockId.length() && reqDockId.length() && !equalsIgnoreCase(reqDockId, dockPair.dockId)) {
      DBG_PRINTLN("[DOCK] sound req ignored; dock_id mismatch");
      return;
    }

    if (robotHw.length() && !equalsIgnoreCase(robotHw, getHardwareId())) {
      DBG_PRINTLN("[DOCK] sound req ignored; robot_hw mismatch");
      return;
    }
    if (robotId.length() && !equalsIgnoreCase(robotId, getS3Id())) {
      DBG_PRINTLN("[DOCK] sound req ignored; robot_id mismatch");
      return;
    }

    const char* sound = nullptr;
    if (msgType == "dock_home")      sound = "/web/pcm/home.wav";
    else if (msgType == "find_rover") sound = "/web/pcm/find.wav";
    if (!sound) return;

    bool exists = false;
    {
      SdLock lock;
      exists = SD.exists(sound) || SD.exists(String(sound).c_str()); // cheap guard; avoid early return if missing? log.
    }
    if (!exists) {
      DBG_PRINTF("[DOCK] sound req %s but file missing: %s\n", msgType.c_str(), sound);
      return;
    }

    DBG_PRINTF("[DOCK] sound req: %s (reason=%s)\n", msgType.c_str(), reason.c_str());

    // If the same sound is already playing, ignore duplicate triggers to avoid cutting it off.
    if (audio.isRunning() && currentlyPlayingFile.equalsIgnoreCase(sound)) {
      DBG_PRINTLN("[DOCK] sound already playing; ignoring duplicate");
      return;
    }

    // Simple debounce to avoid rapid re-triggers from touch events
    unsigned long nowMs = millis();
    if (lastDockSoundPath.equalsIgnoreCase(sound) && (nowMs - lastDockSoundMs < 700)) {
      DBG_PRINTLN("[DOCK] sound debounce; skipping duplicate");
      return;
    }
    lastDockSoundMs = nowMs;
    lastDockSoundPath = sound;

    // Play immediately without re-arming STA chimes
    stopSystemSoundForDock();
    playSystemSound(sound);
  }

  void handleDockClearPairs(JsonDocument& doc) {
    const String reqDockMac = doc["dock_mac"] | "";
    const String reqDockId  = doc["dock_id"] | "";

    if (!dockPair.dockMac.length()) {
      DBG_PRINTLN("[DOCK] clear_pairs ignored; no saved dock_mac");
      return;
    }
    if (!reqDockMac.length() || reqDockMac != dockPair.dockMac) {
      DBG_PRINTLN("[DOCK] clear_pairs ignored; dock_mac mismatch");
      return;
    }
    if (dockPair.dockId.length() && reqDockId.length() && reqDockId != dockPair.dockId) {
      DBG_PRINTLN("[DOCK] clear_pairs ignored; dock_id mismatch");
      return;
    }

    clearDockPairing();
    DBG_PRINTLN("[DOCK] clear_pairs processed; pairing cleared");
  }

  void pumpDockUdpListener() {
    ensureDockUdpStarted();
    if (!dockUdpStarted) return;
    int packetSize = dockUdp.parsePacket();
    while (packetSize > 0) {
      IPAddress remoteIp = dockUdp.remoteIP();
      uint16_t remotePort = dockUdp.remotePort();
      char buf[384];
      int len = dockUdp.read(buf, sizeof(buf) - 1);
      buf[len] = '\0';

      StaticJsonDocument<384> doc;
      DeserializationError err = deserializeJson(doc, buf);
      if (err) {
        DBG_PRINTLN("[DOCK] JSON parse failed");
      } else {
        const String msgType = doc["type"] | "";
        if (msgType == "pair_request") {
          handleDockPairRequest(doc, remoteIp, remotePort);
        } else if (msgType == "data_request") {
          handleDockDataRequest(doc, remoteIp, remotePort);
        } else if (msgType == "unpair_request") {
          handleDockUnpairRequest(doc, remoteIp, remotePort);
        } else if (msgType == "dock_home" || msgType == "find_rover") {
          handleDockSoundRequest(doc, msgType);
        } else if (msgType == "clear_pairs") {
          handleDockClearPairs(doc);
        }
      }

      packetSize = dockUdp.parsePacket();
    }
  }

  // ----------- Battery, Charger, WiFi, Temp, Uptime Telemetry -----------
  void sendBatteryTelemetryIfIdle() {
      static unsigned long lastTelemetrySend = 0;
      static float filteredBatteryVoltage = 0;
      static float filteredChargerVoltage = 0;
      const float filterAlpha = 0.15; // 0.05–0.3, lower = smoother, slower

      if (!audio.isRunning() && millis() - lastTelemetrySend > 1000) {
          lastTelemetrySend = millis();

          int adcRaw = analogRead(BLevel);
          int adcRawCharging = analogRead(CSense);

          const float battR1 = 22000.0, battR2 = 10000.0;
          const float correctionFactorB = 8.4 / 10;
          float batteryVoltage = (adcRaw * 3.3 / 4095.0) * ((battR1 + battR2) / battR2) * correctionFactorB;

          const float chgR1 = 10000.0, chgR2 = 6800.0;
          float chargerVoltage = (adcRawCharging * 3.3 / 4095.0) * ((chgR1 + chgR2) / chgR2);

          // --- SOFTWARE FILTER: Exponential Moving Average (EMA) ---
          if (filteredBatteryVoltage == 0) filteredBatteryVoltage = batteryVoltage;
          filteredBatteryVoltage = filterAlpha * batteryVoltage + (1 - filterAlpha) * filteredBatteryVoltage;

          if (filteredChargerVoltage == 0) filteredChargerVoltage = chargerVoltage;
          filteredChargerVoltage = filterAlpha * chargerVoltage + (1 - filterAlpha) * filteredChargerVoltage;

          // --- Use filteredBatteryVoltage & filteredChargerVoltage below! ---
          const float MIN_BATTERY_VOLTAGE = 6.6;
          const float MAX_BATTERY_VOLTAGE = 8.3;
          int batteryPercent = constrain((int)(((filteredBatteryVoltage - MIN_BATTERY_VOLTAGE) / (MAX_BATTERY_VOLTAGE - MIN_BATTERY_VOLTAGE)) * 100.0), 0, 100);

          int rssi = WiFi.RSSI();
          lastRssiDbm = rssi;
          int wifiQuality = constrain(2 * (rssi + 100), 0, 100);

          const char* chargingStatus = "UNKNOWN";

          // --- CHARGER & SOUND LOGIC ---
          if (filteredChargerVoltage > 4) {
              chargingStatus = "YES";
              isCharging = true;
              if (!wasCharging) {
                  playSystemSound("/web/pcm/charging.wav");
                  wasCharging = true;
                  endChargingPlayed = false;
              }
              if (batteryPercent >= 100) {
                  if (!chargingCompletePlayed) {
                      playSystemSound("/web/pcm/chargeComplete.wav");
                      chargingCompletePlayed = true;
                  }
                  wasFullyCharged = true;
              } else {
                  chargingCompletePlayed = false;
                  wasFullyCharged = false;
              }
          } else if (filteredChargerVoltage < 2.5) {
              chargingStatus = "NO";
              isCharging = false;
              if (wasCharging) {
                  if (!endChargingPlayed) {
                      playSystemSound("/web/pcm/endCharging.wav");
                      endChargingPlayed = true;
                  }
                  wasCharging = false;
              }
              chargingCompletePlayed = false;
              wasFullyCharged = false;
          } else {
              chargingStatus = "FAULT";
              isCharging = false;
              playSystemSound("/web/pcm/error (5).wav");
              wasCharging = false;
              chargingCompletePlayed = false;
              endChargingPlayed = false;
              wasFullyCharged = false;
          }

          // --- LOW BATTERY ALERT LOGIC ---
          if (batteryPercent <= 5) {
              lowBatteryAlertActive = true;
          } else {
              lowBatteryAlertActive = false;
              lastLowBatteryBeep = 0;
          }

          if (lowBatteryAlertActive && !audio.isRunning()) {
              if (millis() - lastLowBatteryBeep > 30000) {
                  playSystemSound("/web/pcm/beep.wav");
                  lastLowBatteryBeep = millis();
              }
          }

          unsigned long uptimeSecs = millis() / 1000;
          float chipTemp = temperatureRead();

          // ---- Fill currentSample for MQTT! ----
          currentSample.batteryPercent = batteryPercent;
          currentSample.voltage        = filteredBatteryVoltage;
          currentSample.charger        = filteredChargerVoltage;
          currentSample.wifi           = wifiQuality;
          currentSample.temp           = chipTemp;

          updateDockHeartbeatState(batteryPercent, filteredBatteryVoltage, filteredChargerVoltage, chargingStatus);

          wsPrintfAll("BATT,%d,%.2f,%d", batteryPercent, filteredBatteryVoltage, wifiQuality);
          wsPrintfAll("CHARGE,%s", chargingStatus);
          wsPrintfAll("STATS,%lu,%.1f", uptimeSecs, chipTemp);

          batteryPercentDisplay = batteryPercent;
          wifiSignalStrength = wifiQuality;
      }
  }

  // ----------- IMU Telemetry -----------
  void sendImuTelemetry() {
    static unsigned long lastImuSend = 0;
    ensureImuStartedLazy();
    if (!imuPresent) return;
    if (millis() - lastImuSend > 500) {
      lastImuSend = millis();
      imu::Vector<3> euler = bno055.getVector(Adafruit_BNO055::VECTOR_EULER);
      imu::Vector<3> mag   = bno055.getVector(Adafruit_BNO055::VECTOR_MAGNETOMETER);
      float temp = bno055.getTemp();
      wsPrintfAll("IMU,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f",
                  euler.x(), euler.y(), euler.z(),
                  mag.x(), mag.y(), mag.z(), temp);

      // ---- Fill currentSample for MQTT! ----
      currentSample.imu_euler_x = euler.x();
      currentSample.imu_euler_y = euler.y();
      currentSample.imu_euler_z = euler.z();
      currentSample.imu_mag_x   = mag.x();
      currentSample.imu_mag_y   = mag.y();
      currentSample.imu_mag_z   = mag.z();
      currentSample.imu_temp    = temp;
    }
  }

  // ----------- FPS Telemetry -----------
  void sendFpsTelemetry() {
    static unsigned long lastFpsSend = 0;
    static int lastFps = 0;
    if (millis() - lastFpsSend > 1000) {
      lastFpsSend = millis();
      lastFps = frameCount;
      wsSendKeyInt("FPS", lastFps);
      {
        const uint32_t totalHeap = ESP.getHeapSize();
        const uint32_t freeHeap  = ESP.getFreeHeap();
        wsPrintfAll("HEAP,%u,%u", totalHeap, freeHeap);
      }
      {
        const uint32_t totalPsram = ESP.getPsramSize();
        const uint32_t freePsram  = ESP.getFreePsram();
        wsPrintfAll("PSRAM,%u,%u", totalPsram, freePsram);
      }
      frameCount = 0;

      // ---- Fill currentSample for MQTT! ----
      currentSample.fps = lastFps;
    }
  }

//----------------------------------------------------------------------Serial Commands and debug---------------------------------------------------

  void printSerialHelp() {
    DBG_PRINTLN("Serial commands:");
    DBG_PRINTLN(" help                Show this list");
    DBG_PRINTLN(" P<path>             Play WAV from SD (e.g., P /web/pcm/beep.wav)");
    DBG_PRINTLN(" F|B|L|R<num>        Legacy motor control (Forward/Backward/Left/Right)");
    DBG_PRINTLN(" next/previous       Track control");
    DBG_PRINTLN(" play/stop/random    Playback control");
    DBG_PRINTLN(" nextfolder          Advance to next SD folder");
    DBG_PRINTLN(" +/-                 Volume up/down");
    DBG_PRINTLN(" list                List current playlist");
    DBG_PRINTLN(" heap                Print system debug info");
    DBG_PRINTLN(" wifi                Print Wi-Fi debug info");
    DBG_PRINTLN(" serverreboot        Restart web server stack");
    DBG_PRINTLN(" reset/reboot        Reboot ESP32");
    DBG_PRINTLN(" dockadv on/off      Enable or disable dock discovery");
    DBG_PRINTLN(" adv on/off          Same as dockadv on/off");
    DBG_PRINTLN(" dockunpair          Clear saved dock pairing");
  }

  static void executeSerialCommand(String input) {
    input.trim();
    if (input.length() == 0) return;

    if (input.charAt(0) == 'P' && (input.length() > 1) && !isDigit(input.charAt(1))) {
      String filename = input.substring(1);
      filename.trim();
      DBG_PRINTF("[SERIAL] Requested play: '%s'\n", filename.c_str());
      if (!SD.exists(filename.c_str())) {
        DBG_PRINTF("[ERROR] File not found on SD: '%s'\n", filename.c_str());
      } else {
        playWavFileOnSpeaker(filename.c_str());
      }
      return;
    }

    if (input.length() > 1 &&
        (input.charAt(0) == 'F' || input.charAt(0) == 'B' || input.charAt(0) == 'L' || input.charAt(0) == 'R') &&
        isDigit(input.charAt(1))) {
      char cmd = input.charAt(0);
      int value = input.substring(1).toInt();
      if (cmd == 'F') controlMotorByDirection("Forward", value);
      else if (cmd == 'B') controlMotorByDirection("Backward", value);
      else if (cmd == 'L') controlMotorByDirection("Left", value);
      else if (cmd == 'R') controlMotorByDirection("Right", value);
      DBG_PRINTF("[SERIAL] Command: %c %d\n", cmd, value);
      return;
    }

    String cmd = input;
    cmd.toLowerCase();

    if (cmd == "help") printSerialHelp();
    else if (cmd == "next") nextTrack();
    else if (cmd == "heap" || cmd == "debug") printDebugInfo();
    else if (cmd == "serverreboot" || cmd == "rebootserver") {
      DBG_PRINTLN("[SERIAL] Triggering webServerReboot by command...");
      webServerReboot();
    }        
    else if (cmd == "wifi" || cmd == "debug") printWifiDebugInfo();
    else if (cmd == "previous") prevTrack();
    else if (cmd == "play") playCurrentTrack();
    else if (cmd == "stop") {
      stopAudio();
      DBG_PRINTLN("[STOP]");
    }
    else if (cmd == "random") randomTrack();
    else if (cmd == "nextfolder") nextFolder();
    else if (cmd == "reset" || cmd == "reboot") resetESP();
    else if (cmd == "dockadv on" || cmd == "adv on") {
      dockDiscoveryEnabled = true;
      dockPair.paired = false;
      lastDockDiscoveryMs = 0;
      saveDockPairingToPrefs();
      DBG_PRINTLN("[DOCK] discovery enabled via serial");
    }
    else if (cmd == "dockadv off" || cmd == "adv off") {
      dockDiscoveryEnabled = false;
      saveDockPairingToPrefs();
      DBG_PRINTLN("[DOCK] discovery disabled via serial");
    }
    else if (cmd == "dockunpair") {
      clearDockPairing();
      DBG_PRINTLN("[DOCK] pairing cleared via serial");
    }
    else if (cmd == "+") setVolume(currentVolume + 1);
    else if (cmd == "-") setVolume(currentVolume - 1);
    else if (cmd == "list") {
      DBG_PRINTLN("Current playlist:");
      for (size_t i = 0; i < playlist.size(); ++i) {
        DBG_PRINTF("[%d] %s\n", i, playlist[i].c_str());
      }
    } else {
      DBG_PRINTF("[UNKNOWN COMMAND] '%s'\n", input.c_str());
    }
  }

  void handleSerialCommands() {
    if (!Serial.available()) return;
    String input = "";
    while (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') break;
      input += c;
      delay(2);
    }
    executeSerialCommand(input);
  }

  void printDebugInfo() {
    DBG_PRINTLN(F("==== ESP32 Debug Info ===="));
    DBG_PRINTF("Free heap:      %u bytes\n", ESP.getFreeHeap());
    DBG_PRINTF("Min free heap:  %u bytes\n", ESP.getMinFreeHeap());
    DBG_PRINTF("Heap size:      %u bytes\n", ESP.getHeapSize());
    DBG_PRINTF("Max alloc heap: %u bytes\n", ESP.getMaxAllocHeap());
    DBG_PRINTF("Uptime:         %lu ms\n", millis());
    DBG_PRINTF("Sketch size:    %u bytes\n", ESP.getSketchSize());
    DBG_PRINTF("Flash chip size:%u bytes\n", ESP.getFlashChipSize());
    #ifdef ESP_IDF_VERSION_MAJOR
      DBG_PRINTF("ESP-IDF v%d.%d.%d\n", ESP_IDF_VERSION_MAJOR, ESP_IDF_VERSION_MINOR, ESP_IDF_VERSION_PATCH);
    #endif
      DBG_PRINTLN("==========================");
  }

  void printWifiDebugInfo() {
    DBG_PRINTLN("------ Debug Info ------");

    // General heap/PSRAM status
    DBG_PRINTF("Free Heap:   %u bytes\n", ESP.getFreeHeap());
    #if CONFIG_IDF_TARGET_ESP32S3
      DBG_PRINTF("Free PSRAM:  %u bytes\n", ESP.getFreePsram());
    #endif

    // Wi-Fi stack status
    wl_status_t status = WiFi.status();
    const char* wifiStatusStr =
      (status == WL_CONNECTED)      ? "CONNECTED" :
      (status == WL_NO_SSID_AVAIL)  ? "NO_SSID_AVAIL" :
      (status == WL_IDLE_STATUS)    ? "IDLE_STATUS" :
      (status == WL_SCAN_COMPLETED) ? "SCAN_COMPLETED" :
      (status == WL_CONNECT_FAILED) ? "CONNECT_FAILED" :
      (status == WL_CONNECTION_LOST)? "CONNECTION_LOST" :
      (status == WL_DISCONNECTED)   ? "DISCONNECTED" : "UNKNOWN";
    DBG_PRINTF("WiFi.status(): %d (%s)\n", status, wifiStatusStr);

    // Detailed Wi-Fi info
    DBG_PRINTF("IP Address:   %s\n", WiFi.localIP().toString().c_str());
    DBG_PRINTF("Gateway:      %s\n", WiFi.gatewayIP().toString().c_str());
    DBG_PRINTF("Subnet Mask:  %s\n", WiFi.subnetMask().toString().c_str());
    DBG_PRINTF("DNS 1:        %s\n", WiFi.dnsIP(0).toString().c_str());
    DBG_PRINTF("DNS 2:        %s\n", WiFi.dnsIP(1).toString().c_str());
    DBG_PRINTF("RSSI:         %d dBm\n", WiFi.RSSI());
    DBG_PRINTF("Hostname:     %s\n", WiFi.getHostname());

    // Print AP details if connected
    if (status == WL_CONNECTED) {
      DBG_PRINTF("SSID:         %s\n", WiFi.SSID().c_str());
      DBG_PRINTF("BSSID:        %s\n", WiFi.BSSIDstr().c_str());
      DBG_PRINTF("Channel:      %d\n", WiFi.channel());
      // No PHY mode on ESP32S3, skip
    }

    // WebSocket status
    DBG_PRINTF("WebSocket clients: %u\n", wsCarInput.count());
    for (auto& c : wsCarInput.getClients()) {
        DBG_PRINTF("  WS Client #%u, IP: %s, status: %s\n",
          c.id(), c.remoteIP().toString().c_str(), c.status() ? "Connected" : "Not Connected");
    }


    DBG_PRINTLN("------------------------");
  }


//------------------------------------------------------------------------------MQTT----------------------------------------------------------------

  String getDeviceBlock() {
    String ipStr = WiFi.localIP().toString();
    String s3Id = getS3Id();
    return
      "\"device\":{"
        "\"identifiers\":[\"" + s3Id + "\"],"
        "\"connections\":[[\"ip\",\"" + ipStr + "\"]],"
        "\"manufacturer\":\"https://github.com/elik745i/miniexco.v1\","
        "\"model\":\"MiniExco S3\","
        "\"name\":\"MiniExco Robot\","
        "\"sw_version\":\"" FIRMWARE_VERSION "\""
      "}";
  }

  void loadMqttConfig() {
    prefs.begin("mqtt", true);
    mqttCfg.enable = prefs.getBool("enable", false);
    mqttCfg.host = prefs.getString("host", "");
    mqttCfg.port = prefs.getInt("port", 1883);
    mqttCfg.user = prefs.getString("user", "");
    mqttCfg.pass = prefs.getString("pass", "");
    mqttCfg.topic_prefix = prefs.getString("topic", "");
    prefs.end();
  }

  void saveMqttConfig(const MQTTConfig& cfg) {
    prefs.begin("mqtt", false);
    prefs.putBool("enable", cfg.enable);
    prefs.putString("host", cfg.host);
    prefs.putInt("port", cfg.port);
    prefs.putString("user", cfg.user);
    prefs.putString("pass", cfg.pass);
    prefs.putString("topic", cfg.topic_prefix);
    prefs.end();
  }

  void publishMqttDiscovery() {
    String prefix = getMqttPrefix();
    String s3Id = getS3Id();
    auto uid = [&](const String& suffix){ return s3Id + "_" + suffix; };
    String device = getDeviceBlock();
    auto publishCfg = [&](const String& topic, const String& payload){
      mqtt.publish(topic.c_str(), payload.c_str(), true);
    };

    publishCfg(
      "homeassistant/sensor/" + prefix + "battery/config",
      "{\"name\":\"Battery Level\","
       "\"state_topic\":\"" + prefix + "battery\","
       "\"unit_of_measurement\":\"%\","
       "\"device_class\":\"battery\","
       "\"unique_id\":\"" + uid("battery") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "battery_voltage/config",
      "{\"name\":\"Battery Voltage\","
       "\"state_topic\":\"" + prefix + "battery_voltage\","
       "\"unit_of_measurement\":\"V\","
       "\"device_class\":\"voltage\","
       "\"unique_id\":\"" + uid("battvolt") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "charger_voltage/config",
      "{\"name\":\"Charger Voltage\","
       "\"state_topic\":\"" + prefix + "charger_voltage\","
       "\"unit_of_measurement\":\"V\","
       "\"device_class\":\"voltage\","
       "\"unique_id\":\"" + uid("chvolt") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "charging/config",
      "{\"name\":\"Charging Status\","
       "\"state_topic\":\"" + prefix + "charging\","
       "\"unique_id\":\"" + uid("charging") + "\","
       "\"icon\":\"mdi:battery-charging\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "wifi/config",
      "{\"name\":\"WiFi Signal\","
       "\"state_topic\":\"" + prefix + "wifi\","
       "\"unit_of_measurement\":\"%\","
       "\"device_class\":\"signal_strength\","
       "\"unique_id\":\"" + uid("wifi") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "chip_temp/config",
      "{\"name\":\"Chip Temperature\","
       "\"state_topic\":\"" + prefix + "chip_temp\","
       "\"unit_of_measurement\":\"C\","
       "\"device_class\":\"temperature\","
       "\"unique_id\":\"" + uid("chiptemp") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "fps/config",
      "{\"name\":\"Camera FPS\","
       "\"state_topic\":\"" + prefix + "fps\","
       "\"unit_of_measurement\":\"fps\","
       "\"unique_id\":\"" + uid("fps") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "uptime/config",
      "{\"name\":\"Uptime\","
       "\"state_topic\":\"" + prefix + "uptime\","
       "\"unit_of_measurement\":\"s\","
       "\"icon\":\"mdi:clock-outline\","
       "\"unique_id\":\"" + uid("uptime") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "imu_roll/config",
      "{\"name\":\"IMU Roll\","
       "\"state_topic\":\"" + prefix + "imu_roll\","
       "\"unit_of_measurement\":\"deg\","
       "\"icon\":\"mdi:axis-x-rotate-clockwise\","
       "\"unique_id\":\"" + uid("imu_roll") + "\","
       + device +
      "}"
    );
    publishCfg(
      "homeassistant/sensor/" + prefix + "imu_pitch/config",
      "{\"name\":\"IMU Pitch\","
       "\"state_topic\":\"" + prefix + "imu_pitch\","
       "\"unit_of_measurement\":\"deg\","
       "\"icon\":\"mdi:axis-y-rotate-clockwise\","
       "\"unique_id\":\"" + uid("imu_pitch") + "\","
       + device +
      "}"
    );
    publishCfg(
      "homeassistant/sensor/" + prefix + "imu_yaw/config",
      "{\"name\":\"IMU Yaw\","
       "\"state_topic\":\"" + prefix + "imu_yaw\","
       "\"unit_of_measurement\":\"deg\","
       "\"icon\":\"mdi:axis-z-rotate-clockwise\","
       "\"unique_id\":\"" + uid("imu_yaw") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "imu_mag_x/config",
      "{\"name\":\"IMU Mag X\","
       "\"state_topic\":\"" + prefix + "imu_mag_x\","
       "\"icon\":\"mdi:magnet\","
       "\"unique_id\":\"" + uid("imu_mag_x") + "\","
       + device +
      "}"
    );
    publishCfg(
      "homeassistant/sensor/" + prefix + "imu_mag_y/config",
      "{\"name\":\"IMU Mag Y\","
       "\"state_topic\":\"" + prefix + "imu_mag_y\","
       "\"icon\":\"mdi:magnet\","
       "\"unique_id\":\"" + uid("imu_mag_y") + "\","
       + device +
      "}"
    );
    publishCfg(
      "homeassistant/sensor/" + prefix + "imu_mag_z/config",
      "{\"name\":\"IMU Mag Z\","
       "\"state_topic\":\"" + prefix + "imu_mag_z\","
       "\"icon\":\"mdi:magnet\","
       "\"unique_id\":\"" + uid("imu_mag_z") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/sensor/" + prefix + "imu_temp/config",
      "{\"name\":\"IMU Temperature\","
       "\"state_topic\":\"" + prefix + "imu_temp\","
       "\"unit_of_measurement\":\"C\","
       "\"device_class\":\"temperature\","
       "\"unique_id\":\"" + uid("imutemp") + "\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/switch/" + prefix + "light/config",
      "{\"name\":\"Robot Light\","
       "\"command_topic\":\"" + prefix + "light/set\","
       "\"state_topic\":\"" + prefix + "light\","
       "\"unique_id\":\"" + uid("light") + "\","
       "\"icon\":\"mdi:lightbulb\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/switch/" + prefix + "beacon/config",
      "{\"name\":\"Beacon\","
       "\"command_topic\":\"" + prefix + "beacon/set\","
       "\"state_topic\":\"" + prefix + "beacon\","
       "\"unique_id\":\"" + uid("beacon") + "\","
       "\"icon\":\"mdi:car-light-high\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/switch/" + prefix + "emergency/config",
      "{\"name\":\"Emergency\","
       "\"command_topic\":\"" + prefix + "emergency/set\","
       "\"state_topic\":\"" + prefix + "emergency\","
       "\"unique_id\":\"" + uid("emergency") + "\","
       "\"icon\":\"mdi:alarm-light\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/button/" + prefix + "arm_up/config",
      "{\"name\":\"Arm Up\","
       "\"command_topic\":\"" + prefix + "arm_up/set\","
       "\"unique_id\":\"" + uid("armup") + "\","
       "\"icon\":\"mdi:arrow-up-bold-box\","
       + device +
      "}"
    );
    publishCfg(
      "homeassistant/button/" + prefix + "arm_down/config",
      "{\"name\":\"Arm Down\","
       "\"command_topic\":\"" + prefix + "arm_down/set\","
       "\"unique_id\":\"" + uid("armdown") + "\","
       "\"icon\":\"mdi:arrow-down-bold-box\","
       + device +
      "}"
    );

    const char* dirs[] = {"forward","backward","left","right","stop"};
    const char* icons[] = {
      "mdi:arrow-up-bold-box",
      "mdi:arrow-down-bold-box",
      "mdi:arrow-left-bold-box",
      "mdi:arrow-right-bold-box",
      "mdi:stop-circle-outline"
    };
    for (int i = 0; i < 5; i++) {
      String dirLabel = String(dirs[i]);
      dirLabel.setCharAt(0, toupper(dirLabel.charAt(0)));
      publishCfg(
        "homeassistant/button/" + prefix + dirs[i] + "/config",
        "{\"name\":\"Move " + dirLabel + "\","
         "\"command_topic\":\"" + prefix + dirs[i] + "/set\","
         "\"unique_id\":\"" + uid(dirs[i]) + "\","
         "\"icon\":\"" + String(icons[i]) + "\","
         + device +
        "}"
      );
    }

    publishCfg(
      "homeassistant/number/" + prefix + "bucket_tilt/config",
      "{\"name\":\"Bucket Tilt\","
       "\"command_topic\":\"" + prefix + "bucket_tilt/set\","
       "\"state_topic\":\"" + prefix + "bucket_tilt\","
       "\"min\":0,"
       "\"max\":180,"
       "\"step\":1,"
       "\"unit_of_measurement\":\"deg\","
       "\"unique_id\":\"" + uid("buckettilt") + "\","
       "\"icon\":\"mdi:bucket-outline\","
       + device +
      "}"
    );

    publishCfg(
      "homeassistant/number/" + prefix + "aux_tilt/config",
      "{\"name\":\"AUX Tilt\","
       "\"command_topic\":\"" + prefix + "aux_tilt/set\","
       "\"state_topic\":\"" + prefix + "aux_tilt\","
       "\"min\":0,"
       "\"max\":180,"
       "\"step\":1,"
       "\"unit_of_measurement\":\"deg\","
       "\"unique_id\":\"" + uid("auxtilt") + "\","
       "\"icon\":\"mdi:tools\","
       + device +
      "}"
    );

    // ---- Add more as needed...
  }


  void mqttCallback(char* topic, byte* payload, unsigned int length) {
    payload[length] = '\0'; // Ensure null-terminated string
    String msg = (char*)payload;
    String tpc = String(topic);

    String prefix = getMqttPrefix();

    // ---- Light Switch ----
    if (tpc == prefix + "light/set") {
      msg.toUpperCase();
      if (msg == "ON" || msg == "1" || msg == "true" || msg == "TRUE") {
        light = true;
        lightControl(); // Turn light ON
        mqtt.publish((prefix + "light").c_str(), "ON", true);
      } else {
        light = false;
        lightControl(); // Turn light OFF
        mqtt.publish((prefix + "light").c_str(), "OFF", true);
      }
    }

    // ---- Beacon Switch ----
    else if (tpc == prefix + "beacon/set") {
      msg.toUpperCase();
      if (msg == "ON" || msg == "1" || msg == "true" || msg == "TRUE") {
        beaconOn = true;
        updatePixels();
        mqtt.publish((prefix + "beacon").c_str(), "ON", true);
      } else {
        beaconOn = false;
        updatePixels();
        mqtt.publish((prefix + "beacon").c_str(), "OFF", true);
      }
    }

    // ---- Emergency Switch ----
    else if (tpc == prefix + "emergency/set") {
      msg.toUpperCase();
      if (msg == "ON" || msg == "1" || msg == "true" || msg == "TRUE") {
        emergencyOn = true;
        updatePixels();
        mqtt.publish((prefix + "emergency").c_str(), "ON", true);
      } else {
        emergencyOn = false;
        updatePixels();
        mqtt.publish((prefix + "emergency").c_str(), "OFF", true);
      }
    }

    // ---- Arm Up ----
    else if (tpc == prefix + "arm_up/set") {
      armMotorUp();
      mqtt.publish((prefix + "arm_state").c_str(), "UP", true);
    }

    // ---- Arm Down ----
    else if (tpc == prefix + "arm_down/set") {
      armMotorDown();
      mqtt.publish((prefix + "arm_state").c_str(), "DOWN", true);
    }

    // ---- Movement ----
    else if (tpc == prefix + "forward/set") {
      moveCar(UP);
      mqtt.publish((prefix + "move_state").c_str(), "FORWARD", true);
    }
    else if (tpc == prefix + "backward/set") {
      moveCar(DOWN);
      mqtt.publish((prefix + "move_state").c_str(), "BACKWARD", true);
    }
    else if (tpc == prefix + "left/set") {
      moveCar(LEFT);
      mqtt.publish((prefix + "move_state").c_str(), "LEFT", true);
    }
    else if (tpc == prefix + "right/set") {
      moveCar(RIGHT);
      mqtt.publish((prefix + "move_state").c_str(), "RIGHT", true);
    }
    else if (tpc == prefix + "stop/set") {
      moveCar(STOP);
      mqtt.publish((prefix + "move_state").c_str(), "STOP", true);
    }

    // ---- Bucket Tilt ----
    else if (tpc == prefix + "bucket_tilt/set") {
      int angle = msg.toInt();
      angle = constrain(angle, 0, 180);
      bucketTilt(angle);
      mqtt.publish((prefix + "bucket_tilt").c_str(), String(angle).c_str(), true);
    }

    // ---- AUX Tilt ----
    else if (tpc == prefix + "aux_tilt/set") {
      int angle = msg.toInt();
      angle = constrain(angle, 0, 180);
      auxControl(angle);
      mqtt.publish((prefix + "aux_tilt").c_str(), String(angle).c_str(), true);
    }

    // ---- (Optional: add more control topics as needed) ----
  }

  void mqttBegin() {
    loadMqttConfig();

    if (!mqttCfg.enable) {
      mqttConnected = false;
      mqttLastError = "MQTT disabled in config";
      mqtt.disconnect();
      return;
    }

    mqtt.setServer(mqttCfg.host.c_str(), mqttCfg.port);
    mqtt.setCallback(mqttCallback);

    if (WiFi.status() != WL_CONNECTED) {
      mqttConnected = false;
      mqttLastError = "WiFi not connected";
      return;
    }

    bool result = false;
    if (mqttCfg.user.length()) {
      result = mqtt.connect(getS3Id().c_str(), mqttCfg.user.c_str(), mqttCfg.pass.c_str());
    } else {
      result = mqtt.connect(getS3Id().c_str());
    }

    if (result) {
      DBG_PRINTLN("✅ MQTT connected.");
      mqttConnected = true;
      mqttLastError = "";

      String prefix = getMqttPrefix();
      mqtt.subscribe((prefix + "light/set").c_str());
      mqtt.subscribe((prefix + "arm_up/set").c_str());
      mqtt.subscribe((prefix + "arm_down/set").c_str());
      mqtt.subscribe((prefix + "forward/set").c_str());
      mqtt.subscribe((prefix + "backward/set").c_str());
      mqtt.subscribe((prefix + "left/set").c_str());
      mqtt.subscribe((prefix + "right/set").c_str());
      mqtt.subscribe((prefix + "stop/set").c_str());
      mqtt.subscribe((prefix + "bucket_tilt/set").c_str());
      mqtt.subscribe((prefix + "aux_tilt/set").c_str());

      publishMqttDiscovery();
    } else {
      mqttConnected = false;
      mqttLastError = "Connect failed, state=" + String(mqtt.state());
      DBG_PRINT("❌ MQTT connect failed: ");
      DBG_PRINTLN(mqtt.state());
    }
  }

  void mqttDisconnect() {
    mqtt.disconnect();
    mqttConnected = false;
    mqttLastError = "Manually disconnected";
  }

  void publishPeriodicTelemetry() {
    unsigned long now = millis();
    if (now - lastMqttTelemetry >= mqttTelemetryInterval) {  
        String prefix = getMqttPrefix();

        mqtt.publish((prefix + "battery").c_str(), String(currentSample.batteryPercent).c_str(), true);
        mqtt.publish((prefix + "battery_voltage").c_str(), String(currentSample.voltage, 2).c_str(), true);
        mqtt.publish((prefix + "charger_voltage").c_str(), String(currentSample.charger, 2).c_str(), true);
        mqtt.publish((prefix + "charging").c_str(), currentSample.charger > 4 ? "YES" : "NO", true);
        mqtt.publish((prefix + "wifi").c_str(), String(currentSample.wifi).c_str(), true);
        mqtt.publish((prefix + "chip_temp").c_str(), String(currentSample.temp, 1).c_str(), true);
        mqtt.publish((prefix + "fps").c_str(), String(currentSample.fps).c_str(), true);
        mqtt.publish((prefix + "imu_roll").c_str(), String(currentSample.imu_euler_x, 1).c_str(), true);
        mqtt.publish((prefix + "imu_pitch").c_str(), String(currentSample.imu_euler_y, 1).c_str(), true);
        mqtt.publish((prefix + "imu_yaw").c_str(), String(currentSample.imu_euler_z, 1).c_str(), true);
        mqtt.publish((prefix + "imu_mag_x").c_str(), String(currentSample.imu_mag_x, 1).c_str(), true);
        mqtt.publish((prefix + "imu_mag_y").c_str(), String(currentSample.imu_mag_y, 1).c_str(), true);
        mqtt.publish((prefix + "imu_mag_z").c_str(), String(currentSample.imu_mag_z, 1).c_str(), true);
        mqtt.publish((prefix + "imu_temp").c_str(), String(currentSample.imu_temp, 1).c_str(), true);
        lastMqttTelemetry = now;
    }
  }


//-----------------------------------------------------------------------------SETUP--------------------------------------------------------------//


  void setup() {
    initSdMutex();
    initSerialLogStorage();

    #if DEBUG_SERIAL
      Serial.begin(115200);
      Serial.setDebugOutput(true);
      PRINT_HEAP("after_serial_begin");
    #endif

    WiFi.onEvent(onWiFiEvent);

    if (gpioPrefs.begin("gpio", false)) {
      loadGpioConfigFromPrefs();
    } else {
      gpioConfig = makeDefaultGpioConfig();
      DBG_PRINTLN("[GPIO] Failed to open preferences; using defaults");
    }
    applyGpioConfig(true);
    initHostnames();

    // Tweak #6: route larger malloc() allocations to PSRAM when available.
    // This makes internal heap changes more visible by shifting dynamic buffers out of SRAM.
    if (psramFound()) {
      heap_caps_malloc_extmem_enable(64);  // stronger offload to PSRAM for baseline heap relief
      DBG_PRINTLN("[PSRAM] extmem malloc enabled (threshold=64 bytes)");
    }

    audio.setBufsize(AUDIO_STREAM_RAM_BUF_BYTES, AUDIO_STREAM_PSRAM_BUF_BYTES);
    DBG_PRINTF("[AUDIO] stream buffer profile set (RAM=%d, PSRAM=%d)\n",
               AUDIO_STREAM_RAM_BUF_BYTES, AUDIO_STREAM_PSRAM_BUF_BYTES);

  // ---- Preferences ----
  wifiPrefs.begin("wifi", false);
  camPrefs.begin("camsettings", false);
  keymapPrefs.begin("keymap", false);
  joymapPrefs.begin("joymap", false);
  imuPrefs.begin("telemetry", false);
  uiPrefs.begin("ui", false);
  oledPrefs.begin("oled", false);
  camEnablePrefs.begin("enabled", false);
  dockPrefs.begin("dock", false);
  loadDockPairingFromPrefs();
    PRINT_HEAP("after_prefs");

    // AP password sanity
    g_apPassword = uiPrefs.getString("ap_pass", AP_PASSWORD_DEFAULT);
    if (g_apPassword.length() && (g_apPassword.length() < 8 || g_apPassword.length() > 63)) {
      g_apPassword = AP_PASSWORD_DEFAULT;
    }

    // UI prefs (leave as you had)
    darkMode        = uiPrefs.getBool("darkMode", false);
    horScreen       = uiPrefs.getBool("Switch", false);
    holdBucket      = uiPrefs.getBool("HoldBucket", false);
    holdAux         = uiPrefs.getBool("HoldAux", false);
    tlmEnabled      = uiPrefs.getBool("RecordTelemetry", false);
    sSndEnabled     = uiPrefs.getBool("SystemSounds", true);
    wsRebootOnDisconnect = loadWsRebootWatchdogPref();
    serialLogWsMinIntervalMs = clampSerialLogRateMs((int32_t)uiPrefs.getUInt(PREF_SERIALLOG_RATE_MS, SERIAL_LOG_RATE_MS_DEFAULT));
    serialLogRetainLines = clampSerialLogKeepLines((int32_t)uiPrefs.getUInt(PREF_SERIALLOG_KEEP_LINES, SERIAL_LOG_KEEP_LINES_DEFAULT));
    indicatorsVisible = uiPrefs.getBool(PREF_INDICATORS_VISIBLE, true);
    indicatorsPosX    = uiPrefs.getInt(PREF_INDICATORS_X, -1);
    indicatorsPosY    = uiPrefs.getInt(PREF_INDICATORS_Y, -1);
    imuVisible        = uiPrefs.getBool(PREF_IMU_VISIBLE, true);
    imuPosX           = uiPrefs.getInt(PREF_IMU_X, -1);
    imuPosY           = uiPrefs.getInt(PREF_IMU_Y, -1);
    mediaVisible      = uiPrefs.getBool(PREF_MEDIA_VISIBLE, true);
    mediaPosX         = uiPrefs.getInt(PREF_MEDIA_X, -1);
    mediaPosY         = uiPrefs.getInt(PREF_MEDIA_Y, -1);
    pathVisible       = uiPrefs.getBool(PREF_PATH_VISIBLE, true);
    pathPosX          = uiPrefs.getInt(PREF_PATH_X, -1);
    pathPosY          = uiPrefs.getInt(PREF_PATH_Y, -1);
    model3dVisible    = uiPrefs.getBool(PREF_MODEL3D_VISIBLE, true);
    model3dPosX       = uiPrefs.getInt(PREF_MODEL3D_X, -1);
    model3dPosY       = uiPrefs.getInt(PREF_MODEL3D_Y, -1);
    viewOverlapFxEnabled = uiPrefs.getBool(PREF_VIEW_OVERLAP_FX, true);
    viewSnapFxEnabled    = uiPrefs.getBool(PREF_VIEW_SNAP_FX, true);
    viewGravityFxEnabled = uiPrefs.getBool(PREF_VIEW_GRAVITY_FX, true);
    viewGravityFxStrength = constrain(uiPrefs.getInt(PREF_VIEW_GRAVITY_ST, 55), 0, 100);
    sSndVolume      = uiPrefs.getInt("SystemVolume", 15);
    modelRotXDeg    = uiPrefs.getInt("ModelRotX", 0);
    modelRotYDeg    = uiPrefs.getInt("ModelRotY", 0);
    modelRotZDeg    = uiPrefs.getInt("ModelRotZ", 0);
    modelDirX       = uiPrefs.getInt("ModelDirX", 1);
    modelDirY       = uiPrefs.getInt("ModelDirY", 1);
    modelDirZ       = uiPrefs.getInt("ModelDirZ", 1);
    modelDirX       = (modelDirX < 0) ? -1 : 1;
    modelDirY       = (modelDirY < 0) ? -1 : 1;
    modelDirZ       = (modelDirZ < 0) ? -1 : 1;
    modelAxisX      = constrain(uiPrefs.getInt("ModelAxisX", 0), 0, 2);
    modelAxisY      = constrain(uiPrefs.getInt("ModelAxisY", 1), 0, 2);
    modelAxisZ      = constrain(uiPrefs.getInt("ModelAxisZ", 2), 0, 2);
    telemetryFileMaxKB = clampTelemetryMaxKB((int32_t)uiPrefs.getUInt("TelemetryMaxKB", TELEMETRY_FILE_MAX_KB_DEFAULT));
    telemetryFileMaxSizeBytes = (size_t)telemetryFileMaxKB * 1024;
    bluepadEnabled  = uiPrefs.getBool("BluepadEnabled", false);

    initInputMapsIfEmpty();
    rebuildJoyActionCache();

    i2cStart();
    spiStart();
    initSdGate();
    auditPcmAssets();
    PRINT_HEAP("after_sd_init");

    // ---- Web / Wi-Fi ----
    WiFi.persistent(false);
    startLobbyServer();   // light lobby only; heavy routes attach on demand

    PRINT_HEAP("after_serverStart");

    // ---- mDNS / NTP / OTA / camera, etc. ----
    bool mdnsOk = startMdns();
    if (mdnsOk) {
      DBG_PRINTF("[mDNS] %s.local @ %s\n", g_mdnsHost.c_str(), WiFi.localIP().toString().c_str());
    } else {
      DBG_PRINTF("[mDNS] FAILED for %s\n", g_mdnsHost.c_str());
    }
    startNtpSync();
    PRINT_HEAP("after_ntp");

    loadCameraPrefs();
    if (cameraEnabled && !cameraInitialized) {
      cameraBootRestorePending = true;
      cameraBootRestoreNotBeforeMs = millis() + CAMERA_BOOT_RESTORE_DELAY_MS;
      cameraBootRestoreLastTryMs = 0;
      DBG_PRINTF("[CAM] Camera was enabled before reboot; deferring restore by %lu ms\n",
                 (unsigned long)CAMERA_BOOT_RESTORE_DELAY_MS);
    }
    isStreaming = false;
    // Keep camera HTTP server deferred until first camera enable to reduce idle heap.

    // Defer playlist load until first media use to save heap at boot

    if (bluepadEnabled) {
      handleBluepadStateChange(bluepadEnabled, false, false);
    }

    mqtt.setBufferSize(256);

    // Normalize boot baseline to the same state reached after opening/closing media UI.
    queueAudioEngineReset();
    processQueuedAudioEngineReset();

    DBG_PRINTF("<<< End of setup: heap=%u, PSRAM=%u\n", ESP.getFreeHeap(), ESP.getFreePsram());
    lastWebActivityMs = millis();   // watchdog timing for server disconnects

    
  }


//------------------------------------------------------------------------------LOOP--------------------------------------------------------------//

  void loop() {
    const uint32_t now = millis();
    pumpCameraBootRestore(now);

    // Audio
    audio.loop();
    processQueuedAudioEngineReset();
    static bool deviceWasRunning = false;
    bool runningNow = audio.isRunning();
    if (playbackStarted && !runningNow && deviceWasRunning && isDeviceMediaPath(currentlyPlayingFile)) {
      handleDevicePlaybackCompletion();
      runningNow = audio.isRunning();
    }
    deviceWasRunning = runningNow;
    pumpSystemSoundScheduler(now);

    #if DEBUG_SERIAL
      handleSerialCommands();
    #endif

    // Telemetry & logging
    sendBatteryTelemetryIfIdle();
    sendImuTelemetry();
    sendFpsTelemetry();
    if (tlmEnabled) flushTelemetryBufferToSD_Auto();
    pumpDockDiscovery();
    pumpDockUdpListener();

    // WS housekeeping
    wsCarInput.cleanupClients();
    runServoAutoDetach(now);

    // Animations (your existing)
    handleAnimationTimers();

    // ---- The only Wi-Fi brain you need ----
    handleWifiSimple();

    // Some lightweight UI flair (optional)
    static unsigned long lastGearFrame = 0;
    if (WiFi.status() == WL_CONNECTED) {
      if (now - lastGearFrame > 200) { animateGears(); lastGearFrame = now; }
    } else {
      static unsigned long lastApFrame = 0;
      if ((WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) && (now - lastApFrame > 200)) {
        animateAP(); lastApFrame = now;
      }
    }

    // If you keep this helper, it will speak STA IP once on connect
    if (WiFi.status() == WL_CONNECTED) {
      IPAddress currentStaIp = WiFi.localIP();
      if (currentStaIp != IPAddress(0,0,0,0) && !ss_announcedStaIp && !ss_staSpeechPending) {
        speakStaIpOrDefer(currentStaIp);
      }
    } else {
      ss_announcedStaIp = false;
      ss_staSpeechPending = false;
    }

    // Remainder of your app
    processReindexTask();
    pumpTimeSyncTick();
    streamMicToWebSocket();
    pumpRadioPlayRequest();
    sendDeviceMediaProgress();

    if (bluepadActive) {
      BP32.update();
      for (auto ctl : myControllers) {
        if (ctl && ctl->isConnected() && ctl->hasData()) handleControllerInput(ctl);
      }
    }

    // MQTT reconnect / discovery / loop
    if (mqttCfg.enable) {
      static unsigned long lastAttempt = 0;
      if (!mqtt.connected() && WiFi.status() == WL_CONNECTED) {
        if (now - lastAttempt > 5000) { lastAttempt = now; mqttBegin(); mqttDiscoveryPublished = false; }
      }
      if (mqtt.connected() && !mqttDiscoveryPublished) { publishMqttDiscovery(); mqttDiscoveryPublished = true; }
      if (mqtt.connected()) { publishPeriodicTelemetry(); mqtt.loop(); }
    }

  
      // --- Watchdog block (use the same 'now') ---
      static uint32_t _lastWdTick = 0;
      if (now - _lastWdTick >= 250) {
        _lastWdTick = now;

        if (wsRebootOnDisconnect && now >= WS_REBOOT_GRACE_MS) {
          if (hadAnyClientSinceBoot && wsActiveClients == 0) {
            uint32_t idleSince = (lastWsDisconnectMs > lastWebActivityMs)
                                  ? lastWsDisconnectMs : lastWebActivityMs;
            if (now - idleSince >= WS_REBOOT_TIMEOUT_MS) {
              resetESP();
            }
          }
        }
      }
  

    // Camera maintenance
    runAdaptiveCamera();

    delay(1);
  }



