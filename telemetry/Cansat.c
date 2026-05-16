#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include <dirent.h>
#include <sys/stat.h>
#include "driver/i2c.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_vfs_fat.h"
#include "sdmmc_cmd.h"
#include "driver/spi_common.h"
#include "driver/sdspi_host.h"
#include "esp_timer.h"

// ============================================
// DEFINICIONES GENERALES Y PINES
// ============================================

// I2C configuration (GY-87)
#define I2C_MASTER_SCL_IO         5
#define I2C_MASTER_SDA_IO         4
#define I2C_MASTER_FREQ_HZ        100000
#define I2C_MASTER_PORT_NUM       I2C_NUM_0

// UART GPS (GT-U7) - UART0 (solo RX para minimizar conflictos con USB)
#define GPS_UART_PORT             UART_NUM_0
#define GPS_TX_PIN                GPIO_NUM_43
#define GPS_RX_PIN                GPIO_NUM_44
#define GPS_BUF_SIZE              256

// UART LoRa (RYLR998) - UART1
#define LORA_UART_PORT            UART_NUM_1
#define LORA_TX_PIN               GPIO_NUM_37
#define LORA_RX_PIN               GPIO_NUM_38
#define LORA_BUF_SIZE             256

// UART XBee (XB3-24AUT-J) - UART2
#define XBEE_UART_PORT            UART_NUM_2
#define XBEE_TX_PIN               GPIO_NUM_35
#define XBEE_RX_PIN               GPIO_NUM_36
#define XBEE_BUF_SIZE             256

// SD Card (SPI)
#define SD_PIN_CLK                18
#define SD_PIN_MOSI               47
#define SD_PIN_MISO               48
#define SD_PIN_CS                 45
#define SD_MOUNT_POINT            "/sdcard"
#define SD_DATA_FILE              "/sdcard/data.txt"

// Intervalo de envío de telemetría (3 segundos para cumplir duty cycle LoRa)
#define TELEMETRY_INTERVAL_MS     3000
#define SD_WRITE_INTERVAL         4      // Cada 4 ciclos (2 segundos)

// ============================================
// DIRECCIONES I2C DE LOS SENSORES
// ============================================
#define MPU6050_ADDR              0x68
#define HMC5883L_ADDR             0x1E
#define BMP180_ADDR               0x77

// ============================================
// REGISTROS MPU6050
// ============================================
#define MPU6050_PWR_MGMT_1        0x6B
#define MPU6050_INT_PIN_CFG       0x37
#define MPU6050_USER_CTRL         0x6A
#define MPU6050_ACCEL_CONFIG      0x1C
#define MPU6050_ACCEL_XOUT_H      0x3B
#define MPU6050_GYRO_XOUT_H       0x43

// ============================================
// REGISTROS HMC5883L
// ============================================
#define HMC5883L_CONFIG_A         0x00
#define HMC5883L_CONFIG_B         0x01
#define HMC5883L_MODE             0x02
#define HMC5883L_DATA_X_H         0x03
#define HMC5883L_STATUS           0x09

// ============================================
// REGISTROS BMP180
// ============================================
#define BMP180_CAL_AC1            0xAA
#define BMP180_CAL_AC2            0xAC
#define BMP180_CAL_AC3            0xAE
#define BMP180_CAL_AC4            0xB0
#define BMP180_CAL_AC5            0xB2
#define BMP180_CAL_AC6            0xB4
#define BMP180_CAL_B1             0xB6
#define BMP180_CAL_B2             0xB8
#define BMP180_CAL_MB             0xBA
#define BMP180_CAL_MC             0xBC
#define BMP180_CAL_MD             0xBE
#define BMP180_CONTROL            0xF4
#define BMP180_TEMPDATA           0xF6
#define BMP180_PRESSUREDATA       0xF6

// BMP180 commands
#define BMP180_READTEMPCMD        0x2E
#define BMP180_READPRESSURECMD    0x34
#define BMP180_STANDARD           1

// ============================================
// CONSTANTES Y PARÁMETROS
// ============================================
#define INITIAL_READINGS_BMP      5
#define FILTER_WINDOW_SIZE        10
#define ALTITUDE_MAX_JUMP         10.0f

static const char *TAG = "CANSAT";

// ============================================
// ESTRUCTURA DE DATOS CAN-SAT (38 bytes)
// ============================================
typedef struct __attribute__((packed)) {
    uint32_t timestamp;     // ms desde inicio (4 bytes)
    uint32_t pressure;      // Pa * 10 (4 bytes)
    int16_t  temperature;   // °C * 100 (2 bytes)
    int16_t  accel[3];      // mg (6 bytes)
    int16_t  gyro[3];       // mdps (6 bytes)
    int16_t  mag[3];        // mGauss = µT * 10 (6 bytes)
    int16_t  altitude_gy;   // metros (2 bytes)
    int32_t  latitude;      // grados * 10^7 (4 bytes)
    int32_t  longitude;     // grados * 10^7 (4 bytes)
} cansat_t;

cansat_t telemetry;

// ============================================
// VARIABLES GLOBALES - GY-87
// ============================================

float mag_bias[3] = {0, 0, 0};
float mag_scale[3] = {1.0, 1.0, 1.0};

int16_t ac1, ac2, ac3, b1, b2, mb, mc, md;
uint16_t ac4, ac5, ac6;
int32_t b5;

float ref_pressure_bmp = 101325.0f;
float initial_pressures_bmp[INITIAL_READINGS_BMP] = {0};
int pressure_readings_count_bmp = 0;

float altitude_buffer[FILTER_WINDOW_SIZE] = {0};
float altitude_sum = 0;
float filtered_altitude_bmp = 0.0f;
int alt_index = 0;

const float ACCEL_SCALE_2G = 16384.0f;
const float GYRO_SCALE_250DPS = 131.0f;
const float HMC5883L_GAIN_1_3GA = 1090.0f;
const float GAUSS_TO_MICROTESLA = 100.0f;

static float temp_celsius = 0.0f;
static float pressure_hpa = 0.0f;
static float altitude_bmp = 0.0f;
static float ax = 0.0f, ay = 0.0f, az = 0.0f;
static float gx = 0.0f, gy = 0.0f, gz = 0.0f;
static float mx = 0.0f, my = 0.0f, mz = 0.0f;

// ============================================
// VARIABLES GLOBALES - GPS
// ============================================
static float last_valid_lat = 0;
static float last_valid_lon = 0;
static int gps_first_fix_received = 0;

static float gps_altitude_buffer[FILTER_WINDOW_SIZE] = {0};
static float gps_altitude_sum = 0;
static int gps_alt_index = 0;

// ============================================
// VARIABLES GLOBALES - SD CARD
// ============================================
static sdmmc_card_t *sdcard = NULL;
static int sd_ready = 0;
static int sd_write_counter = 0;

// ============================================
// VARIABLES GLOBALES - TELEMETRÍA
// ============================================
static uint32_t last_telemetry_send = 0;

// ============================================
// FUNCIONES I2C BASE
// ============================================

void i2c_master_init(void) {
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
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, reg_addr, true);
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (dev_addr << 1) | I2C_MASTER_READ, true);
    if (len > 1) {
        i2c_master_read(cmd, data, len - 1, I2C_MASTER_ACK);
    }
    i2c_master_read_byte(cmd, data + len - 1, I2C_MASTER_NACK);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(I2C_MASTER_PORT_NUM, cmd, 1000 / portTICK_PERIOD_MS);
    i2c_cmd_link_delete(cmd);
    return ret;
}

// ============================================
// SECCIÓN GY-87 - MPU6050
// ============================================

void enable_bypass_mode(void) {
    i2c_register_write(MPU6050_ADDR, MPU6050_USER_CTRL, 0x00);
    i2c_register_write(MPU6050_ADDR, MPU6050_INT_PIN_CFG, 0x02);
    i2c_register_write(MPU6050_ADDR, MPU6050_PWR_MGMT_1, 0x00);
    vTaskDelay(pdMS_TO_TICKS(100));
}

void mpu6050_init(void) {
    i2c_register_write(MPU6050_ADDR, MPU6050_PWR_MGMT_1, 0x00);
    i2c_register_write(MPU6050_ADDR, MPU6050_ACCEL_CONFIG, 0x00);
    vTaskDelay(pdMS_TO_TICKS(100));
}

void mpu6050_read_accel_gyro(int16_t *accel, int16_t *gyro) {
    uint8_t raw_data[14];
    if (i2c_register_read(MPU6050_ADDR, MPU6050_ACCEL_XOUT_H, raw_data, 14) == ESP_OK) {
        accel[0] = (raw_data[0] << 8) | raw_data[1];
        accel[1] = (raw_data[2] << 8) | raw_data[3];
        accel[2] = (raw_data[4] << 8) | raw_data[5];
        gyro[0] = (raw_data[8] << 8) | raw_data[9];
        gyro[1] = (raw_data[10] << 8) | raw_data[11];
        gyro[2] = (raw_data[12] << 8) | raw_data[13];
    }
}

// ============================================
// SECCIÓN GY-87 - HMC5883L
// ============================================

void hmc5883l_init(void) {
    i2c_register_write(HMC5883L_ADDR, HMC5883L_CONFIG_A, 0x78);
    i2c_register_write(HMC5883L_ADDR, HMC5883L_CONFIG_B, 0x20);
    i2c_register_write(HMC5883L_ADDR, HMC5883L_MODE, 0x00);
    vTaskDelay(pdMS_TO_TICKS(100));
}

bool hmc5883l_read_mag(int16_t *mag) {
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

void calibrate_magnetometer(void) {
    int16_t mag[3];
    int16_t mag_min[3] = {2047, 2047, 2047};
    int16_t mag_max[3] = {-2048, -2048, -2048};
    
    vTaskDelay(pdMS_TO_TICKS(2000));
    
    for (int i = 0; i < 300; i++) {
        if (hmc5883l_read_mag(mag)) {
            for (int j = 0; j < 3; j++) {
                if (mag[j] < mag_min[j]) mag_min[j] = mag[j];
                if (mag[j] > mag_max[j]) mag_max[j] = mag[j];
            }
        }
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    
    for (int j = 0; j < 3; j++) {
        mag_bias[j] = (mag_max[j] + mag_min[j]) / 2.0f;
        mag_scale[j] = (mag_max[j] - mag_min[j]) / 2.0f;
    }
    
    float avg_scale = (mag_scale[0] + mag_scale[1] + mag_scale[2]) / 3.0f;
    for (int j = 0; j < 3; j++) {
        if (mag_scale[j] != 0) {
            mag_scale[j] = avg_scale / mag_scale[j];
        } else {
            mag_scale[j] = 1.0f;
        }
    }
}

// ============================================
// SECCIÓN GY-87 - BMP180
// ============================================

void bmp180_read_calibration_data(void) {
    uint8_t cal_data[22];
    
    if (i2c_register_read(BMP180_ADDR, BMP180_CAL_AC1, cal_data, 22) == ESP_OK) {
        ac1 = (cal_data[0] << 8) | cal_data[1];
        ac2 = (cal_data[2] << 8) | cal_data[3];
        ac3 = (cal_data[4] << 8) | cal_data[5];
        ac4 = (cal_data[6] << 8) | cal_data[7];
        ac5 = (cal_data[8] << 8) | cal_data[9];
        ac6 = (cal_data[10] << 8) | cal_data[11];
        b1 = (cal_data[12] << 8) | cal_data[13];
        b2 = (cal_data[14] << 8) | cal_data[15];
        mb = (cal_data[16] << 8) | cal_data[17];
        mc = (cal_data[18] << 8) | cal_data[19];
        md = (cal_data[20] << 8) | cal_data[21];
    }
}

bool bmp180_is_ready(void) {
    uint8_t status;
    if(i2c_register_read(BMP180_ADDR, 0xF4, &status, 1) == ESP_OK) {
        return (status & 0x20) == 0;
    }
    return false;
}

bool bmp180_begin(void) {
    uint8_t id;
    if(i2c_register_read(BMP180_ADDR, 0xD0, &id, 1) != ESP_OK || id != 0x55) {
        return false;
    }
    bmp180_read_calibration_data();
    return true;
}

int32_t bmp180_read_raw_temp(void) {
    int timeout = 100;
    while(!bmp180_is_ready() && timeout-- > 0) {
        vTaskDelay(pdMS_TO_TICKS(1));
    }

    if(i2c_register_write(BMP180_ADDR, BMP180_CONTROL, BMP180_READTEMPCMD) != ESP_OK) {
        return -1;
    }

    vTaskDelay(pdMS_TO_TICKS(10));

    uint8_t data[2];
    if(i2c_register_read(BMP180_ADDR, BMP180_TEMPDATA, data, 2) != ESP_OK) {
        return -1;
    }

    return (data[0] << 8) | data[1];
}

int32_t bmp180_read_raw_pressure(uint8_t oss) {
    int timeout = 100;
    while(!bmp180_is_ready() && timeout-- > 0) {
        vTaskDelay(pdMS_TO_TICKS(1));
    }

    uint8_t cmd = BMP180_READPRESSURECMD + (oss << 6);
    if(i2c_register_write(BMP180_ADDR, BMP180_CONTROL, cmd) != ESP_OK) {
        return -1;
    }

    uint16_t delay_ms;
    switch(oss) {
        case 0: delay_ms = 10; break;
        case 1: delay_ms = 15; break;
        case 2: delay_ms = 25; break;
        case 3: delay_ms = 45; break;
        default: delay_ms = 15;
    }
    vTaskDelay(pdMS_TO_TICKS(delay_ms));

    uint8_t data[3];
    if(i2c_register_read(BMP180_ADDR, BMP180_PRESSUREDATA, data, 3) != ESP_OK) {
        return -1;
    }

    int32_t raw = (((int32_t)data[0] << 16) | ((int32_t)data[1] << 8) | (int32_t)data[2]) >> (8 - oss);
    return raw;
}

float bmp180_calculate_temp(int32_t ut) {
    int32_t x1, x2;
    
    x1 = ((ut - ac6) * ac5) >> 15;
    x2 = (mc << 11) / (x1 + md);
    
    b5 = x1 + x2;
    float temp = ((b5 + 8) >> 4) / 10.0f;
    
    return temp;
}

int32_t bmp180_calculate_pressure(int32_t up, uint8_t oss) {
    int32_t x1, x2, b6, x3, b3, p;
    uint32_t b4, b7;
    
    b6 = b5 - 4000;
    x1 = (b2 * ((b6 * b6) >> 12)) >> 11;
    x2 = (ac2 * b6) >> 11;
    x3 = x1 + x2;
    b3 = (((ac1 * 4 + x3) << oss) + 2) >> 2;
    
    x1 = (ac3 * b6) >> 13;
    x2 = (b1 * ((b6 * b6) >> 12)) >> 16;
    x3 = ((x1 + x2) + 2) >> 2;
    b4 = (ac4 * (uint32_t)(x3 + 32768)) >> 15;
    
    if (b4 == 0) return 0;
    
    b7 = ((uint32_t)(up - b3) * (50000 >> oss));
    
    if (b7 < 0x80000000) {
        p = (b7 * 2) / b4;
    } else {
        p = (b7 / b4) * 2;
    }
    
    x1 = (p >> 8) * (p >> 8);
    x1 = (x1 * 3038) >> 16;
    x2 = (-7357 * p) >> 16;
    p = p + ((x1 + x2 + 3791) >> 4);
    
    return p;
}

float calculate_altitude_bmp(float pressure_pa, float reference_pressure_pa) {
    if (reference_pressure_pa <= 0) return 0.0f;
    float altitude = 44330.0f * (1.0f - powf(pressure_pa / reference_pressure_pa, 0.1903f));
    return (altitude > 0) ? altitude : 0.0f;
}

void update_altitude_bmp(float pressure_pa) {
    float new_altitude = calculate_altitude_bmp(pressure_pa, ref_pressure_bmp);
    
    if (fabsf(new_altitude - filtered_altitude_bmp) > ALTITUDE_MAX_JUMP) {
        return;
    }
    
    filtered_altitude_bmp = new_altitude;
    
    altitude_sum -= altitude_buffer[alt_index];
    altitude_buffer[alt_index] = new_altitude;
    altitude_sum += new_altitude;
    alt_index = (alt_index + 1) % FILTER_WINDOW_SIZE;
    
    altitude_bmp = altitude_sum / FILTER_WINDOW_SIZE;
}

// ============================================
// SECCIÓN GPS - GT-U7 (UART0, solo RX)
// ============================================

float convert_to_decimal_degrees(float raw_degrees, char direction) {
    int degrees = (int)(raw_degrees / 100);
    float minutes = raw_degrees - (degrees * 100);
    float decimal_degrees = degrees + (minutes / 60.0f);
    
    if (direction == 'S' || direction == 'W') {
        decimal_degrees = -decimal_degrees;
    }
    
    return decimal_degrees;
}

float apply_moving_average_gps(float new_value) {
    gps_altitude_sum -= gps_altitude_buffer[gps_alt_index];
    gps_altitude_sum += new_value;
    gps_altitude_buffer[gps_alt_index] = new_value;
    gps_alt_index = (gps_alt_index + 1) % FILTER_WINDOW_SIZE;
    return gps_altitude_sum / FILTER_WINDOW_SIZE;
}

void process_gpgga(const char *message) {
    char time[10], lat[12], lat_dir, lon[12], lon_dir, fix_quality;
    char num_satellites[3], hdop[6], altitude[10], altitude_units;
    char geoid_height[10], geoid_units;

    int parsed = sscanf(message, "$GPGGA,%[^,],%[^,],%c,%[^,],%c,%c,%[^,],%[^,],%[^,],%c,%[^,],%c",
                        time, lat, &lat_dir, lon, &lon_dir, &fix_quality, 
                        num_satellites, hdop, altitude, &altitude_units, 
                        geoid_height, &geoid_units);

    if (parsed >= 6 && fix_quality != '0') {
        float lat_raw = atof(lat);
        float lon_raw = atof(lon);
        
        last_valid_lat = convert_to_decimal_degrees(lat_raw, lat_dir);
        last_valid_lon = convert_to_decimal_degrees(lon_raw, lon_dir);
        
        if (!gps_first_fix_received) {
            gps_first_fix_received = 1;
        }
        
        float gps_altitude = atof(altitude);
        apply_moving_average_gps(gps_altitude);
    }
}

void read_gps_data(void) {
    uint8_t *data = (uint8_t *)malloc(GPS_BUF_SIZE);
    if (data == NULL) return;
    
    char buffer[512] = {0};
    size_t buffer_index = 0;
    
    int len = uart_read_bytes(GPS_UART_PORT, data, GPS_BUF_SIZE, pdMS_TO_TICKS(20));
    
    if (len > 0) {
        if (buffer_index + len < sizeof(buffer)) {
            memcpy(buffer + buffer_index, data, len);
            buffer_index += len;
        } else {
            buffer_index = 0;
        }
        
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
        
        if (start != buffer) {
            size_t remaining = buffer + buffer_index - start;
            memmove(buffer, start, remaining);
            buffer_index = remaining;
        }
    }
    
    free(data);
}

// ============================================
// SECCIÓN LORA - RYLR998 (UART1)
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
    ESP_LOGI(TAG, "Inicializando LoRa...");
    
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
    
    ESP_LOGI(TAG, "LoRa inicializado correctamente");
}

void lora_send_telemetry(cansat_t *data) {
    // Convertir estructura a hex string
    char hex_payload[sizeof(cansat_t) * 2 + 1];
    uint8_t *bytes = (uint8_t *)data;
    
    for (int i = 0; i < sizeof(cansat_t); i++) {
        sprintf(&hex_payload[i * 2], "%02X", bytes[i]);
    }
    hex_payload[sizeof(cansat_t) * 2] = '\0';
    
    // Comando con terminador correcto (DENTRO del snprintf)
    char cmd[256];
    snprintf(cmd, sizeof(cmd), "AT+SEND=0,%d,%s\r\n", (int)strlen(hex_payload), hex_payload);
    
    uart_write_bytes(LORA_UART_PORT, cmd, strlen(cmd));
    
    // Esperar confirmación (opcional, no bloqueante)
    uart_wait_response(LORA_UART_PORT, "+OK", 500);
}

// ============================================
// SECCIÓN XBEE - XB3-24AUT-J (UART2)
// ============================================

static void xbee_send_command(const char *cmd) {
    uart_write_bytes(XBEE_UART_PORT, cmd, strlen(cmd));
}

static bool xbee_enter_command_mode(void) {
    uart_flush_rx(XBEE_UART_PORT);
    vTaskDelay(pdMS_TO_TICKS(1200));
    
    uart_write_bytes(XBEE_UART_PORT, "+++", 3);
    vTaskDelay(pdMS_TO_TICKS(1200));
    
    return uart_wait_response(XBEE_UART_PORT, "OK", 1500);
}

static void xbee_exit_command_mode(void) {
    xbee_send_command("ATCN\r");
    vTaskDelay(pdMS_TO_TICKS(200));
}

void init_xbee(void) {
    ESP_LOGI(TAG, "Inicializando XBee...");
    
    uart_config_t uart_config = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    
    ESP_ERROR_CHECK(uart_driver_install(XBEE_UART_PORT, XBEE_BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(XBEE_UART_PORT, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(XBEE_UART_PORT, XBEE_TX_PIN, XBEE_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
    
    vTaskDelay(pdMS_TO_TICKS(500));
    
    if (!xbee_enter_command_mode()) {
        ESP_LOGE(TAG, "No se pudo entrar a modo comando XBee");
        return;
    }
    
    // Resetear a valores de fábrica
    xbee_send_command("ATRE\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar PAN ID
    xbee_send_command("ATID CAFE\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar canal (0C = 2.410 GHz)
    xbee_send_command("ATCH 0C\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar dirección origen (MY=1 para transmisor)
    xbee_send_command("ATMY 1\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar dirección destino (DL=0, DH=0 = broadcast)
    xbee_send_command("ATDL 0\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    xbee_send_command("ATDH 0\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar como coordinador (0 = endpoint, no coordinar)
    xbee_send_command("ATCE 0\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // CORREGIDO: Potencia de transmisión (4 = +8 dBm)
    xbee_send_command("ATPL 4\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Guardar configuración
    xbee_send_command("ATWR\r");
    uart_wait_response(XBEE_UART_PORT, "OK", 2000);
    vTaskDelay(pdMS_TO_TICKS(200));
    
    // Salir del modo comando
    xbee_exit_command_mode();
    
    ESP_LOGI(TAG, "XBee inicializado correctamente");
}

void xbee_send_telemetry(cansat_t *data) {
    // Envío binario directo (modo transparente)
    uart_write_bytes(XBEE_UART_PORT, (uint8_t *)data, sizeof(cansat_t));
}

// ============================================
// SECCIÓN SD CARD
// ============================================

void write_to_sd(void) {
    if (!sd_ready) return;
    
    FILE *f = fopen(SD_DATA_FILE, "a");
    if (f == NULL) return;
    
    fprintf(f, "%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.6f,%.6f\n",
            temp_celsius, pressure_hpa, altitude_bmp,
            ax, ay, az, gx, gy, gz,
            mx, my, mz, last_valid_lat, last_valid_lon);
    fclose(f);
}

void init_sdcard(void) {
    esp_vfs_fat_sdmmc_mount_config_t mount_config = {
        .format_if_mount_failed = true,
        .max_files = 5,
        .allocation_unit_size = 16 * 1024
    };
    
    sdmmc_host_t host = SDSPI_HOST_DEFAULT();
    host.slot = SPI2_HOST;
    
    spi_bus_config_t bus_cfg = {
        .mosi_io_num = SD_PIN_MOSI,
        .miso_io_num = SD_PIN_MISO,
        .sclk_io_num = SD_PIN_CLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4000,
    };
    
    esp_err_t ret = spi_bus_initialize(host.slot, &bus_cfg, SDSPI_DEFAULT_DMA);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Error al inicializar bus SPI: %s", esp_err_to_name(ret));
        sd_ready = 0;
        return;
    }
    
    sdspi_device_config_t slot_config = SDSPI_DEVICE_CONFIG_DEFAULT();
    slot_config.gpio_cs = SD_PIN_CS;
    slot_config.host_id = host.slot;
    
    ret = esp_vfs_fat_sdspi_mount(SD_MOUNT_POINT, &host, &slot_config, &mount_config, &sdcard);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Error al montar SD: %s", esp_err_to_name(ret));
        sd_ready = 0;
        return;
    }
    
    sd_ready = 1;
    ESP_LOGI(TAG, "SD Card montada correctamente");
}

// ============================================
// CONFIGURACIÓN UART GPS (UART0, solo RX)
// ============================================

void init_uart_gps(void) {
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
    ESP_ERROR_CHECK(uart_set_pin(GPS_UART_PORT, GPS_TX_PIN, GPS_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
}

// ============================================
// FUNCIÓN PARA LEER TODOS LOS SENSORES GY-87
// ============================================

void read_gy87_sensors(void) {
    int16_t accel[3], gyro[3], mag[3];
    
    mpu6050_read_accel_gyro(accel, gyro);
    
    ax = (float)accel[0] / ACCEL_SCALE_2G;
    ay = (float)accel[1] / ACCEL_SCALE_2G;
    az = (float)accel[2] / ACCEL_SCALE_2G;
    
    gx = (float)gyro[0] / GYRO_SCALE_250DPS;
    gy = (float)gyro[1] / GYRO_SCALE_250DPS;
    gz = (float)gyro[2] / GYRO_SCALE_250DPS;
    
    telemetry.accel[0] = (int16_t)(ax * 1000.0f);
    telemetry.accel[1] = (int16_t)(ay * 1000.0f);
    telemetry.accel[2] = (int16_t)(az * 1000.0f);
    
    telemetry.gyro[0] = (int16_t)(gx * 1000.0f);
    telemetry.gyro[1] = (int16_t)(gy * 1000.0f);
    telemetry.gyro[2] = (int16_t)(gz * 1000.0f);
    
    if (hmc5883l_read_mag(mag)) {
        float mx_cal = (float)(mag[0] - mag_bias[0]) * mag_scale[0] / HMC5883L_GAIN_1_3GA * GAUSS_TO_MICROTESLA;
        float my_cal = (float)(mag[1] - mag_bias[1]) * mag_scale[1] / HMC5883L_GAIN_1_3GA * GAUSS_TO_MICROTESLA;
        float mz_cal = (float)(mag[2] - mag_bias[2]) * mag_scale[2] / HMC5883L_GAIN_1_3GA * GAUSS_TO_MICROTESLA;
        
        mx = mx_cal;
        my = my_cal;
        mz = mz_cal;
        
        telemetry.mag[0] = (int16_t)(mx * 10.0f);
        telemetry.mag[1] = (int16_t)(my * 10.0f);
        telemetry.mag[2] = (int16_t)(mz * 10.0f);
    } else {
        mx = my = mz = 0.0f;
        telemetry.mag[0] = telemetry.mag[1] = telemetry.mag[2] = 0;
    }
    
    int32_t ut = bmp180_read_raw_temp();
    if (ut > 0) {
        temp_celsius = bmp180_calculate_temp(ut);
        telemetry.temperature = (int16_t)(temp_celsius * 100.0f);
    }
    
    int32_t up = bmp180_read_raw_pressure(BMP180_STANDARD);
    if (up > 0) {
        int32_t pressure_pa = bmp180_calculate_pressure(up, BMP180_STANDARD);
        if (pressure_pa > 0) {
            pressure_hpa = (float)pressure_pa / 100.0f;
            telemetry.pressure = (uint32_t)((float)pressure_pa * 10.0f);
            
            if (pressure_readings_count_bmp < INITIAL_READINGS_BMP) {
                initial_pressures_bmp[pressure_readings_count_bmp] = pressure_pa;
                pressure_readings_count_bmp++;
                
                if (pressure_readings_count_bmp == INITIAL_READINGS_BMP) {
                    float sum = 0;
                    for (int i = 0; i < INITIAL_READINGS_BMP; i++) {
                        sum += initial_pressures_bmp[i];
                    }
                    ref_pressure_bmp = sum / INITIAL_READINGS_BMP;
                }
                altitude_bmp = 0.0f;
                filtered_altitude_bmp = 0.0f;
            } else {
                update_altitude_bmp(pressure_pa);
            }
            
            telemetry.altitude_gy = (int16_t)altitude_bmp;
        }
    }
    
    // Actualizar timestamp y coordenadas GPS en telemetría
    telemetry.timestamp = esp_timer_get_time() / 1000;
    telemetry.latitude = (int32_t)(last_valid_lat * 10000000.0);
    telemetry.longitude = (int32_t)(last_valid_lon * 10000000.0);
}

// ============================================
// LOOP PRINCIPAL
// ============================================

void app_main(void) {
    // ============================================
    // INICIALIZAR SENSORES GY-87
    // ============================================
    i2c_master_init();
    mpu6050_init();
    enable_bypass_mode();
    hmc5883l_init();
    
    if (!bmp180_begin()) {
        ESP_LOGE(TAG, "BMP180 initialization failed!");
        while (1) { vTaskDelay(pdMS_TO_TICKS(1000)); }
    }
    
    // Calibrar magnetómetro (opcional, descomentar si es necesario)
    // calibrate_magnetometer();
    
    // ============================================
    // INICIALIZAR COMUNICACIONES
    // ============================================
    init_uart_gps();      // UART0 - GPS (solo RX)
    init_lora();          // UART1 - LoRa
    init_xbee();          // UART2 - XBee
    
    // ============================================
    // INICIALIZAR SD CARD (backup local)
    // ============================================
    init_sdcard();
    
    // ============================================
    // INICIALIZAR BUFFERS
    // ============================================
    for (int i = 0; i < FILTER_WINDOW_SIZE; i++) {
        altitude_buffer[i] = 0.0f;
        gps_altitude_buffer[i] = 0.0f;
    }
    
    ESP_LOGI(TAG, "System ready. Waiting for GPS fix...");
    
    // ============================================
    // LOOP PRINCIPAL (100ms delay, envío cada 3s)
    // ============================================
    while (1) {
        // Leer GPS
        read_gps_data();
        
        // Leer sensores GY-87
        read_gy87_sensors();
        
        // Backup en SD (cada 2 segundos)
        if (gps_first_fix_received) {
            sd_write_counter++;
            if (sd_write_counter >= SD_WRITE_INTERVAL) {
                write_to_sd();
                sd_write_counter = 0;
            }
        }
        
        // Enviar telemetría cada 3 segundos
        uint32_t now = esp_timer_get_time() / 1000;
        if (now - last_telemetry_send >= TELEMETRY_INTERVAL_MS && gps_first_fix_received) {
            lora_send_telemetry(&telemetry);
            xbee_send_telemetry(&telemetry);
            last_telemetry_send = now;
        }
        
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}