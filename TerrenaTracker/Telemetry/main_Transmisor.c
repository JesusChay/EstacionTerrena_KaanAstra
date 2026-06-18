#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "driver/mcpwm.h"
#include "esp_log.h"
#include "esp_timer.h"

// ============================================
// ETIQUETA DE LOG
// ============================================
static const char *TAG = "ROCKET_TRACKER";

// ============================================
// DEFINICIONES DE PINES
// ============================================
// GPS
#define GPS_UART_PORT       UART_NUM_2
#define GPS_TX_PIN          GPIO_NUM_6
#define GPS_RX_PIN          GPIO_NUM_5
#define GPS_BUF_SIZE        256
#define FILTER_WINDOW_SIZE  10

// LoRa
#define LORA_UART_PORT      UART_NUM_1
#define LORA_TX_PIN         GPIO_NUM_7
#define LORA_RX_PIN         GPIO_NUM_8
#define LORA_BUF_SIZE       256
#define LORA_MAX_RETRIES    3
#define LORA_RESPONSE_TIMEOUT_MS 2000

// Buzzer
#define BUZZER_PIN          GPIO_NUM_9
#define ALARM_FREQ_HZ       4000
#define ALARM_ON_MS         300
#define ALARM_OFF_MS        200

// ============================================
// CONFIGURACION DE VUELO
// ============================================
#define ALTITUDE_TAKEOFF_THRESHOLD  50.0f
#define ALTITUDE_LANDING_THRESHOLD  30.0f
#define ALARM_DELAY_SECONDS         3
#define SEND_INTERVAL_MS            3000

// ============================================
// ESTRUCTURA DE DATOS (18 bytes)
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
// ESTADOS DE VUELO
// ============================================
typedef enum {
    STATE_IDLE = 0,
    STATE_FLYING = 1,
    STATE_LANDED = 2
} flight_state_t;

// ============================================
// VARIABLES GLOBALES DEL GPS
// ============================================
float gps_latitude = 0.0;
float gps_longitude = 0.0;
float gps_altitude = 0.0;
bool gps_fix = false;

static float altitude_buffer[FILTER_WINDOW_SIZE] = {0};
static int alt_index = 0;
static float alt_sum = 0;

// ============================================
// VARIABLES DE ESTADO DE VUELO
// ============================================
static flight_state_t flight_state = STATE_IDLE;
static bool has_flown = false;
static uint32_t landing_time_ms = 0;
static bool alarm_started = false;

// ============================================
// VARIABLES DEL BUZZER
// ============================================
static esp_timer_handle_t alarm_timer = NULL;
static bool buzzer_active = false;

// ============================================
// DECLARACION DE FUNCIONES
// ============================================
// GPS
static float moving_average(float new_val);
static float nmea_to_decimal(char *coord, char dir);
static void process_gpgga(char *sentence);
void init_gps(void);
void gps_task(void *pvParameters);

// LoRa
static void uart_flush_rx(uart_port_t uart);
static bool uart_wait_response(uart_port_t uart, const char *expected, int timeout_ms);
static void lora_send_command(const char *cmd);
void init_lora(void);
bool lora_send_telemetry(rocket_tracker_t *data);

// Buzzer
static void alarm_pattern_callback(void *arg);
void init_buzzer(void);
void start_alarm(void);
void stop_alarm(void);
bool buzzer_is_active(void);

// Logica de vuelo
static void update_flight_state(float altitude);
static void control_buzzer(void);

// Simulacion
static void simulate_flight(void);

// ============================================
// FUNCIONES DEL GPS
// ============================================

static float moving_average(float new_val) {
    alt_sum -= altitude_buffer[alt_index];
    alt_sum += new_val;
    altitude_buffer[alt_index] = new_val;
    alt_index = (alt_index + 1) % FILTER_WINDOW_SIZE;
    return alt_sum / FILTER_WINDOW_SIZE;
}

static float nmea_to_decimal(char *coord, char dir) {
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

static void process_gpgga(char *sentence) {
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

    if (!tokens[2] || !tokens[3] || !tokens[4] || !tokens[5] || !tokens[9]) {
        return;
    }

    char *lat = tokens[2];
    char lat_dir = tokens[3][0];
    char *lon = tokens[4];
    char lon_dir = tokens[5][0];
    int fix = atoi(tokens[6]);
    float alt_raw = atof(tokens[9]);

    if (fix == 0) {
        gps_fix = false;
        return;
    }

    gps_fix = true;

    float lat_dec = nmea_to_decimal(lat, lat_dir);
    float lon_dec = nmea_to_decimal(lon, lon_dir);

    float alt_filtered = moving_average(alt_raw);

    gps_latitude = lat_dec;
    gps_longitude = lon_dec;
    gps_altitude = (alt_filtered < 0) ? 0.0f : alt_filtered;
}

void init_gps(void) {
    uart_config_t uart_config = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(GPS_UART_PORT, GPS_BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(GPS_UART_PORT, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(GPS_UART_PORT, GPS_TX_PIN, GPS_RX_PIN, 
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
}

void gps_task(void *pvParameters) {
    uint8_t *data = (uint8_t *)malloc(GPS_BUF_SIZE);
    char buffer[512] = {0};
    int buffer_len = 0;

    while (1) {
        int len = uart_read_bytes(GPS_UART_PORT, data, GPS_BUF_SIZE, 20 / portTICK_PERIOD_MS);

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

                if (strstr(start, "$GPGGA")) {
                    process_gpgga(start);
                }

                start = end + 2;
            }

            int remaining = buffer + buffer_len - start;
            memmove(buffer, start, remaining);
            buffer_len = remaining;
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }

    free(data);
}

// ============================================
// FUNCIONES DEL LORA
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

static void lora_send_command(const char *cmd) {
    uart_write_bytes(LORA_UART_PORT, cmd, strlen(cmd));
    uart_write_bytes(LORA_UART_PORT, "\r\n", 2);
}

void init_lora(void) {
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
    ESP_ERROR_CHECK(uart_set_pin(LORA_UART_PORT, LORA_TX_PIN, LORA_RX_PIN, 
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    vTaskDelay(pdMS_TO_TICKS(500));
    uart_flush_rx(LORA_UART_PORT);

    lora_send_command("AT+RESET");
    uart_wait_response(LORA_UART_PORT, "+OK", 3000);
    vTaskDelay(pdMS_TO_TICKS(1000));

    lora_send_command("AT+BAND=869500000");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+CRFOP=12");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+PARAMETER=9,7,1,12");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+ADDRESS=0");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+NETWORKID=18");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
}

bool lora_send_telemetry(rocket_tracker_t *data) {
    char hex_payload[sizeof(rocket_tracker_t) * 2 + 1];
    uint8_t *bytes = (uint8_t *)data;

    for (int i = 0; i < sizeof(rocket_tracker_t); i++) {
        sprintf(&hex_payload[i * 2], "%02X", bytes[i]);
    }
    hex_payload[sizeof(rocket_tracker_t) * 2] = '\0';

    for (int attempt = 1; attempt <= LORA_MAX_RETRIES; attempt++) {
        uart_flush_rx(LORA_UART_PORT);

        char cmd[256];
        snprintf(cmd, sizeof(cmd), "AT+SEND=0,%d,%s\r\n", 
                 (int)strlen(hex_payload), hex_payload);

        uart_write_bytes(LORA_UART_PORT, cmd, strlen(cmd));

        if (uart_wait_response(LORA_UART_PORT, "+OK", LORA_RESPONSE_TIMEOUT_MS)) {
            return true;
        }

        vTaskDelay(pdMS_TO_TICKS(500));
    }

    return false;
}

// ============================================
// FUNCIONES DEL BUZZER
// ============================================

static void alarm_pattern_callback(void *arg) {
    static bool tone_state = false;
    tone_state = !tone_state;

    if (tone_state) {
        mcpwm_set_frequency(MCPWM_UNIT_0, MCPWM_TIMER_0, ALARM_FREQ_HZ);
        mcpwm_start(MCPWM_UNIT_0, MCPWM_TIMER_0);
        esp_timer_start_once(alarm_timer, ALARM_ON_MS * 1000);
    } else {
        mcpwm_stop(MCPWM_UNIT_0, MCPWM_TIMER_0);
        esp_timer_start_once(alarm_timer, ALARM_OFF_MS * 1000);
    }
}

void init_buzzer(void) {
    mcpwm_gpio_init(MCPWM_UNIT_0, MCPWM0A, BUZZER_PIN);

    mcpwm_config_t pwm_config = {
        .frequency    = ALARM_FREQ_HZ,
        .cmpr_a       = 50.0f,
        .counter_mode = MCPWM_UP_COUNTER,
        .duty_mode    = MCPWM_DUTY_MODE_0
    };
    mcpwm_init(MCPWM_UNIT_0, MCPWM_TIMER_0, &pwm_config);

    mcpwm_stop(MCPWM_UNIT_0, MCPWM_TIMER_0);

    const esp_timer_create_args_t timer_args = {
        .callback = alarm_pattern_callback,
        .name     = "alarm_timer"
    };
    esp_timer_create(&timer_args, &alarm_timer);
}

void start_alarm(void) {
    if (buzzer_active) return;
    buzzer_active = true;
    alarm_pattern_callback(NULL);
}

void stop_alarm(void) {
    if (!buzzer_active) return;
    buzzer_active = false;
    esp_timer_stop(alarm_timer);
    mcpwm_stop(MCPWM_UNIT_0, MCPWM_TIMER_0);
}

bool buzzer_is_active(void) {
    return buzzer_active;
}

// ============================================
// LOGICA DE VUELO
// ============================================

static void update_flight_state(float altitude) {
    switch (flight_state) {
        case STATE_IDLE:
            if (altitude > ALTITUDE_TAKEOFF_THRESHOLD) {
                flight_state = STATE_FLYING;
                has_flown = true;
                ESP_LOGI(TAG, "TAKEOFF at %.2f m", altitude);
            }
            break;

        case STATE_FLYING:
            if (altitude < ALTITUDE_LANDING_THRESHOLD) {
                flight_state = STATE_LANDED;
                landing_time_ms = esp_timer_get_time() / 1000;
                ESP_LOGI(TAG, "LANDING at %.2f m", altitude);
            }
            break;

        case STATE_LANDED:
            break;
    }
}

static void control_buzzer(void) {
    uint32_t now = esp_timer_get_time() / 1000;

    if (flight_state == STATE_LANDED && has_flown) {
        if (!alarm_started && (now - landing_time_ms >= ALARM_DELAY_SECONDS * 1000)) {
            start_alarm();
            alarm_started = true;
            ESP_LOGI(TAG, "ALARM ACTIVATED");
        }
    } else {
        if (alarm_started) {
            stop_alarm();
            alarm_started = false;
        }
    }
}

// ============================================
// SIMULACION DE VUELO (COMENTADA POR DEFECTO)
// ============================================

static void simulate_flight(void) {
    static float sim_altitude = 0.0f;
    static float sim_latitude = 40.4203f;
    static float sim_longitude = -3.7437f;
    static int phase = 0;
    static uint32_t last_update = 0;
    
    uint32_t now = esp_timer_get_time() / 1000;
    
    if (now - last_update < 100) return;
    last_update = now;
    
    if (phase == 0) {
        sim_altitude += 5.2f;
        if (sim_altitude >= 520.0f) {
            phase = 1;
        }
    } else {
        sim_altitude -= 3.46f;
        if (sim_altitude < 0) {
            sim_altitude = 0;
        }
    }
    
    gps_latitude = sim_latitude + (rand() % 100 - 50) * 0.000001f;
    gps_longitude = sim_longitude + (rand() % 100 - 50) * 0.000001f;
    gps_altitude = sim_altitude;
    gps_fix = true;
}

// ============================================
// FUNCION MAIN
// ============================================

void app_main(void) {
    ESP_LOGI(TAG, "=== ROCKET TRACKER INIT ===");

    init_gps();
    init_lora();
    init_buzzer();

    xTaskCreate(gps_task, "gps_task", 4096, NULL, 5, NULL);

    rocket_tracker_t payload;
    uint32_t last_send_time = 0;
    int send_counter = 0;

    vTaskDelay(pdMS_TO_TICKS(2000));

    ESP_LOGI(TAG, "System ready");

    while (1) {
        uint32_t now = esp_timer_get_time() / 1000;

        // ============================================
        // SIMULACION DE VUELO (DESCOMENTAR PARA PROBAR)
        // ============================================
        //simulate_flight();

        // ============================================
        // LOGICA DE VUELO
        // ============================================
        update_flight_state(gps_altitude);
        control_buzzer();

        // ============================================
        // ENVIO POR LORA
        // ============================================
        if (now - last_send_time >= SEND_INTERVAL_MS) {
            last_send_time = now;

            if (gps_fix) {
                send_counter++;

                payload.timestamp = now;
                payload.altitude = (int32_t)(gps_altitude * 100);
                payload.latitude = (int32_t)(gps_latitude * 10000000);
                payload.longitude = (int32_t)(gps_longitude * 10000000);
                payload.flight_status = (uint8_t)flight_state;
                payload.alarm_active = (flight_state == STATE_LANDED && alarm_started) ? 1 : 0;

                // Formato de salida limpio: latitude, longitude, altitude, status, alarm, timestamp
                ESP_LOGI(TAG, "%.6f, %.6f, %.2f, %d, %d, %lu",
                         gps_latitude,
                         gps_longitude,
                         gps_altitude,
                         flight_state,
                         payload.alarm_active,
                         now);

                bool success = lora_send_telemetry(&payload);
                
                if (!success) {
                    ESP_LOGE(TAG, "LORA FAILED");
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}