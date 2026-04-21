#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "LORA_CANSAT";

// ==================== DEFINICIONES ====================
typedef struct {
    uint16_t pressure;
    int16_t  temperature;
    int16_t  accel[3];
    int16_t  gyro[3];
    int16_t  mag[3];
    int16_t  altitude;
    int32_t  latitude;
    int32_t  longitude;
} cansat_t;

// PINES
#define GPS_UART    UART_NUM_2
#define GPS_TX_PIN  GPIO_NUM_26
#define GPS_RX_PIN  GPIO_NUM_25

#define LORA_UART   UART_NUM_1
#define LORA_TX_PIN GPIO_NUM_17
#define LORA_RX_PIN GPIO_NUM_16

#define I2C_MASTER_SCL_IO 22
#define I2C_MASTER_SDA_IO 21
#define I2C_MASTER_FREQ_HZ 100000
#define I2C_MASTER_PORT_NUM I2C_NUM_0

#define BUF_SIZE    512

// DIRECCIONES I2C
#define MPU6050_ADDR    0x68
#define HMC5883L_ADDR   0x1E
#define BMP180_ADDR     0x77

// REGISTROS MPU6050
#define MPU6050_WHO_AM_I      0x75
#define MPU6050_PWR_MGMT_1    0x6B
#define MPU6050_INT_PIN_CFG   0x37
#define MPU6050_USER_CTRL     0x6A
#define MPU6050_ACCEL_CONFIG  0x1C
#define MPU6050_ACCEL_XOUT_H  0x3B
#define MPU6050_GYRO_XOUT_H   0x43

// REGISTROS HMC5883L
#define HMC5883L_CONFIG_A  0x00
#define HMC5883L_CONFIG_B  0x01
#define HMC5883L_MODE      0x02
#define HMC5883L_DATA_X_H  0x03
#define HMC5883L_STATUS    0x09
#define HMC5883L_ID_A      0x0A

// REGISTROS BMP180
#define BMP180_CAL_AC1     0xAA
#define BMP180_CONTROL     0xF4
#define BMP180_TEMPDATA    0xF6
#define BMP180_PRESSUREDATA 0xF6
#define BMP180_READTEMPCMD     0x2E
#define BMP180_READPRESSURECMD 0x34

// FACTORES
#define ACCEL_SCALE_2G       16384.0f
#define GYRO_SCALE_250DPS    131.0f
#define HMC5883L_GAIN_1_3GA  1090.0f
#define GAUSS_TO_MICROTESLA  100.0f

// ==================== VARIABLES GLOBALES ====================
static char gps_buffer[BUF_SIZE];
static uint8_t uart_data[BUF_SIZE];
cansat_t telemetry = {0};

// Calibración BMP180
int16_t ac1, ac2, ac3, b1, b2, mb, mc, md;
uint16_t ac4, ac5, ac6;

// Calibración magnetómetro
float mag_bias[3] = {0, 0, 0};
float mag_scale[3] = {1.0, 1.0, 1.0};

// ==================== I2C ====================
void i2c_master_init() {
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

esp_err_t i2c_register_write(uint8_t dev_addr, uint8_t reg_addr, uint8_t data) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg_addr, true);
    i2c_master_write_byte(cmd, data, true);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_MASTER_PORT_NUM, cmd, 1000 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);
    return ret;
}

esp_err_t i2c_register_read(uint8_t dev_addr, uint8_t reg_addr, uint8_t *data, size_t len) {
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    if (cmd == NULL) {
        return ESP_ERR_NO_MEM;
    }

    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg_addr, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_READ, true);

    if (len > 1)
        i2c_master_read(cmd, data, len - 1, I2C_MASTER_ACK);

    i2c_master_read_byte(cmd, data + len - 1, I2C_MASTER_NACK);
    i2c_master_stop(cmd);

    esp_err_t ret = i2c_master_cmd_begin(
        I2C_MASTER_PORT_NUM,
        cmd,
        1000 / portTICK_PERIOD_MS
    );

    i2c_cmd_link_delete(cmd);   // <-- ESTA LÍNEA FALTABA

    return ret;
}

// ==================== MPU6050 ====================
void enable_bypass_mode() {
    i2c_register_write(MPU6050_ADDR, MPU6050_USER_CTRL, 0x00);
    i2c_register_write(MPU6050_ADDR, MPU6050_INT_PIN_CFG, 0x02);
    i2c_register_write(MPU6050_ADDR, MPU6050_PWR_MGMT_1, 0x00);
    vTaskDelay(100 / portTICK_PERIOD_MS);
}

void mpu6050_read_accel_gyro(int16_t *accel, int16_t *gyro) {
    uint8_t raw_data[14];
    if (i2c_register_read(MPU6050_ADDR, MPU6050_ACCEL_XOUT_H, raw_data, 14) == ESP_OK) {
        accel[0] = (raw_data[0] << 8) | raw_data[1];
        accel[1] = (raw_data[2] << 8) | raw_data[3];
        accel[2] = (raw_data[4] << 8) | raw_data[5];
        gyro[0]  = (raw_data[8] << 8) | raw_data[9];
        gyro[1]  = (raw_data[10] << 8) | raw_data[11];
        gyro[2]  = (raw_data[12] << 8) | raw_data[13];
    }
}

// ==================== HMC5883L ====================
void hmc5883l_init() {
    i2c_register_write(HMC5883L_ADDR, HMC5883L_CONFIG_A, 0x78);
    i2c_register_write(HMC5883L_ADDR, HMC5883L_CONFIG_B, 0x20);
    i2c_register_write(HMC5883L_ADDR, HMC5883L_MODE, 0x00);
}

bool hmc5883l_read_mag(int16_t *mag) {
    uint8_t status, raw_data[6];
    if (i2c_register_read(HMC5883L_ADDR, HMC5883L_STATUS, &status, 1) != ESP_OK) return false;
    if (!(status & 0x01)) return false;
    if (i2c_register_read(HMC5883L_ADDR, HMC5883L_DATA_X_H, raw_data, 6) != ESP_OK) return false;
    mag[0] = (raw_data[0] << 8) | raw_data[1];
    mag[2] = (raw_data[2] << 8) | raw_data[3];
    mag[1] = (raw_data[4] << 8) | raw_data[5];
    return true;
}

// ==================== BMP180 ====================
void bmp180_read_calibration() {
    uint8_t cal_data[22];
    if (i2c_register_read(BMP180_ADDR, BMP180_CAL_AC1, cal_data, 22) == ESP_OK) {
        ac1 = (cal_data[0] << 8) | cal_data[1];
        ac2 = (cal_data[2] << 8) | cal_data[3];
        ac3 = (cal_data[4] << 8) | cal_data[5];
        ac4 = (cal_data[6] << 8) | cal_data[7];
        ac5 = (cal_data[8] << 8) | cal_data[9];
        ac6 = (cal_data[10] << 8) | cal_data[11];
        b1  = (cal_data[12] << 8) | cal_data[13];
        b2  = (cal_data[14] << 8) | cal_data[15];
        mb  = (cal_data[16] << 8) | cal_data[17];
        mc  = (cal_data[18] << 8) | cal_data[19];
        md  = (cal_data[20] << 8) | cal_data[21];
    }
}

bool bmp180_begin() {
    uint8_t id;
    if (i2c_register_read(BMP180_ADDR, 0xD0, &id, 1) != ESP_OK || id != 0x55) return false;
    bmp180_read_calibration();
    return true;
}

bool bmp180_is_ready() {
    uint8_t status;
    if (i2c_register_read(BMP180_ADDR, 0xF4, &status, 1) == ESP_OK)
        return (status & 0x20) == 0;
    return false;
}

int32_t bmp180_read_raw_temp() {
    int timeout = 100;
    while (!bmp180_is_ready() && timeout-- > 0) vTaskDelay(1 / portTICK_PERIOD_MS);
    i2c_register_write(BMP180_ADDR, BMP180_CONTROL, BMP180_READTEMPCMD);
    vTaskDelay(10 / portTICK_PERIOD_MS);
    uint8_t data[2];
    if (i2c_register_read(BMP180_ADDR, BMP180_TEMPDATA, data, 2) != ESP_OK) return -1;
    return (data[0] << 8) | data[1];
}

float bmp180_calculate_temp(int32_t ut) {
    int32_t x1 = ((ut - ac6) * ac5) >> 15;
    int32_t x2 = (mc << 11) / (x1 + md);
    int32_t b5 = x1 + x2;
    return ((b5 + 8) >> 4) / 10.0f;
}

int32_t bmp180_read_raw_pressure(uint8_t oss) {
    int timeout = 100;
    while (!bmp180_is_ready() && timeout-- > 0) vTaskDelay(1 / portTICK_PERIOD_MS);
    uint8_t cmd = BMP180_READPRESSURECMD + (oss << 6);
    i2c_register_write(BMP180_ADDR, BMP180_CONTROL, cmd);
    uint16_t delay_ms = (oss == 0) ? 10 : (oss == 1) ? 15 : (oss == 2) ? 25 : 45;
    vTaskDelay(delay_ms / portTICK_PERIOD_MS);
    uint8_t data[3];
    if (i2c_register_read(BMP180_ADDR, BMP180_PRESSUREDATA, data, 3) != ESP_OK) return -1;
    return (((int32_t)data[0] << 16) | ((int32_t)data[1] << 8) | data[2]) >> (8 - oss);
}

int32_t bmp180_calculate_pressure(int32_t up, uint8_t oss) {
    int32_t ut = bmp180_read_raw_temp();
    int32_t x1 = ((ut - ac6) * ac5) >> 15;
    int32_t x2 = (mc << 11) / (x1 + md);
    int32_t b5 = x1 + x2;
    int32_t b6 = b5 - 4000;
    x1 = (b2 * ((b6 * b6) >> 12)) >> 11;
    x2 = (ac2 * b6) >> 11;
    int32_t x3 = x1 + x2;
    int32_t b3 = (((ac1 * 4 + x3) << oss) + 2) >> 2;
    x1 = (ac3 * b6) >> 13;
    x2 = (b1 * ((b6 * b6) >> 12)) >> 16;
    x3 = ((x1 + x2) + 2) >> 2;
    uint32_t b4 = (ac4 * (uint32_t)(x3 + 32768)) >> 15;
    uint32_t b7 = ((uint32_t)(up - b3) * (50000 >> oss));
    int32_t p = (b7 < 0x80000000) ? (b7 * 2) / b4 : (b7 / b4) * 2;
    x1 = (p >> 8) * (p >> 8);
    x1 = (x1 * 3038) >> 16;
    x2 = (-7357 * p) >> 16;
    p = p + ((x1 + x2 + 3791) >> 4);
    return p;
}

// ==================== GPS ====================
bool parse_gpgga(const char *sentence, int32_t *lat, int32_t *lon) {
    if (strstr(sentence, "$GPGGA") == NULL) return false;
    char copy[128];
    strncpy(copy, sentence, sizeof(copy) - 1);
    copy[sizeof(copy) - 1] = '\0';
    char *tokens[15];
    int i = 0;
    char *ptr = strtok(copy, ",");
    while (ptr && i < 15) { tokens[i++] = ptr; ptr = strtok(NULL, ","); }
    if (i < 10 || atoi(tokens[6]) == 0) return false;

    double lat_d = atof(tokens[2]);
    double lon_d = atof(tokens[4]);
    int deg = (int)(lat_d / 100);
    lat_d = deg + (lat_d - deg * 100) / 60.0;
    if (tokens[3][0] == 'S') lat_d = -lat_d;
    deg = (int)(lon_d / 100);
    lon_d = deg + (lon_d - deg * 100) / 60.0;
    if (tokens[5][0] == 'W') lon_d = -lon_d;

    *lat = (int32_t)(lat_d * 1e7);
    *lon = (int32_t)(lon_d * 1e7);
    return true;
}

// ==================== LORA ====================
void lora_send_command(const char *cmd) {
    uart_write_bytes(LORA_UART, cmd, strlen(cmd));
    uart_write_bytes(LORA_UART, "\r\n", 2);
}

void lora_init(void) {
    ESP_LOGI(TAG, "Inicializando LoRa (RYLR998) con normativa CE/IR2030");
    vTaskDelay(pdMS_TO_TICKS(1000));
    lora_send_command("AT+RESET");
    vTaskDelay(pdMS_TO_TICKS(1000));
    lora_send_command("AT+BAND=869500000");
    vTaskDelay(pdMS_TO_TICKS(100));
    lora_send_command("AT+CRFOP=12");
    vTaskDelay(pdMS_TO_TICKS(100));
    lora_send_command("AT+PARAMETER=9,7,1,12");
    vTaskDelay(pdMS_TO_TICKS(100));
    lora_send_command("AT+ADDRESS=0");
    vTaskDelay(pdMS_TO_TICKS(100));
    lora_send_command("AT+NETWORKID=18");
    vTaskDelay(pdMS_TO_TICKS(100));
    ESP_LOGI(TAG, "LoRa configurado correctamente");
}

// ==================== MAIN ====================
void app_main(void) {
    vTaskDelay(pdMS_TO_TICKS(100));

    // --- UART GPS ---
    uart_config_t gps_cfg = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    uart_driver_install(GPS_UART, BUF_SIZE * 2, 0, 0, NULL, 0);
    uart_param_config(GPS_UART, &gps_cfg);
    uart_set_pin(GPS_UART, GPS_TX_PIN, GPS_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

    // --- UART LoRa ---
    uart_config_t lora_cfg = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    uart_driver_install(LORA_UART, BUF_SIZE * 2, 0, 0, NULL, 0);
    uart_param_config(LORA_UART, &lora_cfg);
    uart_set_pin(LORA_UART, LORA_TX_PIN, LORA_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

    // --- I2C GY87 ---
    i2c_master_init();
    enable_bypass_mode();
    hmc5883l_init();
    if (!bmp180_begin()) ESP_LOGE(TAG, "BMP180 no encontrado");
    lora_init();

    ESP_LOGI(TAG, "=== TRANSMISOR CANSAT (LoRa) INICIADO ===");

    memset(gps_buffer, 0, BUF_SIZE);
    int gps_len = 0;
    uint32_t last_send_time = 0;
    int16_t accel[3], gyro[3], mag[3];
    float pressure_ref = 101325.0f; // Presión de referencia inicial
    int pressure_samples = 0;

    while (1) {
        // --- Leer GPS ---
        int len = uart_read_bytes(GPS_UART, uart_data, BUF_SIZE - 1, pdMS_TO_TICKS(50));
        if (len > 0) {
            if (gps_len + len < BUF_SIZE - 1) {
                memcpy(gps_buffer + gps_len, uart_data, len);
                gps_len += len;
                gps_buffer[gps_len] = '\0';
            }
            char *start = gps_buffer;
            char *end;
            while ((end = strstr(start, "\r\n")) != NULL) {
                *end = '\0';
                if (parse_gpgga(start, &telemetry.latitude, &telemetry.longitude)) {
                    ESP_LOGI(TAG, "GPS OK: lat=%ld, lon=%ld", (long)telemetry.latitude, (long)telemetry.longitude);
                }
                start = end + 2;
            }
            if (start != gps_buffer) {
                int remaining = gps_len - (start - gps_buffer);
                if (remaining > 0 && remaining < BUF_SIZE) {
                    memmove(gps_buffer, start, remaining);
                    gps_len = remaining;
                } else {
                    gps_len = 0;
                }
                gps_buffer[gps_len] = '\0';
            }
        }

        // --- Leer GY87 ---
        mpu6050_read_accel_gyro(accel, gyro);
        hmc5883l_read_mag(mag);
        
        int32_t raw_temp = bmp180_read_raw_temp();
        float temp_c = bmp180_calculate_temp(raw_temp);
        telemetry.temperature = (int16_t)(temp_c * 10);
        
        int32_t raw_pressure = bmp180_read_raw_pressure(1);
        int32_t pressure_pa = bmp180_calculate_pressure(raw_pressure, 1);
        telemetry.pressure = (uint16_t)(pressure_pa / 100);
        
        // Calcular altitud con calibración en tierra
        if (pressure_samples < 50) {
            pressure_ref = (pressure_ref * pressure_samples + pressure_pa) / (pressure_samples + 1);
            pressure_samples++;
            telemetry.altitude = 0;
        } else {
            float altitude_m = 44330.0f * (1.0f - powf((float)pressure_pa / pressure_ref, 0.1903f));
            telemetry.altitude = (int16_t)altitude_m;
        }

        for (int i = 0; i < 3; i++) {
            telemetry.accel[i] = accel[i];
            telemetry.gyro[i] = gyro[i];
            telemetry.mag[i] = mag[i];
        }

        // --- Enviar por LoRa cada 3 segundos ---
        uint32_t now = esp_timer_get_time() / 1000;
        if (now - last_send_time >= 3000) {
            // Buffer de 256 bytes (suficiente)
            char payload[256];
            int written = snprintf(payload, sizeof(payload),
                     "P=%u,T=%d,"
                     "Ax=%d,Ay=%d,Az=%d,"
                     "Gx=%d,Gy=%d,Gz=%d,"
                     "Mx=%d,My=%d,Mz=%d,"
                     "Alt=%d,Lat=%ld,Lon=%ld",
                     telemetry.pressure, telemetry.temperature,
                     telemetry.accel[0], telemetry.accel[1], telemetry.accel[2],
                     telemetry.gyro[0], telemetry.gyro[1], telemetry.gyro[2],
                     telemetry.mag[0], telemetry.mag[1], telemetry.mag[2],
                     telemetry.altitude, 
                     (long)telemetry.latitude, (long)telemetry.longitude);
            
            if (written > 0 && written < sizeof(payload)) {
                char cmd[280];
                snprintf(cmd, sizeof(cmd), "AT+SEND=0,%d,%s", written, payload);
                uart_write_bytes(LORA_UART, cmd, strlen(cmd));
                uart_write_bytes(LORA_UART, "\r\n", 2);
                ESP_LOGI(TAG, "Enviado (%d bytes): %s", written, payload);
            } else {
                ESP_LOGE(TAG, "Error formateando payload");
            }
            last_send_time = now;
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}