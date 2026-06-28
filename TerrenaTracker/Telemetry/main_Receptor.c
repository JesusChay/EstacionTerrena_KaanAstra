#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "GROUND_TRACKER";

// ============================================
// PINES Y CONFIGURACIÓN
// ============================================

// LoRa (receptor)
#define LORA_UART_PORT            UART_NUM_1
#define LORA_TX_PIN               GPIO_NUM_36
#define LORA_RX_PIN               GPIO_NUM_35
#define LORA_BUF_SIZE             512
#define LORA_RX_TIMEOUT_MS        50

// GPS Terreno (UART2)
#define GPS_GROUND_UART_PORT      UART_NUM_2
#define GPS_GROUND_TX_PIN         GPIO_NUM_17
#define GPS_GROUND_RX_PIN         GPIO_NUM_16
#define GPS_GROUND_BUF_SIZE       256
#define FILTER_WINDOW_SIZE        10

// ============================================
// ESTRUCTURA DE DATOS (18 bytes - misma que el transmisor)
// ============================================
typedef struct __attribute__((packed)) {
    uint32_t timestamp;
    int32_t  altitude;
    int32_t  latitude;
    int32_t  longitude;
    uint8_t  flight_status;
    uint8_t  alarm_active;
} rocket_tracker_t;

// ============================================
// VARIABLES GLOBALES
// ============================================

// GPS Terreno
float ground_latitude = 0.0;
float ground_longitude = 0.0;
bool ground_gps_fix = false;

static float gps_altitude_buffer[FILTER_WINDOW_SIZE] = {0};
static int gps_alt_index = 0;
static float gps_alt_sum = 0;

// Cache del último paquete recibido del cohete
static float rocket_lat = 0.0f;
static float rocket_lon = 0.0f;
static float rocket_alt = 0.0f;
static uint8_t rocket_flight_status = 0;
static bool rocket_alarm = false;
static uint32_t rocket_timestamp = 0;
static bool rocket_data_received = false;

// ============================================
// FUNCIONES AUXILIARES
// ============================================

static void uart_flush_rx(uart_port_t uart) {
    uint8_t tmp[64];
    while (uart_read_bytes(uart, tmp, sizeof(tmp), pdMS_TO_TICKS(10)) > 0);
}

static bool uart_wait_response(uart_port_t uart, const char *expected, int timeout_ms) {
    char buffer[128];
    int idx = 0;
    TickType_t start = xTaskGetTickCount();

    memset(buffer, 0, sizeof(buffer));

    while ((xTaskGetTickCount() - start) < pdMS_TO_TICKS(timeout_ms)) {
        int len = uart_read_bytes(uart, (uint8_t*)&buffer[idx], 1, pdMS_TO_TICKS(100));
        if (len > 0) {
            idx += len;
            buffer[idx] = '\0';
            if (strstr(buffer, expected) != NULL) {
                return true;
            }
            if (idx >= (int)sizeof(buffer) - 1) {
                idx = 0;
                memset(buffer, 0, sizeof(buffer));
            }
        }
    }
    return false;
}

static int hex_to_bytes(const char *hex, uint8_t *bytes, int max_bytes) {
    int len = strlen(hex);
    if (len % 2 != 0) return 0;

    int byte_count = len / 2;
    if (byte_count > max_bytes) byte_count = max_bytes;

    for (int i = 0; i < byte_count; i++) {
        char byte_str[3] = {hex[i*2], hex[i*2+1], 0};
        bytes[i] = (uint8_t)strtol(byte_str, NULL, 16);
    }
    return byte_count;
}

// ============================================
// FUNCIONES DEL GPS TERRENO
// ============================================

static float moving_average_gps(float new_val) {
    gps_alt_sum -= gps_altitude_buffer[gps_alt_index];
    gps_alt_sum += new_val;
    gps_altitude_buffer[gps_alt_index] = new_val;
    gps_alt_index = (gps_alt_index + 1) % FILTER_WINDOW_SIZE;
    return gps_alt_sum / FILTER_WINDOW_SIZE;
}

static float nmea_to_decimal_ground(char *coord, char dir) {
    if (coord == NULL || strlen(coord) < 3) return 0;

    float val = atof(coord);
    int degrees = (int)(val / 100);
    float minutes = val - (degrees * 100);

    float decimal = degrees + (minutes / 60.0);

    if (dir == 'S' || dir == 'W') {
        decimal *= -1;
    }

    return decimal;
}

static void process_gpgga_ground(char *sentence) {
    char *tokens[15];
    int i = 0;

    char *ptr = strtok(sentence, ",");
    while (ptr != NULL && i < 15) {
        tokens[i++] = ptr;
        ptr = strtok(NULL, ",");
    }

    if (i < 10) {
        return;
    }

    if (!tokens[2] || !tokens[3] || !tokens[4] || !tokens[5]) {
        return;
    }

    char *lat = tokens[2];
    char lat_dir = tokens[3][0];
    char *lon = tokens[4];
    char lon_dir = tokens[5][0];
    int fix = atoi(tokens[6]);

    if (fix == 0) {
        ground_gps_fix = false;
        ground_latitude = 0.0;
        ground_longitude = 0.0;
        return;
    }

    ground_gps_fix = true;
    ground_latitude = nmea_to_decimal_ground(lat, lat_dir);
    ground_longitude = nmea_to_decimal_ground(lon, lon_dir);
}

void gps_ground_task(void *pvParameters) {
    uint8_t *data = (uint8_t *)malloc(GPS_GROUND_BUF_SIZE);
    if (data == NULL) {
        vTaskDelete(NULL);
        return;
    }
    
    char buffer[512] = {0};
    int buffer_len = 0;

    while (1) {
        int len = uart_read_bytes(GPS_GROUND_UART_PORT, data, GPS_GROUND_BUF_SIZE, 20 / portTICK_PERIOD_MS);

        if (len > 0) {
            if (buffer_len + len >= sizeof(buffer)) {
                buffer_len = 0;
                memset(buffer, 0, sizeof(buffer));
            }

            memcpy(buffer + buffer_len, data, len);
            buffer_len += len;

            char *start = buffer;

            while (1) {
                char *end = strstr(start, "\r\n");
                if (!end) break;

                *end = '\0';

                if (strstr(start, "$GPGGA") || strstr(start, "$GNGGA")) {
                    process_gpgga_ground(start);
                }

                start = end + 2;
            }

            int remaining = buffer + buffer_len - start;
            if (remaining > 0) {
                memmove(buffer, start, remaining);
                buffer_len = remaining;
            } else {
                buffer_len = 0;
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }

    free(data);
}

void init_gps_ground(void) {
    uart_config_t uart_config = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(GPS_GROUND_UART_PORT, GPS_GROUND_BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(GPS_GROUND_UART_PORT, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(GPS_GROUND_UART_PORT, GPS_GROUND_TX_PIN, GPS_GROUND_RX_PIN,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
}

// ============================================
// FUNCIONES DEL LORA RECEPTOR
// ============================================

static void lora_send_command(const char *cmd) {
    uart_write_bytes(LORA_UART_PORT, cmd, strlen(cmd));
    uart_write_bytes(LORA_UART_PORT, "\r\n", 2);
}

void init_lora_receiver(void) {
    uart_config_t uart_config = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(LORA_UART_PORT, LORA_BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(LORA_UART_PORT, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(LORA_UART_PORT, LORA_TX_PIN, LORA_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    vTaskDelay(pdMS_TO_TICKS(500));
    uart_flush_rx(LORA_UART_PORT);

    lora_send_command("AT+RESET");
    uart_wait_response(LORA_UART_PORT, "+OK", 3000);
    vTaskDelay(pdMS_TO_TICKS(1000));

    // Mismos parámetros que el CanSat
    lora_send_command("AT+BAND=869500000");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+CRFOP=12");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+PARAMETER=9,7,1,12");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    // Network ID diferente al CanSat (20 vs 18)
    lora_send_command("AT+NETWORKID=20");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    // Dirección del receptor
    lora_send_command("AT+ADDRESS=2");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+RX");
    vTaskDelay(pdMS_TO_TICKS(100));
}

void read_lora_data(void) {
    static char lora_buffer[LORA_BUF_SIZE];
    static int lora_buffer_len = 0;
    uint8_t uart_data[LORA_BUF_SIZE];

    int len = uart_read_bytes(LORA_UART_PORT, uart_data, LORA_BUF_SIZE - 1, pdMS_TO_TICKS(LORA_RX_TIMEOUT_MS));

    if (len > 0) {
        uart_data[len] = '\0';

        if (lora_buffer_len + len < LORA_BUF_SIZE - 1) {
            memcpy(lora_buffer + lora_buffer_len, uart_data, len);
            lora_buffer_len += len;
            lora_buffer[lora_buffer_len] = '\0';
        } else {
            lora_buffer_len = 0;
            lora_buffer[0] = '\0';
        }

        char *rcv = strstr(lora_buffer, "+RCV=");
        while (rcv != NULL) {
            char *end = strstr(rcv, "\r\n");
            if (end == NULL) break;

            *end = '\0';

            int addr, length, rssi, snr;
            char payload[256] = {0};

            if (sscanf(rcv, "+RCV=%d,%d,%[^,],%d,%d", &addr, &length, payload, &rssi, &snr) >= 3) {
                uint8_t raw_data[sizeof(rocket_tracker_t)];
                int byte_count = hex_to_bytes(payload, raw_data, sizeof(rocket_tracker_t));

                if (byte_count == sizeof(rocket_tracker_t)) {
                    rocket_tracker_t *pkt = (rocket_tracker_t*)raw_data;

                    rocket_lat = (float)pkt->latitude / 10000000.0f;
                    rocket_lon = (float)pkt->longitude / 10000000.0f;
                    rocket_alt = (float)pkt->altitude / 100.0f;
                    rocket_flight_status = pkt->flight_status;
                    rocket_alarm = pkt->alarm_active;
                    rocket_timestamp = pkt->timestamp;
                    rocket_data_received = true;
                }
            }

            char *next = end + 2;
            int remaining = lora_buffer_len - (next - lora_buffer);
            if (remaining > 0) {
                memmove(lora_buffer, next, remaining);
                lora_buffer_len = remaining;
                lora_buffer[lora_buffer_len] = '\0';
            } else {
                lora_buffer[0] = '\0';
                lora_buffer_len = 0;
            }

            rcv = strstr(lora_buffer, "+RCV=");
        }
    }
}

// ============================================
// TAREA DE IMPRESION PERIODICA (1 segundo)
// ============================================

void print_task(void *pvParameters) {
    while (1) {
        // Formato: rocket_lat, rocket_lon, rocket_alt, status, alarm, timestamp, ground_lat, ground_lon
        printf("%.6f,%.6f,%.2f,%d,%d,%lu,%.6f,%.6f\n",
               rocket_lat,
               rocket_lon,
               rocket_alt,
               rocket_flight_status,
               rocket_alarm ? 1 : 0,
               rocket_timestamp,
               ground_latitude,
               ground_longitude);
        fflush(stdout);

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

// ============================================
// MAIN
// ============================================

void app_main(void) {
    // Inicializar LoRa
    init_lora_receiver();

    // Inicializar GPS Terreno
    init_gps_ground();

    // Crear tareas
    xTaskCreate(gps_ground_task, "gps_ground", 8192, NULL, 5, NULL);
    xTaskCreate(print_task, "print", 4096, NULL, 5, NULL);

    while (1) {
        read_lora_data();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}