#include "esp_http_server.h"
#include "esp_timer.h"
#include "img_converters.h"
#include "sdkconfig.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

// --- Pending camera change hook (set from main sketch) ---
volatile bool camAdjustPending = false;
volatile int  camPendingQuality = -1;
volatile int  camPendingFramesize = -1; // cast to framesize_t when used

extern "C" void requestCameraParams(framesize_t fs, int quality) {
    camPendingFramesize = (int)fs;
    camPendingQuality   = quality;
    camAdjustPending    = true;   // picked up between frames
}


static esp_err_t send_service_unavailable(httpd_req_t* req, const char* msg) {
#ifdef HTTPD_503_SERVICE_UNAVAILABLE
    // If the enum exists on this core, use it.
    return httpd_resp_send_err(req, HTTPD_503_SERVICE_UNAVAILABLE, msg);
#else
    // Portable fallback: set explicit status line and body.
    httpd_resp_set_status(req, "503 Service Unavailable");
    httpd_resp_set_type(req, "text/plain");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_sendstr(req, msg ? msg : "Service Unavailable");
    return ESP_FAIL;
#endif
}


static SemaphoreHandle_t stream_mutex = NULL;
static volatile httpd_req_t *active_stream_req = NULL;
static volatile bool stream_cancel = false;

extern volatile bool isSdUploadInProgress;
extern volatile bool isStreaming;
extern volatile int frameCount;
extern bool cameraInitialized;
extern bool cameraEnabled;
extern bool enableCamera();
extern httpd_handle_t camera_httpd;

static void close_active_stream_session() {
    if (!camera_httpd || !active_stream_req) {
        return;
    }
    httpd_req_t *req = (httpd_req_t *)active_stream_req;
    int sockfd = httpd_req_to_sockfd(req);
    if (sockfd >= 0) {
        httpd_sess_trigger_close(camera_httpd, sockfd);
    }
}

typedef struct {
    httpd_req_t *req;
    size_t len;
} jpg_chunking_t;

extern "C" void appHttpdPauseStreaming() {
    stream_cancel = true;
    isStreaming = false;
}

extern "C" void appHttpdResumeStreaming() {
    isStreaming = true;
}

extern "C" void appHttpdStopActiveStream() {
    stream_cancel = true;
    close_active_stream_session();
}

extern "C" void appHttpdStopServer() {
    stream_cancel = true;
    close_active_stream_session();
    vTaskDelay(pdMS_TO_TICKS(80));
    if (camera_httpd) {
        httpd_stop(camera_httpd);
        camera_httpd = NULL;
    }
}

#define PART_BOUNDARY "123456789000000000000987654321"
static const char *_STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *_STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *_STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\nX-Timestamp: %d.%06d\r\n\r\n";

httpd_handle_t camera_httpd = NULL;

static size_t jpg_encode_stream(void *arg, size_t index, const void *data, size_t len) {
    jpg_chunking_t *j = (jpg_chunking_t *)arg;
    if (!index) j->len = 0;
    if (httpd_resp_send_chunk(j->req, (const char *)data, len) != ESP_OK) return 0;
    j->len += len;
    return len;
}

static esp_err_t capture_handler(httpd_req_t *req) {
    // Block snapshot during SD upload to avoid I/O contention if you want:
    if (isSdUploadInProgress) {
        return send_service_unavailable(req, "SD upload in progress");
    }

    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }

    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");

    char ts[32];
    snprintf(ts, sizeof(ts), "%ld.%06ld", fb->timestamp.tv_sec, fb->timestamp.tv_usec);
    httpd_resp_set_hdr(req, "X-Timestamp", ts);

    esp_err_t res;
    if (fb->format == PIXFORMAT_JPEG) {
        res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
    } else {
        jpg_chunking_t jchunk = { req, 0 };
        res = frame2jpg_cb(fb, 80, jpg_encode_stream, &jchunk) ? ESP_OK : ESP_FAIL;
        httpd_resp_send_chunk(req, NULL, 0);
    }

    esp_camera_fb_return(fb);
    return res;
}

static esp_err_t stream_handler(httpd_req_t *req) {
    // --- One-client-at-a-time with graceful cancel ---
    if (!stream_mutex) {
        // In case startCameraServer() hasn’t run yet; but we also create it there.
        stream_mutex = xSemaphoreCreateMutex();
    }

    if (!xSemaphoreTake(stream_mutex, 0)) {
        // Ask the running stream to stop and wait briefly for it to release.
        stream_cancel = true;
        close_active_stream_session();
        if (!xSemaphoreTake(stream_mutex, pdMS_TO_TICKS(1200))) {
            return send_service_unavailable(req, "Stream busy");
        }
    }
    // We hold the mutex now; clear cancel and become active.
    stream_cancel = false;
    active_stream_req = req;

    // If uploads or streaming is disabled, wait briefly for resume before failing
    if (isSdUploadInProgress || !isStreaming) {
        const uint32_t startWait = (uint32_t)esp_timer_get_time() / 1000ULL;
        while (!isStreaming && !isSdUploadInProgress) {
            vTaskDelay(pdMS_TO_TICKS(50));
            uint32_t waited = ((uint32_t)esp_timer_get_time() / 1000ULL) - startWait;
            if (waited > 2000) break; // 2s max wait
        }
        if (isSdUploadInProgress || !isStreaming) {
            active_stream_req = NULL;
            xSemaphoreGive(stream_mutex);
            return send_service_unavailable(req, "Streaming disabled or SD upload in progress");
        }
    }

    if (!cameraInitialized) {
        bool ok = enableCamera();
        if (!ok) {
            cameraEnabled = false;
            xSemaphoreGive(stream_mutex);
            return send_service_unavailable(req, "Camera not ready");
        }
    }

    camera_fb_t *fb = NULL;
    struct timeval _timestamp = {0};
    esp_err_t res = ESP_OK;
    size_t _jpg_buf_len = 0;
    uint8_t *_jpg_buf = NULL;
    char part_buf[256];
    uint32_t lastFrameTick = (uint32_t)(esp_timer_get_time() / 1000ULL);

    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "X-Framerate", "60"); // static hint
    httpd_resp_set_hdr(req, "Connection", "close");

    res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
    if (res != ESP_OK) {
        active_stream_req = NULL;
        xSemaphoreGive(stream_mutex);
        return res;
    }

    uint32_t loopCount = 0;

    while (true) {
        // Mid-stream checks to stop cleanly:
        if (stream_cancel || isSdUploadInProgress || !isStreaming) {
            res = ESP_OK;
            break;
        }

        // If the client disconnected, stop pushing data
        if (httpd_req_to_sockfd(req) < 0) {
            res = ESP_FAIL;
            break;
        }

        // If the main sketch requested a change, apply it before grabbing next frame
        if (camAdjustPending) {
            sensor_t* s = esp_camera_sensor_get();
            if (s) {
                if (camPendingFramesize >= 0 && (int)s->status.framesize != camPendingFramesize) {
                    s->set_framesize(s, (framesize_t)camPendingFramesize);
                }
                if (camPendingQuality >= 0 && (int)s->status.quality != camPendingQuality) {
                    s->set_quality(s, camPendingQuality);
                }
            }
            camAdjustPending = false; // clear request
        }

        fb = esp_camera_fb_get();
        if (!fb) {
            res = ESP_FAIL;
        } else {
            _timestamp = fb->timestamp;
            if (fb->format != PIXFORMAT_JPEG) {
                bool ok = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
                taskYIELD(); // let Wi-Fi/RTOS breathe during conversion
                esp_camera_fb_return(fb);
                fb = NULL;
                if (!ok) {
                    res = ESP_FAIL;
                }
            } else {
                _jpg_buf = fb->buf;
                _jpg_buf_len = fb->len;
            }
        }

        if (res == ESP_OK) {
            int hlen = snprintf(part_buf, sizeof(part_buf),
                                "%s"
                                "Content-Type: image/jpeg\r\n"
                                "Content-Length: %u\r\n"
                                "X-Timestamp: %d.%06d\r\n\r\n",
                                _STREAM_BOUNDARY,
                                (unsigned)_jpg_buf_len,
                                (int)_timestamp.tv_sec,
                                (int)_timestamp.tv_usec);
            res = httpd_resp_send_chunk(req, part_buf, hlen);
        }
        if (res == ESP_OK) {
            res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
        }

        // Return or free buffers
        if (fb) {
            esp_camera_fb_return(fb);
            fb = NULL;
            _jpg_buf = NULL;
        } else if (_jpg_buf) {
            free(_jpg_buf);
            _jpg_buf = NULL;
        }

        if (res != ESP_OK) break;

        // Count every delivered frame
        frameCount++;

        // Simple pacing so Wi-Fi is not starved
        uint32_t now = (uint32_t)(esp_timer_get_time() / 1000ULL);
        uint32_t elapsed = now - lastFrameTick;
        const uint32_t targetMs = 60; // ~16-17 fps ceiling to reduce Wi-Fi load
        if (elapsed < targetMs) {
            vTaskDelay(pdMS_TO_TICKS(targetMs - elapsed));
        } else {
            taskYIELD();
        }
        // Extra cooperative yield every few frames to let TCP/IP and WS drain
        if ((loopCount++ & 0x3) == 0) {
            vTaskDelay(1);
        }
        lastFrameTick = (uint32_t)(esp_timer_get_time() / 1000ULL);
    }

    // End response cleanly (even on cancel) – ignore return here
    httpd_resp_send_chunk(req, NULL, 0);

    active_stream_req = NULL;
    xSemaphoreGive(stream_mutex);
    return res;
}





static esp_err_t parse_get(httpd_req_t *req, char **obuf){
    char *buf = NULL;
    size_t buf_len = 0;

    buf_len = httpd_req_get_url_query_len(req) + 1;
    if (buf_len > 1) {
        buf = (char *)malloc(buf_len);
        if (!buf) {
            httpd_resp_send_500(req);
            return ESP_FAIL;
        }
        if (httpd_req_get_url_query_str(req, buf, buf_len) == ESP_OK) {
            *obuf = buf;
            return ESP_OK;
        }
        free(buf);
    }
    httpd_resp_send_404(req);
    return ESP_FAIL;
}

static esp_err_t cmd_handler(httpd_req_t *req){
    char *buf = NULL;
    char variable[32];
    char value[32];

    if (parse_get(req, &buf) != ESP_OK) {
        return ESP_FAIL;
    }
    if (httpd_query_key_value(buf, "var", variable, sizeof(variable)) != ESP_OK ||
        httpd_query_key_value(buf, "val", value, sizeof(value)) != ESP_OK) {
        free(buf);
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }
    free(buf);

    int val = atoi(value);
    sensor_t *s = esp_camera_sensor_get();
    int res = 0;

    if (!strcmp(variable, "framesize")) {
        if (s->pixformat == PIXFORMAT_JPEG) {
            res = s->set_framesize(s, (framesize_t)val);
        }
    }
    else if (!strcmp(variable, "quality"))
        res = s->set_quality(s, val);
    else if (!strcmp(variable, "contrast"))
        res = s->set_contrast(s, val);
    else if (!strcmp(variable, "brightness"))
        res = s->set_brightness(s, val);
    else if (!strcmp(variable, "saturation"))
        res = s->set_saturation(s, val);
    else if (!strcmp(variable, "gainceiling"))
        res = s->set_gainceiling(s, (gainceiling_t)val);
    else if (!strcmp(variable, "colorbar"))
        res = s->set_colorbar(s, val);
    else if (!strcmp(variable, "awb"))
        res = s->set_whitebal(s, val);
    else if (!strcmp(variable, "agc"))
        res = s->set_gain_ctrl(s, val);
    else if (!strcmp(variable, "aec"))
        res = s->set_exposure_ctrl(s, val);
    else if (!strcmp(variable, "hmirror"))
        res = s->set_hmirror(s, val);
    else if (!strcmp(variable, "vflip"))
        res = s->set_vflip(s, val);
    else if (!strcmp(variable, "awb_gain"))
        res = s->set_awb_gain(s, val);
    else if (!strcmp(variable, "agc_gain"))
        res = s->set_agc_gain(s, val);
    else if (!strcmp(variable, "aec_value"))
        res = s->set_aec_value(s, val);
    else if (!strcmp(variable, "aec2"))
        res = s->set_aec2(s, val);
    else if (!strcmp(variable, "dcw"))
        res = s->set_dcw(s, val);
    else if (!strcmp(variable, "bpc"))
        res = s->set_bpc(s, val);
    else if (!strcmp(variable, "wpc"))
        res = s->set_wpc(s, val);
    else if (!strcmp(variable, "raw_gma"))
        res = s->set_raw_gma(s, val);
    else if (!strcmp(variable, "lenc"))
        res = s->set_lenc(s, val);
    else if (!strcmp(variable, "special_effect"))
        res = s->set_special_effect(s, val);
    else if (!strcmp(variable, "wb_mode"))
        res = s->set_wb_mode(s, val);
    else if (!strcmp(variable, "ae_level"))
        res = s->set_ae_level(s, val);
    else {
        res = -1;
    }

    if (res < 0) {
        return httpd_resp_send_500(req);
    }

    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, NULL, 0);
}

static esp_err_t status_handler(httpd_req_t *req) {
    static char json_response[512];
    sensor_t *s = esp_camera_sensor_get();
    char *p = json_response;
    *p++ = '{';

    p += sprintf(p, "\"framesize\":%u,", s->status.framesize);
    p += sprintf(p, "\"quality\":%u,", s->status.quality);
    p += sprintf(p, "\"brightness\":%d,", s->status.brightness);
    p += sprintf(p, "\"contrast\":%d,", s->status.contrast);
    p += sprintf(p, "\"saturation\":%d,", s->status.saturation);
    p += sprintf(p, "\"special_effect\":%u,", s->status.special_effect);
    p += sprintf(p, "\"wb_mode\":%u,", s->status.wb_mode);
    p += sprintf(p, "\"awb\":%u,", s->status.awb);
    p += sprintf(p, "\"aec\":%u,", s->status.aec);
    p += sprintf(p, "\"aec_value\":%u,", s->status.aec_value);
    p += sprintf(p, "\"agc\":%u,", s->status.agc);
    p += sprintf(p, "\"agc_gain\":%u", s->status.agc_gain);

    *p++ = '}';
    *p++ = 0;

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, json_response, strlen(json_response));
}

// --- Pause / Resume stream control endpoints ---
static esp_err_t pause_stream_handler(httpd_req_t *req) {
    // Signal the running stream (if any) to stop immediately
    stream_cancel = true;
    isStreaming = false;
    close_active_stream_session();

    // Best-effort: wait briefly for the stream task to release the mutex
    // so the client sees an immediate effect
    vTaskDelay(pdMS_TO_TICKS(50));

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "{\"ok\":true,\"streaming\":false}");
}

static esp_err_t resume_stream_handler(httpd_req_t *req) {
    // Re-enable streaming; the next /stream request will work again
    isStreaming = true;

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_sendstr(req, "{\"ok\":true,\"streaming\":true}");
}

void startCameraServer() {
    // Already running? nothing to do.
    if (camera_httpd) {
        return;
    }
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = 81;
    config.stack_size = 10240;
    config.max_open_sockets = 4;
    config.max_resp_headers = 8;

    // Create the stream mutex once here to avoid races
    if (!stream_mutex) {
        stream_mutex = xSemaphoreCreateMutex();
    }

    if (httpd_start(&camera_httpd, &config) == ESP_OK) {
        static const httpd_uri_t stream_uri = {
            .uri      = "/stream",
            .method   = HTTP_GET,
            .handler  = stream_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(camera_httpd, &stream_uri);

        static const httpd_uri_t capture_uri = {
            .uri      = "/capture",
            .method   = HTTP_GET,
            .handler  = capture_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(camera_httpd, &capture_uri);

        static const httpd_uri_t status_uri = {
            .uri      = "/status",
            .method   = HTTP_GET,
            .handler  = status_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(camera_httpd, &status_uri);

        static const httpd_uri_t cmd_uri = {
            .uri      = "/control",
            .method   = HTTP_GET,
            .handler  = cmd_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(camera_httpd, &cmd_uri);

        // New pause/resume endpoints
        static const httpd_uri_t pause_uri = {
            .uri      = "/pause_stream",
            .method   = HTTP_GET,
            .handler  = pause_stream_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(camera_httpd, &pause_uri);

        static const httpd_uri_t resume_uri = {
            .uri      = "/resume_stream",
            .method   = HTTP_GET,
            .handler  = resume_stream_handler,
            .user_ctx = NULL
        };
        httpd_register_uri_handler(camera_httpd, &resume_uri);        
    }
}
