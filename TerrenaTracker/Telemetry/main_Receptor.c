#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "driver/adc.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "GROUND_Tracker";

// ============================================
// PINES Y CONFIGURACION
// ============================================

// LoRa
#define LORA_UART_PORT            UART_NUM_1
#define LORA_TX_PIN               GPIO_NUM_37
#define LORA_RX_PIN               GPIO_NUM_38
#define LORA_BUF_SIZE             512
#define LORA_RESPONSE_TIMEOUT_MS  2000

// GPS Terreno (UART2 con TX y RX)
#define GPS_GROUND_UART_PORT      UART_NUM_2
#define GPS_GROUND_TX_PIN         GPIO_NUM_17
#define GPS_GROUND_RX_PIN         GPIO_NUM_16
#define GPS_GROUND_BUF_SIZE       256

// Sensor de Viento (RevC) - ADC1_CHANNEL_0 = GPIO36
#define WIND_ADC_CHANNEL          ADC1_CHANNEL_5
#define V_REF                     3.3f
#define ADC_MAX                   4095.0f
#define MPH_TO_KPH                1.60934f

// GY-87 (I2C)
#define I2C_MASTER_SCL_IO         5
#define I2C_MASTER_SDA_IO         4
#define I2C_MASTER_FREQ_HZ        100000
#define I2C_MASTER_PORT_NUM       I2C_NUM_0

// HMC5883L (Magnetometro)
#define HMC5883L_ADDR             0x1E
#define HMC5883L_CONFIG_A         0x00
#define HMC5883L_CONFIG_B         0x01
#define HMC5883L_MODE             0x02
#define HMC5883L_DATA_X_H         0x03
#define HMC5883L_STATUS           0x09
#define HMC5883L_GAIN_1_3GA       1090.0f
#define GAUSS_TO_MICROTESLA       100.0f

// MPU6050
#define MPU6050_ADDR              0x68
#define MPU6050_PWR_MGMT_1        0x6B
#define MPU6050_INT_PIN_CFG       0x37
#define MPU6050_USER_CTRL         0x6A

// ============================================
// ESTRUCTURA DE DATOS (18 bytes - misma que el emisor)
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

// Sensor de Viento
float wind_speed = 0.0;
float zero_wind_voltage = 1.25f;
float wind_factor = 0.2300f;
float wind_exponent = 2.7265f;
float wind_threshold = 0.01f;

// Magnetometro (Brújula)
float mag_bias[3] = {0, 0, 0};
float mag_scale[3] = {1.0, 1.0, 1.0};
float compass_heading = 0.0;
char compass_direction[4] = "---";

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
// FUNCIONES I2C
// ============================================

static void i2c_master_init() {
    i2c_config_t conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = I2C_MASTER_SDA_IO,
        .scl_io_num = I2C_MASTER_SCL_IO,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_MASTER_FREQ_HZ,
    };
    ESP_ERROR_CHECK(i2c_param_config(I2C_MASTER_PORT_NUM, &conf));
    ESP_ERROR_CHECK(i2c_driver_install(I2C_MASTER_PORT_NUM, conf.mode, 0, 0, 0));
}

static esp_err_t i2c_register_write(uint8_t dev_addr, uint8_t reg_addr, uint8_t data) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    ESP_ERROR_CHECK(i2c_master_start(cmd));
    ESP_ERROR_CHECK(i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_WRITE, true));
    ESP_ERROR_CHECK(i2c_master_write_byte(cmd, reg_addr, true));
    ESP_ERROR_CHECK(i2c_master_write_byte(cmd, data, true));
    ESP_ERROR_CHECK(i2c_master_stop(cmd));
    esp_err_t ret = i2c_master_cmd_begin(I2C_MASTER_PORT_NUM, cmd, 1000 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);
    return ret;
}

static esp_err_t i2c_register_read(uint8_t dev_addr, uint8_t reg_addr, uint8_t *data, size_t len) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    ESP_ERROR_CHECK(i2c_master_start(cmd));
    ESP_ERROR_CHECK(i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_WRITE, true));
    ESP_ERROR_CHECK(i2c_master_write_byte(cmd, reg_addr, true));
    ESP_ERROR_CHECK(i2c_master_start(cmd));
    ESP_ERROR_CHECK(i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_READ, true));
    if (len > 1) {
        ESP_ERROR_CHECK(i2c_master_read(cmd, data, len - 1, I2C_MASTER_ACK));
    }
    ESP_ERROR_CHECK(i2c_master_read_byte(cmd, data + len - 1, I2C_MASTER_NACK));
    ESP_ERROR_CHECK(i2c_master_stop(cmd));
    esp_err_t ret = i2c_master_cmd_begin(I2C_MASTER_PORT_NUM, cmd, 1000 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);
    return ret;
}

// ============================================
// FUNCIONES DEL GPS TERRENO
// ============================================

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
        return;
    }

    ground_gps_fix = true;
    ground_latitude = nmea_to_decimal_ground(lat, lat_dir);
    ground_longitude = nmea_to_decimal_ground(lon, lon_dir);
}

void gps_ground_task(void *pvParameters) {
    uint8_t *data = (uint8_t *)malloc(GPS_GROUND_BUF_SIZE);
    if (data == NULL) {
        ESP_LOGE(TAG, "Failed to allocate GPS buffer");
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
// FUNCIONES DEL SENSOR DE VIENTO
// ============================================

void adc_init_wind() {
    adc1_config_width(ADC_WIDTH_BIT_12);
    adc1_config_channel_atten(WIND_ADC_CHANNEL, ADC_ATTEN_DB_11);
}

float read_wind_voltage() {
    return (adc1_get_raw(WIND_ADC_CHANNEL) / ADC_MAX) * V_REF;
}

float calculate_wind_speed(float voltage) {
    float voltage_diff = voltage - zero_wind_voltage;
    
    if (voltage_diff < wind_threshold) return 0.0f;
    
    return powf((voltage_diff / wind_factor), wind_exponent) * MPH_TO_KPH;
}

void calibrate_zero_wind() {
    float sum = 0;
    const int samples = 20;
    
    for (int i = 0; i < samples; i++) {
        sum += read_wind_voltage();
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    
    zero_wind_voltage = sum / samples;
}

void wind_task(void *pvParameters) {
    float last_speed = 0;
    const float response_factor = 0.5f;
    
    while (1) {
        float voltage = read_wind_voltage();
        float current_speed = calculate_wind_speed(voltage);
        
        wind_speed = last_speed + (current_speed - last_speed) * response_factor;
        last_speed = wind_speed;
        
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}

void init_wind_sensor(void) {
    adc_init_wind();
    calibrate_zero_wind();
}

// ============================================
// FUNCIONES DE LA BRUJULA (MAGNETOMETRO)
// ============================================

static void enable_bypass_mode() {
    i2c_register_write(MPU6050_ADDR, MPU6050_USER_CTRL, 0x00);
    i2c_register_write(MPU6050_ADDR, MPU6050_INT_PIN_CFG, 0x02);
    i2c_register_write(MPU6050_ADDR, MPU6050_PWR_MGMT_1, 0x00);
    vTaskDelay(100 / portTICK_PERIOD_MS);
}

static void hmc5883l_init() {
    i2c_register_write(HMC5883L_ADDR, HMC5883L_CONFIG_A, 0x78);
    i2c_register_write(HMC5883L_ADDR, HMC5883L_CONFIG_B, 0x20);
    i2c_register_write(HMC5883L_ADDR, HMC5883L_MODE, 0x00);
    vTaskDelay(100 / portTICK_PERIOD_MS);
}

static bool hmc5883l_read_mag(int16_t *mag) {
    uint8_t raw_data[6];
    uint8_t status;
    
    if (i2c_register_read(HMC5883L_ADDR, HMC5883L_STATUS, &status, 1) != ESP_OK) {
        return false;
    }
    
    if (!(status & 0x01)) {
        return false;
    }
    
    if (i2c_register_read(HMC5883L_ADDR, HMC5883L_DATA_X_H, raw_data, 6) != ESP_OK) {
        return false;
    }
    
    mag[0] = (raw_data[0] << 8) | raw_data[1];
    mag[2] = (raw_data[2] << 8) | raw_data[3];
    mag[1] = (raw_data[4] << 8) | raw_data[5];
    
    return true;
}

static void calibrate_magnetometer() {
    int16_t mag[3];
    int16_t mag_min[3] = {2047, 2047, 2047};
    int16_t mag_max[3] = {-2048, -2048, -2048};
    
    vTaskDelay(2000 / portTICK_PERIOD_MS);
    
    for (int i = 0; i < 300; i++) {
        if (hmc5883l_read_mag(mag)) {
            for (int j = 0; j < 3; j++) {
                if (mag[j] < mag_min[j]) mag_min[j] = mag[j];
                if (mag[j] > mag_max[j]) mag_max[j] = mag[j];
            }
        }
        vTaskDelay(50 / portTICK_PERIOD_MS);
    }
    
    for (int j = 0; j < 3; j++) {
        mag_bias[j] = (mag_max[j] + mag_min[j]) / 2.0;
        mag_scale[j] = (mag_max[j] - mag_min[j]) / 2.0;
    }
    
    float avg_scale = (mag_scale[0] + mag_scale[1] + mag_scale[2]) / 3.0;
    for (int j = 0; j < 3; j++) {
        mag_scale[j] = avg_scale / mag_scale[j];
    }
}

static void get_compass_direction(float heading_deg, char *direction) {
    if (heading_deg < 0) heading_deg += 360;
    
    const char *directions[] = {"N", "NE", "E", "SE", "S", "SO", "O", "NO"};
    int index = (int)((heading_deg + 22.5f) / 45.0f) % 8;
    
    strcpy(direction, directions[index]);
}

void compass_task(void *pvParameters) {
    int16_t mag[3];
    float mx, my;
    
    while (1) {
        if (hmc5883l_read_mag(mag)) {
            mx = (float)(mag[0] - mag_bias[0]) * mag_scale[0] / HMC5883L_GAIN_1_3GA * GAUSS_TO_MICROTESLA;
            my = (float)(mag[1] - mag_bias[1]) * mag_scale[1] / HMC5883L_GAIN_1_3GA * GAUSS_TO_MICROTESLA;
            
            compass_heading = atan2(my, mx) * 180.0f / M_PI;
            compass_heading = 90.0f - compass_heading;
            
            get_compass_direction(compass_heading, compass_direction);
        }
        
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

void init_compass(void) {
    i2c_master_init();
    
    i2c_register_write(MPU6050_ADDR, MPU6050_PWR_MGMT_1, 0x00);
    vTaskDelay(100 / portTICK_PERIOD_MS);
    
    enable_bypass_mode();
    hmc5883l_init();
    calibrate_magnetometer();
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

    lora_send_command("AT+BAND=869500000");
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

    lora_send_command("AT+RX");
    vTaskDelay(pdMS_TO_TICKS(100));
}

void read_lora_data(void) {
    static char lora_buffer[LORA_BUF_SIZE];
    static int lora_buffer_len = 0;
    uint8_t uart_data[LORA_BUF_SIZE];

    int len = uart_read_bytes(LORA_UART_PORT, uart_data, LORA_BUF_SIZE - 1, pdMS_TO_TICKS(10));

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
                    rocket_tracker_t *data = (rocket_tracker_t*)raw_data;
                    
                    float lat = (float)data->latitude / 10000000.0f;
                    float lon = (float)data->longitude / 10000000.0f;
                    float alt = (float)data->altitude / 100.0f;

                    const char *status_str = "";
                    switch (data->flight_status) {
                        case 0: status_str = "IDLE"; break;
                        case 1: status_str = "FLYING"; break;
                        case 2: status_str = "LANDED"; break;
                        default: status_str = "UNKNOWN"; break;
                    }

                    printf("%.6f, %.6f, %.2f, %s, %s, %lu, %d, %d, %.6f, %.6f, %.2f, %s\n",
                           lat, lon, alt,
                           status_str,
                           data->alarm_active ? "ON" : "OFF",
                           data->timestamp,
                           rssi, snr,
                           ground_latitude,
                           ground_longitude,
                           wind_speed,
                           compass_direction);
                    fflush(stdout);
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
// MAIN
// ============================================

void app_main(void) {
    ESP_LOGI(TAG, "=== GROUND STATION RX ===");

    // Inicializar LoRa
    init_lora_receiver();

    // Inicializar GPS Terreno (UART2, GPIO43 TX, GPIO44 RX)
    init_gps_ground();

    // Inicializar Sensor de Viento (ADC, GPIO36)
    init_wind_sensor();

    // Inicializar Brújula (I2C, GPIO4 y GPIO5)
    init_compass();

    // Crear tareas con STACK AUMENTADO para evitar crash
    xTaskCreate(gps_ground_task, "gps_ground", 8192, NULL, 5, NULL);
    xTaskCreate(wind_task, "wind_sensor", 4096, NULL, 5, NULL);
    xTaskCreate(compass_task, "compass", 4096, NULL, 5, NULL);

    ESP_LOGI(TAG, "All sensors initialized");
    ESP_LOGI(TAG, "Format: latitude, longitude, altitude, status, alarm, timestamp, rssi, snr, lat_ground, lon_ground, wind_velocity, compass");

    while (1) {
        read_lora_data();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}