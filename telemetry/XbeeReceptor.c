#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <inttypes.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_log.h"

static const char *TAG = "XBEE_RX_CANSAT";

// ==================== DEFINICIONES ====================
typedef struct {
    uint16_t pressure;
    int16_t  temperature;
    int16_t  humidity;
    int16_t  speed;
    int16_t  accel[3];
    int16_t  gyro[3];
    int16_t  mag[3];
    int16_t  altitude;
    int32_t  latitude;
    int32_t  longitude;
    bool     decoupling;
} cansat_t;

// PINES
#define GPS_UART    UART_NUM_2
#define GPS_TX_PIN  26
#define GPS_RX_PIN  25

#define XBEE_UART   UART_NUM_1
#define TX_PIN      14
#define RX_PIN      13

#define BUF_SIZE    512

static char gps_buffer[BUF_SIZE];
static uint8_t uart_data[BUF_SIZE];
static char xbee_buffer[BUF_SIZE];
static int xbee_len = 0;

static bool extract_i32_tag(const char *payload, const char *key, int32_t *value) {
    char pattern[32];
    snprintf(pattern, sizeof(pattern), "%s=", key);
    char *ptr = strstr(payload, pattern);
    if (!ptr) return false;
    return sscanf(ptr + strlen(pattern), "%" SCNd32, value) == 1;
}

static bool extract_i16_tag(const char *payload, const char *key, int16_t *value) {
    int parsed = 0;
    char pattern[32];
    snprintf(pattern, sizeof(pattern), "%s=", key);
    char *ptr = strstr(payload, pattern);
    if (!ptr) return false;
    if (sscanf(ptr + strlen(pattern), "%d", &parsed) != 1) return false;
    *value = (int16_t)parsed;
    return true;
}

static void emit_ground_station_packet(const char *source, const cansat_t *data, double rx_lat, double rx_lon, bool has_rx_gps, double distance_to_rx) {
    char line[512];
    int written = snprintf(
        line,
        sizeof(line),
        "[%s] PRES:%u,TEMP:%.1f,HUM:%.1f,SPEED:%.1f,ACCX:%d,ACCY:%d,ACCZ:%d,GYROX:%d,GYROY:%d,GYROZ:%d,MAGX:%d,MAGY:%d,MAGZ:%d,ALT:%d,LAT:%.6f,LON:%.6f,DECOUP:%d",
        source,
        data->pressure,
        data->temperature / 10.0f,
        data->humidity / 10.0f,
        data->speed / 10.0f,
        data->accel[0], data->accel[1], data->accel[2],
        data->gyro[0], data->gyro[1], data->gyro[2],
        data->mag[0], data->mag[1], data->mag[2],
        data->altitude,
        data->latitude / 10000000.0,
        data->longitude / 10000000.0,
        data->decoupling ? 1 : 0
    );

    if (has_rx_gps && written > 0 && written < (int)sizeof(line)) {
        snprintf(
            line + written,
            sizeof(line) - (size_t)written,
            ",RXLAT:%.6f,RXLON:%.6f,DIST:%.2f",
            rx_lat,
            rx_lon,
            distance_to_rx
        );
    }

    printf("%s\n", line);
}

// ==================== HAVERSINE ====================
double haversine(double lat1, double lon1, double lat2, double lon2) {
    double dlat = (lat2 - lat1) * M_PI / 180;
    double dlon = (lon2 - lon1) * M_PI / 180;
    lat1 *= M_PI / 180;
    lat2 *= M_PI / 180;
    double a = sin(dlat/2)*sin(dlat/2) + cos(lat1)*cos(lat2)*sin(dlon/2)*sin(dlon/2);
    return 6371000 * 2 * atan2(sqrt(a), sqrt(1-a));
}

// ==================== GPS PARSER ====================
bool parse_gpgga(const char *sentence, double *lat, double *lon) {
    if (!strstr(sentence, "$GPGGA")) return false;

    char copy[128];
    strncpy(copy, sentence, sizeof(copy)-1);
    copy[sizeof(copy)-1] = '\0';

    char *tokens[15];
    int i = 0;
    char *p = strtok(copy, ",");
    while(p && i < 15) tokens[i++] = p, p = strtok(NULL, ",");

    if(i < 10 || atoi(tokens[6]) == 0) return false;

    *lat = atof(tokens[2]);
    *lon = atof(tokens[4]);

    int d = (int)(*lat / 100);
    *lat = d + (*lat - d*100)/60.0;
    if(tokens[3][0] == 'S') *lat = -*lat;

    d = (int)(*lon / 100);
    *lon = d + (*lon - d*100)/60.0;
    if(tokens[5][0] == 'W') *lon = -*lon;

    return true;
}

// ==================== XBEE CONFIG ====================
void flush_uart() { uart_flush_input(XBEE_UART); }

bool wait_ok(int timeout_ms) {
    uint8_t buf[100];
    int len = uart_read_bytes(XBEE_UART, buf, sizeof(buf)-1, pdMS_TO_TICKS(timeout_ms));
    if(len > 0) {
        buf[len] = 0;
        return strstr((char*)buf, "OK") != NULL;
    }
    return false;
}

bool send_cmd(const char *cmd) {
    flush_uart();
    uart_write_bytes(XBEE_UART, cmd, strlen(cmd));
    return wait_ok(800);
}

bool enter_cmd_mode() {
    vTaskDelay(pdMS_TO_TICKS(1200));
    flush_uart();
    uart_write_bytes(XBEE_UART, "+++", 3);
    vTaskDelay(pdMS_TO_TICKS(1200));
    return wait_ok(1000);
}

void xbee_init() {
    ESP_LOGI(TAG, "Configurando XBee Receptor...");
    if(enter_cmd_mode()) {
        send_cmd("ATAP 0\r");
        send_cmd("ATRE\r");
        send_cmd("ATID CAFE\r");
        send_cmd("ATCH 0C\r");
        send_cmd("ATMY 0\r");
        send_cmd("ATCE 1\r");       // Modo receptor
        send_cmd("ATPL 0\r");
        send_cmd("ATWR\r");
        send_cmd("ATCN\r");
        ESP_LOGI(TAG, "XBee receptor configurado");
    }
}

// ==================== PARSER PAYLOAD ====================
bool parse_cansat_payload(const char *payload, cansat_t *data)
{
    memset(data, 0, sizeof(*data));

    char *lat_ptr = strstr(payload, "Lat=");
    char *lon_ptr = strstr(payload, "Lon=");
    if (lat_ptr && lon_ptr) {
        data->latitude  = atoi(lat_ptr + 4);
        data->longitude = atoi(lon_ptr + 4);
    }

    int parsed = sscanf(payload,
        "P=%hu,T=%hd,"
        "Ax=%hd,Ay=%hd,Az=%hd,"
        "Gx=%hd,Gy=%hd,Gz=%hd,"
        "Mx=%hd,My=%hd,Mz=%hd,"
        "Alt=%hd",
        &data->pressure,
        &data->temperature,
        &data->accel[0], &data->accel[1], &data->accel[2],
        &data->gyro[0], &data->gyro[1], &data->gyro[2],
        &data->mag[0], &data->mag[1], &data->mag[2],
        &data->altitude
    );

    if (parsed != 12) {
        return data->latitude != 0 || data->longitude != 0;
    }

    if (!lat_ptr || !lon_ptr) {
        return false;
    }

    extract_i16_tag(payload, "H", &data->humidity);
    extract_i16_tag(payload, "Hum", &data->humidity);
    extract_i16_tag(payload, "Speed", &data->speed);
    extract_i16_tag(payload, "V", &data->speed);

    int32_t decoupling = 0;
    if (extract_i32_tag(payload, "Dec", &decoupling) || extract_i32_tag(payload, "Decoup", &decoupling) || extract_i32_tag(payload, "Relay", &decoupling)) {
        data->decoupling = decoupling != 0;
    }

    return true;
}
// ==================== MAIN ====================
void app_main(void) {
    // --- UART GPS ---
    uart_config_t gps_cfg = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE
    };
    uart_driver_install(GPS_UART, BUF_SIZE*2, 0, 0, NULL, 0);
    uart_param_config(GPS_UART, &gps_cfg);
    uart_set_pin(GPS_UART, GPS_TX_PIN, GPS_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

    // --- UART XBee ---
    uart_config_t xbee_cfg = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE
    };
    uart_driver_install(XBEE_UART, BUF_SIZE*2, 0, 0, NULL, 0);
    uart_param_config(XBEE_UART, &xbee_cfg);
    uart_set_pin(XBEE_UART, TX_PIN, RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

    xbee_init();

    ESP_LOGI(TAG, "=== RECEPTOR CANSAT (XBee) INICIADO ===");

    double rx_lat = 0, rx_lon = 0;
    bool has_gps = false;
    int gps_len = 0;
    cansat_t telemetry_rx = {0};
    int packet_count = 0;

    while(1) {
        // --- GPS LOCAL ---
        int len = uart_read_bytes(GPS_UART, uart_data, BUF_SIZE-1, pdMS_TO_TICKS(50));
        if (len > 0) {
            memcpy(gps_buffer + gps_len, uart_data, len);
            gps_len += len;
            gps_buffer[gps_len] = 0;
        
            char *start = gps_buffer;
            char *end;
        
            while ((end = strstr(start, "\r\n"))) {
                *end = 0;
                if (parse_gpgga(start, &rx_lat, &rx_lon)) {
                    has_gps = true;
                    ESP_LOGI(TAG, "GPS Local: %.6f, %.6f", rx_lat, rx_lon);
                }
                start = end + 2;
            }
        
            gps_len = strlen(start);
            memmove(gps_buffer, start, gps_len);
        }

        // --- XBEE RECEPCION ---
        len = uart_read_bytes(XBEE_UART, uart_data, BUF_SIZE - 1, pdMS_TO_TICKS(50));

if (len > 0) {
    if (xbee_len + len < BUF_SIZE - 1) {
        memcpy(xbee_buffer + xbee_len, uart_data, len);
        xbee_len += len;
        xbee_buffer[xbee_len] = '\0';
    }

    char *start = xbee_buffer;
    char *end;

    while ((end = strstr(start, "\r\n")) != NULL) {
        *end = '\0';

		/* eliminar caracteres basura al final */
		while (strlen(start) > 0) {
		    char c = start[strlen(start) - 1];
		    if (c == '\r' || c == '\n' || c == ' ')
		        start[strlen(start) - 1] = '\0';
		    else
		        break;
		}
		
		char *pkt = strstr(start, "P=");
		if (!pkt) {
		    start = end + 2;
		    continue;
		}
		
		if (parse_cansat_payload(pkt, &telemetry_rx)) {
            packet_count++;

            ESP_LOGI(TAG, "========================================");
            ESP_LOGI(TAG, "Paquete #%d", packet_count);
            ESP_LOGI(TAG, "Presion: %u hPa", telemetry_rx.pressure);
            ESP_LOGI(TAG, "Temperatura: %.1f C", telemetry_rx.temperature / 10.0f);
            ESP_LOGI(TAG, "Acelerometro: X=%d Y=%d Z=%d",
                     telemetry_rx.accel[0], telemetry_rx.accel[1], telemetry_rx.accel[2]);
            ESP_LOGI(TAG, "Giroscopio: X=%d Y=%d Z=%d",
                     telemetry_rx.gyro[0], telemetry_rx.gyro[1], telemetry_rx.gyro[2]);
            ESP_LOGI(TAG, "Magnetometro: X=%d Y=%d Z=%d",
                     telemetry_rx.mag[0], telemetry_rx.mag[1], telemetry_rx.mag[2]);
            ESP_LOGI(TAG, "Altitud: %d m", telemetry_rx.altitude);

            double tx_lat = telemetry_rx.latitude / 10000000.0;
            double tx_lon = telemetry_rx.longitude / 10000000.0;

            ESP_LOGI(TAG, "GPS TX: %.6f, %.6f", tx_lat, tx_lon);

            if (has_gps) {
                double d = haversine(tx_lat, tx_lon, rx_lat, rx_lon);
                ESP_LOGI(TAG, "DISTANCIA: %.2f metros", d);
                emit_ground_station_packet("XBEE", &telemetry_rx, rx_lat, rx_lon, true, d);
            } else {
                ESP_LOGI(TAG, "GPS Local: sin senal");
                emit_ground_station_packet("XBEE", &telemetry_rx, 0, 0, false, 0);
            }

            ESP_LOGI(TAG, "========================================");
        } else {
            ESP_LOGW(TAG, "Payload no reconocido: %s", start);
        }

        start = end + 2;
    }

    if (start != xbee_buffer) {
        int remaining = xbee_len - (start - xbee_buffer);
        memmove(xbee_buffer, start, remaining);
        xbee_len = remaining;
        xbee_buffer[xbee_len] = '\0';
    }
}
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
