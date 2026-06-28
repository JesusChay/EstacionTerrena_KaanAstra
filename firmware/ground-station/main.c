#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "GROUND_STATION";

// ============================================
// PINES Y CONFIGURACIÓN
// ============================================

#define LORA_UART_PORT            UART_NUM_1
#define LORA_TX_PIN               GPIO_NUM_36
#define LORA_RX_PIN               GPIO_NUM_35
#define LORA_BUF_SIZE             512
#define LORA_RX_TIMEOUT_MS        50

#define XBEE_UART_PORT            UART_NUM_2
#define XBEE_TX_PIN               GPIO_NUM_38
#define XBEE_RX_PIN               GPIO_NUM_37
#define XBEE_BUF_SIZE             512
#define XBEE_RX_TIMEOUT_MS        50

#define XBEE_CONFIG_ATTEMPTS      5
#define XBEE_CONFIG_DELAY_MS      2000

#define CMD_UART_PORT             UART_NUM_0
#define CMD_BUF_SIZE              128

// ============================================
// ESTRUCTURA DE DATOS CAN-SAT (38 bytes)
// ============================================
typedef struct __attribute__((packed)) {
    uint32_t timestamp;
    uint32_t pressure;
    int16_t  temperature;
    int16_t  accel[3];
    int16_t  gyro[3];
    int16_t  mag[3];
    int16_t  altitude_gy;
    int32_t  latitude;
    int32_t  longitude;
} cansat_t;

// ============================================
// VARIABLES GLOBALES
// ============================================
static char lora_buffer[LORA_BUF_SIZE];
static int lora_buffer_len = 0;
static char xbee_buffer[XBEE_BUF_SIZE];
static int xbee_buffer_len = 0;
static int xbee_configured = 0;
static char cmd_buffer[CMD_BUF_SIZE];

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

// ============================================
// CONVERTIR HEX STRING A BYTES
// ============================================
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
// IMPRIMIR DATOS EN FORMATO CSV (SOLO DATOS)
// ============================================
static void print_cansat_data(cansat_t *data) {
    float temp = (float)data->temperature / 100.0f;
    float press = (float)data->pressure / 1000.0f;
    float alt = (float)data->altitude_gy;
    float ax = (float)data->accel[0] / 1000.0f;
    float ay = (float)data->accel[1] / 1000.0f;
    float az = (float)data->accel[2] / 1000.0f;
    float gx = (float)data->gyro[0] / 1000.0f;
    float gy = (float)data->gyro[1] / 1000.0f;
    float gz = (float)data->gyro[2] / 1000.0f;
    float mx = (float)data->mag[0] / 10.0f;
    float my = (float)data->mag[1] / 10.0f;
    float mz = (float)data->mag[2] / 10.0f;
    float lat = (float)data->latitude / 10000000.0f;
    float lon = (float)data->longitude / 10000000.0f;
    
    // SOLO DATOS: temp,press,alt,ax,ay,az,gx,gy,gz,mx,my,mz,lat,lon
    printf("%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.6f,%.6f\n",
           temp, press, alt, ax, ay, az, gx, gy, gz, mx, my, mz, lat, lon);
    fflush(stdout);
}

// ============================================
// PROCESAR PAYLOAD LORA
// ============================================
static void process_lora_payload(const char *payload_hex) {
    uint8_t raw_data[sizeof(cansat_t)];
    int len = hex_to_bytes(payload_hex, raw_data, sizeof(cansat_t));
    
    if (len == sizeof(cansat_t)) {
        cansat_t *data = (cansat_t *)raw_data;
        print_cansat_data(data);
    }
}

// ============================================
// PROCESAR PAYLOAD XBEE
// ============================================
static void process_xbee_payload(uint8_t *data, int len) {
    if (len >= 2 && (data[0] == 'O' && data[1] == 'K')) {
        return;
    }
    
    if (len == sizeof(cansat_t)) {
        cansat_t *cansat_data = (cansat_t *)data;
        print_cansat_data(cansat_data);
    }
}

// ============================================
// FUNCIONES LORA
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
    
    uart_driver_install(LORA_UART_PORT, LORA_BUF_SIZE * 2, 0, 0, NULL, 0);
    uart_param_config(LORA_UART_PORT, &uart_config);
    uart_set_pin(LORA_UART_PORT, LORA_TX_PIN, LORA_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    
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
    uint8_t uart_data[LORA_BUF_SIZE];
    int len = uart_read_bytes(LORA_UART_PORT, uart_data, LORA_BUF_SIZE - 1, pdMS_TO_TICKS(LORA_RX_TIMEOUT_MS));
    
    if (len > 0) {
        uart_data[len] = '\0';
        
        if (lora_buffer_len + len < LORA_BUF_SIZE - 1) {
            strcat(lora_buffer, (char*)uart_data);
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
            
            int parsed = sscanf(rcv, "+RCV=%d,%d,%[^,],%d,%d", &addr, &length, payload, &rssi, &snr);
            
            if (parsed >= 3) {
                process_lora_payload(payload);
            }
            
            char *next = end + 2;
            int remaining = lora_buffer_len - (next - rcv);
            if (remaining > 0) {
                memmove(rcv, next, remaining);
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
// COMANDOS SALIENTES POR LORA
// ============================================

static void lora_send_command(const char *cmd) {
    uart_write_bytes(LORA_UART_PORT, cmd, strlen(cmd));
    uart_write_bytes(LORA_UART_PORT, "\r\n", 2);
}

static void lora_send_string(const char *str) {
    int len = strlen(str);
    if (len == 0) return;

    char hex[256];
    for (int i = 0; i < len && i < 128; i++) {
        sprintf(hex + i * 2, "%02X", (unsigned char)str[i]);
    }
    hex[len * 2] = '\0';

    char cmd[320];
    snprintf(cmd, sizeof(cmd), "AT+SEND=0,%d,%s", len, hex);
    lora_send_command(cmd);
}

// ============================================
// LECTURA DE COMANDOS DESDE LA PC (UART0)
// ============================================

static void read_serial_commands(void) {
    uint8_t data[CMD_BUF_SIZE];
    int len = uart_read_bytes(CMD_UART_PORT, data, CMD_BUF_SIZE - 1, pdMS_TO_TICKS(10));

    if (len > 0) {
        data[len] = '\0';

        for (int i = 0; i < len; i++) {
            if (data[i] == '\n' || data[i] == '\r') {
                data[i] = '\0';
            }
        }

        if (strncmp((char*)data, "MISSION_START", 13) == 0) {
            printf("[CMD] Reenviando MISSION_START a LoRa\n");
            fflush(stdout);
            lora_send_string("MISSION_START");
        } else if (strncmp((char*)data, "MISSION_STOP", 12) == 0) {
            printf("[CMD] Reenviando MISSION_STOP a LoRa\n");
            fflush(stdout);
            lora_send_string("MISSION_STOP");
        }
    }
}

// ============================================
// FUNCIONES XBEE
// ============================================

static void xbee_send_command(const char *cmd) {
    uart_write_bytes(XBEE_UART_PORT, cmd, strlen(cmd));
}

static bool xbee_enter_command_mode(void) {
    uart_flush_rx(XBEE_UART_PORT);
    vTaskDelay(pdMS_TO_TICKS(500));
    
    uart_write_bytes(XBEE_UART_PORT, "+", 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    uart_write_bytes(XBEE_UART_PORT, "+", 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    uart_write_bytes(XBEE_UART_PORT, "+", 1);
    vTaskDelay(pdMS_TO_TICKS(1500));
    
    return uart_wait_response(XBEE_UART_PORT, "OK", 2000);
}

static void xbee_exit_command_mode(void) {
    xbee_send_command("ATCN\r");
    vTaskDelay(pdMS_TO_TICKS(500));
    uart_flush_rx(XBEE_UART_PORT);
}

static void xbee_soft_reset(void) {
    xbee_send_command("ATFR\r");
    vTaskDelay(pdMS_TO_TICKS(2000));
    uart_flush_rx(XBEE_UART_PORT);
}

static bool xbee_verify_transparent_mode(void) {
    uart_flush_rx(XBEE_UART_PORT);
    xbee_send_command("AT\r");
    vTaskDelay(pdMS_TO_TICKS(500));
    
    uint8_t test_buf[32];
    int len = uart_read_bytes(XBEE_UART_PORT, test_buf, sizeof(test_buf) - 1, pdMS_TO_TICKS(200));
    
    if (len > 0) {
        test_buf[len] = '\0';
        if (strstr((char*)test_buf, "OK") != NULL) {
            return false;
        }
    }
    
    return true;
}

bool configure_xbee_once(void) {
    uart_flush_rx(XBEE_UART_PORT);
    
    if (!xbee_enter_command_mode()) {
        return false;
    }
    
    xbee_soft_reset();
    
    vTaskDelay(pdMS_TO_TICKS(1000));
    if (!xbee_enter_command_mode()) {
        return false;
    }
    
    xbee_send_command("ATRE\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    xbee_send_command("ATID CAFE\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    xbee_send_command("ATCH 0C\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    xbee_send_command("ATMY 0\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    xbee_send_command("ATCE 1\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    xbee_send_command("ATWR\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 2000)) {
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(200));
    
    xbee_exit_command_mode();
    
    vTaskDelay(pdMS_TO_TICKS(500));
    if (!xbee_verify_transparent_mode()) {
        return false;
    }
    
    return true;
}

void init_xbee_receiver(void) {
    uart_config_t uart_config = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    
    uart_driver_install(XBEE_UART_PORT, XBEE_BUF_SIZE * 2, 0, 0, NULL, 0);
    uart_param_config(XBEE_UART_PORT, &uart_config);
    uart_set_pin(XBEE_UART_PORT, XBEE_TX_PIN, XBEE_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    
    vTaskDelay(pdMS_TO_TICKS(1000));
    uart_flush_rx(XBEE_UART_PORT);
    
    for (int attempt = 1; attempt <= XBEE_CONFIG_ATTEMPTS; attempt++) {
        if (configure_xbee_once()) {
            xbee_configured = 1;
            break;
        }
        
        if (attempt < XBEE_CONFIG_ATTEMPTS) {
            vTaskDelay(pdMS_TO_TICKS(XBEE_CONFIG_DELAY_MS));
            uart_flush_rx(XBEE_UART_PORT);
        }
    }
}

void read_xbee_data(void) {
    if (!xbee_configured) {
        return;
    }
    
    uint8_t uart_data[XBEE_BUF_SIZE];
    int len = uart_read_bytes(XBEE_UART_PORT, uart_data, XBEE_BUF_SIZE - 1, pdMS_TO_TICKS(XBEE_RX_TIMEOUT_MS));
    
    if (len > 0) {
        if (len >= 2 && uart_data[0] == 'O' && uart_data[1] == 'K') {
            return;
        }
        
        if (xbee_buffer_len + len < XBEE_BUF_SIZE - 1) {
            memcpy(xbee_buffer + xbee_buffer_len, uart_data, len);
            xbee_buffer_len += len;
        } else {
            xbee_buffer_len = 0;
            memset(xbee_buffer, 0, XBEE_BUF_SIZE);
        }
        
        while (xbee_buffer_len >= sizeof(cansat_t)) {
            process_xbee_payload((uint8_t*)xbee_buffer, sizeof(cansat_t));
            
            int remaining = xbee_buffer_len - sizeof(cansat_t);
            if (remaining > 0) {
                memmove(xbee_buffer, xbee_buffer + sizeof(cansat_t), remaining);
                xbee_buffer_len = remaining;
            } else {
                xbee_buffer_len = 0;
            }
        }
        
        if (xbee_buffer_len > 0 && xbee_buffer_len < sizeof(cansat_t) && 
            xbee_buffer_len > XBEE_BUF_SIZE - 100) {
            xbee_buffer_len = 0;
            memset(xbee_buffer, 0, XBEE_BUF_SIZE);
        }
    }
}

// ============================================
// APP MAIN
// ============================================

void app_main(void) {
    init_lora_receiver();
    init_xbee_receiver();
    
    memset(lora_buffer, 0, LORA_BUF_SIZE);
    memset(xbee_buffer, 0, XBEE_BUF_SIZE);
    memset(cmd_buffer, 0, CMD_BUF_SIZE);
    lora_buffer_len = 0;
    xbee_buffer_len = 0;
    
    while (1) {
        read_lora_data();
        read_xbee_data();
        read_serial_commands();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}