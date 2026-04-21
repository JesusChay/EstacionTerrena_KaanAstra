#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/i2c.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "XBEE_CANSAT";

typedef struct {
    uint16_t pressure;
    int16_t temperature;
    int16_t accel[3];
    int16_t gyro[3];
    int16_t mag[3];
    int16_t altitude;
    int32_t latitude;
    int32_t longitude;
} cansat_t;

#define GPS_UART UART_NUM_2
#define GPS_TX_PIN 26
#define GPS_RX_PIN 25

#define XBEE_UART UART_NUM_1
#define XBEE_TX_PIN 14
#define XBEE_RX_PIN 13

#define I2C_PORT I2C_NUM_0
#define SDA_PIN 21
#define SCL_PIN 22
#define BUF_SIZE 512

#define MPU6050_ADDR 0x68
#define HMC5883L_ADDR 0x1E
#define BMP180_ADDR 0x77

static cansat_t telemetry;
static char gps_buffer[BUF_SIZE];
static uint8_t uart_data[BUF_SIZE];

int16_t ac1, ac2, ac3, b1, b2, mb, mc, md;
uint16_t ac4, ac5, ac6;
float pressure_ref = 101325.0f;
int pressure_samples = 0;

static esp_err_t i2c_write(uint8_t dev, uint8_t reg, uint8_t data)
{
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg, true);
    i2c_master_write_byte(cmd, data, true);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_PORT, cmd, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(cmd);
    return ret;
}

static esp_err_t i2c_read(uint8_t dev, uint8_t reg, uint8_t *data, size_t len)
{
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev << 1) | I2C_MASTER_READ, true);

    if (len > 1)
        i2c_master_read(cmd, data, len - 1, I2C_MASTER_ACK);

    i2c_master_read_byte(cmd, data + len - 1, I2C_MASTER_NACK);
    i2c_master_stop(cmd);

    esp_err_t ret = i2c_master_cmd_begin(I2C_PORT, cmd, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(cmd);
    return ret;
}

static void i2c_init_bus(void)
{
    i2c_config_t cfg = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = SDA_PIN,
        .scl_io_num = SCL_PIN,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = 100000
    };

    i2c_param_config(I2C_PORT, &cfg);
    i2c_driver_install(I2C_PORT, cfg.mode, 0, 0, 0);
}

static void mpu6050_init(void)
{
    i2c_write(MPU6050_ADDR, 0x6B, 0x00);
    vTaskDelay(pdMS_TO_TICKS(100));
    i2c_write(MPU6050_ADDR, 0x1C, 0x00);
    i2c_write(MPU6050_ADDR, 0x1B, 0x00);
    i2c_write(MPU6050_ADDR, 0x6A, 0x00);
    i2c_write(MPU6050_ADDR, 0x37, 0x02);
}

static bool mpu6050_read(int16_t *accel, int16_t *gyro)
{
    uint8_t raw[14];

    if (i2c_read(MPU6050_ADDR, 0x3B, raw, 14) != ESP_OK)
        return false;

    accel[0] = (raw[0] << 8) | raw[1];
    accel[1] = (raw[2] << 8) | raw[3];
    accel[2] = (raw[4] << 8) | raw[5];

    gyro[0] = (raw[8] << 8) | raw[9];
    gyro[1] = (raw[10] << 8) | raw[11];
    gyro[2] = (raw[12] << 8) | raw[13];

    return true;
}

static void hmc5883_init(void)
{
    i2c_write(HMC5883L_ADDR, 0x00, 0x78);
    i2c_write(HMC5883L_ADDR, 0x01, 0x20);
    i2c_write(HMC5883L_ADDR, 0x02, 0x00);
}

static bool hmc5883_read(int16_t *mag)
{
    uint8_t raw[6];
    uint8_t status;

    if (i2c_read(HMC5883L_ADDR, 0x09, &status, 1) != ESP_OK)
        return false;

    if (!(status & 0x01))
        return false;

    if (i2c_read(HMC5883L_ADDR, 0x03, raw, 6) != ESP_OK)
        return false;

    mag[0] = (raw[0] << 8) | raw[1];
    mag[2] = (raw[2] << 8) | raw[3];
    mag[1] = (raw[4] << 8) | raw[5];

    return true;
}

// ==================== BMP180 ====================
void bmp180_read_calibration() {
    uint8_t cal_data[22];
    if (i2c_read(BMP180_ADDR, 0xAA, cal_data, 22) == ESP_OK) {
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
    if (i2c_read(BMP180_ADDR, 0xD0, &id, 1) != ESP_OK || id != 0x55)
        return false;

    bmp180_read_calibration();
    return true;
}

bool bmp180_is_ready() {
    uint8_t status;
    if (i2c_read(BMP180_ADDR, 0xF4, &status, 1) == ESP_OK)
        return (status & 0x20) == 0;
    return false;
}

int32_t bmp180_read_raw_temp() {
    while (!bmp180_is_ready())
        vTaskDelay(pdMS_TO_TICKS(1));

    i2c_write(BMP180_ADDR, 0xF4, 0x2E);
    vTaskDelay(pdMS_TO_TICKS(10));

    uint8_t data[2];
    if (i2c_read(BMP180_ADDR, 0xF6, data, 2) != ESP_OK)
        return -1;

    return (data[0] << 8) | data[1];
}

float bmp180_calculate_temp(int32_t ut, int32_t *b5_out) {
    int32_t x1 = ((ut - ac6) * ac5) >> 15;
    int32_t x2 = (mc << 11) / (x1 + md);
    int32_t b5 = x1 + x2;

    if (b5_out) *b5_out = b5;

    return ((b5 + 8) >> 4) / 10.0f;
}

int32_t bmp180_read_raw_pressure(uint8_t oss) {
    while (!bmp180_is_ready())
        vTaskDelay(pdMS_TO_TICKS(1));

    i2c_write(BMP180_ADDR, 0xF4, 0x34 + (oss << 6));

    if (oss == 0) vTaskDelay(pdMS_TO_TICKS(5));
    else if (oss == 1) vTaskDelay(pdMS_TO_TICKS(8));
    else if (oss == 2) vTaskDelay(pdMS_TO_TICKS(14));
    else vTaskDelay(pdMS_TO_TICKS(26));

    uint8_t data[3];
    if (i2c_read(BMP180_ADDR, 0xF6, data, 3) != ESP_OK)
        return -1;

    return (((int32_t)data[0] << 16) | ((int32_t)data[1] << 8) | data[2]) >> (8 - oss);
}

int32_t bmp180_calculate_pressure(int32_t up, int32_t b5, uint8_t oss) {
    int32_t b6 = b5 - 4000;

    int32_t x1 = (b2 * ((b6 * b6) >> 12)) >> 11;
    int32_t x2 = (ac2 * b6) >> 11;
    int32_t x3 = x1 + x2;
    int32_t b3 = ((((int32_t)ac1 * 4 + x3) << oss) + 2) >> 2;

    x1 = (ac3 * b6) >> 13;
    x2 = (b1 * ((b6 * b6) >> 12)) >> 16;
    x3 = ((x1 + x2) + 2) >> 2;

    uint32_t b4 = (ac4 * (uint32_t)(x3 + 32768)) >> 15;
    uint32_t b7 = ((uint32_t)(up - b3) * (50000 >> oss));

    int32_t p;
    if (b7 < 0x80000000)
        p = (b7 * 2) / b4;
    else
        p = (b7 / b4) * 2;

    x1 = (p >> 8) * (p >> 8);
    x1 = (x1 * 3038) >> 16;
    x2 = (-7357 * p) >> 16;

    p += (x1 + x2 + 3791) >> 4;

    return p;
}

static bool parse_gpgga(const char *sentence, int32_t *lat, int32_t *lon)
{
    if (!strstr(sentence, "$GPGGA"))
        return false;

    char copy[128];
    strncpy(copy, sentence, sizeof(copy));
    copy[sizeof(copy)-1] = 0;

    char *token[15];
    int i = 0;
    char *p = strtok(copy, ",");

    while (p && i < 15) {
        token[i++] = p;
        p = strtok(NULL, ",");
    }

    if (i < 6 || atoi(token[6]) == 0)
        return false;

    double la = atof(token[2]);
    double lo = atof(token[4]);

    int deg = (int)(la / 100);
    la = deg + (la - deg * 100) / 60.0;

    deg = (int)(lo / 100);
    lo = deg + (lo - deg * 100) / 60.0;

    if (token[3][0] == 'S') la = -la;
    if (token[5][0] == 'W') lo = -lo;

    *lat = (int32_t)(la * 1e7);
    *lon = (int32_t)(lo * 1e7);

    return true;
}

static void xbee_send(const char *data)
{
    uart_write_bytes(XBEE_UART, data, strlen(data));
    uart_write_bytes(XBEE_UART, "\r\n", 2);
}

void app_main(void)
{
    uart_config_t gps_cfg = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE
    };

    uart_config_t xbee_cfg = gps_cfg;

    uart_driver_install(GPS_UART, BUF_SIZE * 2, 0, 0, NULL, 0);
    uart_param_config(GPS_UART, &gps_cfg);
    uart_set_pin(GPS_UART, GPS_TX_PIN, GPS_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

    uart_driver_install(XBEE_UART, BUF_SIZE * 2, 0, 0, NULL, 0);
    uart_param_config(XBEE_UART, &xbee_cfg);
    uart_set_pin(XBEE_UART, XBEE_TX_PIN, XBEE_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

    i2c_init_bus();
    mpu6050_init();
    hmc5883_init();
    
    if (!bmp180_begin()) {
	    ESP_LOGE(TAG, "BMP180 no detectado");
	}

    int16_t accel[3], gyro[3], mag[3];
    uint32_t last_send = 0;
    int gps_len = 0;

    while (1) {
        int len = uart_read_bytes(GPS_UART, uart_data, BUF_SIZE-1, pdMS_TO_TICKS(20));
        if (len > 0) {
            memcpy(gps_buffer + gps_len, uart_data, len);
            gps_len += len;
            gps_buffer[gps_len] = 0;

            char *line = strtok(gps_buffer, "\r\n");
            while (line) {
                parse_gpgga(line, &telemetry.latitude, &telemetry.longitude);
                line = strtok(NULL, "\r\n");
            }
            gps_len = 0;
        }

        if (!mpu6050_read(accel, gyro))
            memset(accel, 0, sizeof(accel));

        if (!hmc5883_read(mag))
            memset(mag, 0, sizeof(mag));

        memcpy(telemetry.accel, accel, sizeof(accel));
        memcpy(telemetry.gyro, gyro, sizeof(gyro));
        memcpy(telemetry.mag, mag, sizeof(mag));
        
        int32_t b5;
		int32_t ut = bmp180_read_raw_temp();
		float temp_c = bmp180_calculate_temp(ut, &b5);
		
		int32_t up = bmp180_read_raw_pressure(1);
		int32_t pressure_pa = bmp180_calculate_pressure(up, b5, 1);
		
		telemetry.temperature = (int16_t)(temp_c * 10);
		telemetry.pressure = (uint16_t)(pressure_pa / 100);
		
		if (pressure_samples < 30) {
		    pressure_ref = (pressure_ref * pressure_samples + pressure_pa) / (pressure_samples + 1);
		    pressure_samples++;
		    telemetry.altitude = 0;
		} else {
		    float altitude = 44330.0f * (1.0f - powf((float)pressure_pa / pressure_ref, 0.1903f));
		    telemetry.altitude = (int16_t)altitude;
		}

        uint32_t now = esp_timer_get_time() / 1000;
        if (now - last_send >= 2000) {
            char payload[256];

            snprintf(payload, sizeof(payload),
			    "P=%u,T=%d,"
			    "Ax=%d,Ay=%d,Az=%d,"
			    "Gx=%d,Gy=%d,Gz=%d,"
			    "Mx=%d,My=%d,Mz=%d,"
			    "Alt=%d,"
			    "Lat=%ld,Lon=%ld",
			    telemetry.pressure,
			    telemetry.temperature,
			    telemetry.accel[0], telemetry.accel[1], telemetry.accel[2],
			    telemetry.gyro[0], telemetry.gyro[1], telemetry.gyro[2],
			    telemetry.mag[0], telemetry.mag[1], telemetry.mag[2],
			    telemetry.altitude,
			    (long)telemetry.latitude,
			    (long)telemetry.longitude);

            xbee_send(payload);

            ESP_LOGI(TAG, "%s", payload);

            last_send = now;
        }

        vTaskDelay(pdMS_TO_TICKS(100));
    }
}