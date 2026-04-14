#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "TX";

#define GPS_UART    UART_NUM_2
#define GPS_TX_PIN  GPIO_NUM_26
#define GPS_RX_PIN  GPIO_NUM_25

#define LORA_UART   UART_NUM_1
#define LORA_TX_PIN GPIO_NUM_17
#define LORA_RX_PIN GPIO_NUM_16

#define BUF_SIZE    512  // Reducido

// Buffers estáticos
static char gps_buffer[BUF_SIZE];
static uint8_t uart_data[BUF_SIZE];

static bool parse_gpgga(const char *sentence, double *lat, double *lon) {
    if (strstr(sentence, "$GPGGA") == NULL) return false;
    
    char sentence_copy[128];
    strncpy(sentence_copy, sentence, sizeof(sentence_copy) - 1);
    sentence_copy[sizeof(sentence_copy) - 1] = '\0';
    
    char *tokens[15]; 
    int i = 0;
    char *ptr = strtok(sentence_copy, ",");
    while (ptr && i < 15) { 
        tokens[i++] = ptr; 
        ptr = strtok(NULL, ","); 
    }
    
    if (i < 10 || atoi(tokens[6]) == 0) return false;

    *lat = atof(tokens[2]); 
    char lat_dir = tokens[3][0];
    *lon = atof(tokens[4]); 
    char lon_dir = tokens[5][0];

    int deg = (int)(*lat / 100); 
    *lat = deg + (*lat - deg*100)/60.0;
    if (lat_dir == 'S') *lat = -*lat;
    
    deg = (int)(*lon / 100); 
    *lon = deg + (*lon - deg*100)/60.0;
    if (lon_dir == 'W') *lon = -*lon;
    
    return true;
}

static void lora_send_command(const char *cmd) {
    uart_write_bytes(LORA_UART, cmd, strlen(cmd));
    uart_write_bytes(LORA_UART, "\r\n", 2);
}

static void lora_init(void) {
    ESP_LOGI(TAG, "Inicializando RYLR998 LoRa...");
    
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

void app_main(void) {
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // UART GPS
    uart_config_t gps_cfg = {
        .baud_rate = 9600,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    
    ESP_ERROR_CHECK(uart_driver_install(GPS_UART, BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(GPS_UART, &gps_cfg));
    ESP_ERROR_CHECK(uart_set_pin(GPS_UART, GPS_TX_PIN, GPS_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    // UART LoRa
    uart_config_t lora_cfg = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    
    ESP_ERROR_CHECK(uart_driver_install(LORA_UART, BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(LORA_UART, &lora_cfg));
    ESP_ERROR_CHECK(uart_set_pin(LORA_UART, LORA_TX_PIN, LORA_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    lora_init();

    ESP_LOGI(TAG, "=== TRANSMISOR GPS INICIADO ===");

    memset(gps_buffer, 0, BUF_SIZE);
    int gps_len = 0;
    
    double lat = 0, lon = 0;
    uint32_t last_send_time = 0;
    
    while (1) {
        int len = uart_read_bytes(GPS_UART, uart_data, BUF_SIZE - 1, pdMS_TO_TICKS(50));
        
        if (len > 0) {
            if (gps_len + len < BUF_SIZE - 1) {
                memcpy(gps_buffer + gps_len, uart_data, len);
                gps_len += len;
                gps_buffer[gps_len] = '\0';
            } else {
                gps_len = 0;
                memset(gps_buffer, 0, BUF_SIZE);
            }
            
            char *start = gps_buffer;
            char *end;
            
            while ((end = strstr(start, "\r\n")) != NULL) {
                *end = '\0';
                
                if (strstr(start, "$GPGGA") != NULL) {
                    if (parse_gpgga(start, &lat, &lon)) {
                        uint32_t now = esp_timer_get_time() / 1000;
                        
                        if (now - last_send_time >= 2000) {
                            char payload[64];
                            snprintf(payload, sizeof(payload), "LAT:%.6f,LON:%.6f", lat, lon);
                            
                            char cmd[128];
                            snprintf(cmd, sizeof(cmd), "AT+SEND=0,%d,%s\r\n", (int)strlen(payload), payload);
                            uart_write_bytes(LORA_UART, cmd, strlen(cmd));
                            
                            ESP_LOGI(TAG, "GPS enviado: %s", payload);
                            last_send_time = now;
                        }
                    }
                }
                
                start = end + 2;
            }
            
            if (start != gps_buffer) {
                int remaining = gps_len - (start - gps_buffer);
                if (remaining > 0 && remaining < BUF_SIZE) {
                    memmove(gps_buffer, start, remaining);
                    gps_len = remaining;
                    gps_buffer[gps_len] = '\0';
                } else {
                    gps_len = 0;
                    gps_buffer[0] = '\0';
                }
            }
        }
        
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}