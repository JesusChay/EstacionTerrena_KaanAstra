#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_log.h"

static const char *TAG = "GROUND_STATION";

// ============================================
// PINES Y CONFIGURACIÓN
// ============================================

// UART LoRa (RYLR998) - UART1
#define LORA_UART_PORT            UART_NUM_1
#define LORA_TX_PIN               GPIO_NUM_37
#define LORA_RX_PIN               GPIO_NUM_38
#define LORA_BUF_SIZE             512

// UART XBee (XB3-24AUT-J) - UART2
#define XBEE_UART_PORT            UART_NUM_2
#define XBEE_TX_PIN               GPIO_NUM_35
#define XBEE_RX_PIN               GPIO_NUM_36
#define XBEE_BUF_SIZE             512

// Intentos de configuración XBee
#define XBEE_CONFIG_ATTEMPTS      5
#define XBEE_CONFIG_DELAY_MS      2000

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
static char xbee_buffer[XBEE_BUF_SIZE];
static int lora_buffer_len = 0;
static int xbee_buffer_len = 0;
static uint32_t lora_count = 0;
static uint32_t xbee_count = 0;
static int xbee_configured = 0;

// ============================================
// FUNCIONES AUXILIARES
// ============================================

static void uart_flush_rx(uart_port_t uart) {
    uint8_t tmp[64];
    int total = 0;
    int len;
    while ((len = uart_read_bytes(uart, tmp, sizeof(tmp), pdMS_TO_TICKS(10))) > 0) {
        total += len;
    }
    if (total > 0) {
        ESP_LOGD(TAG, "Flushed %d bytes from UART%d", total, uart);
    }
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
                ESP_LOGI(TAG, "Respuesta: %s", buffer);
                return true;
            }
            if (idx >= (int)sizeof(buffer) - 1) {
                idx = 0;
                memset(buffer, 0, sizeof(buffer));
            }
        }
    }
    ESP_LOGW(TAG, "Timeout esperando '%s' (%d ms)", expected, timeout_ms);
    return false;
}

// ============================================
// FUNCIÓN PARA IMPRIMIR DATOS EN FORMATO CSV
// ============================================
static void print_cansat_csv(cansat_t *data, const char *source) {
    float temp = (float)data->temperature / 100.0f;
    float press = (float)data->pressure / 1000.0f;
    float ax = (float)data->accel[0] / 1000.0f;
    float ay = (float)data->accel[1] / 1000.0f;
    float az = (float)data->accel[2] / 1000.0f;
    float gx = (float)data->gyro[0] / 1000.0f;
    float gy = (float)data->gyro[1] / 1000.0f;
    float gz = (float)data->gyro[2] / 1000.0f;
    float mx = (float)data->mag[0] / 10.0f;
    float my = (float)data->mag[1] / 10.0f;
    float mz = (float)data->mag[2] / 10.0f;
    float alt = (float)data->altitude_gy;
    float lat = (float)data->latitude / 10000000.0f;
    float lon = (float)data->longitude / 10000000.0f;
    
    printf("%s: %.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.6f,%.6f\n",
           source, temp, press, alt, ax, ay, az, gx, gy, gz, mx, my, mz, lat, lon);
    fflush(stdout);
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
// PROCESAR PAYLOAD LORA (formato hex)
// ============================================
static void process_lora_payload(const char *payload_hex) {
    uint8_t raw_data[sizeof(cansat_t)];
    int len = hex_to_bytes(payload_hex, raw_data, sizeof(cansat_t));
    
    if (len == sizeof(cansat_t)) {
        cansat_t *data = (cansat_t *)raw_data;
        lora_count++;
        print_cansat_csv(data, "LORA");
    } else {
        ESP_LOGW(TAG, "LoRa payload inválido (%d bytes esperaba %d)", 
                 len, (int)sizeof(cansat_t));
    }
}

// ============================================
// PROCESAR PAYLOAD XBEE (binario directo)
// ============================================
static void process_xbee_payload(uint8_t *data, int len) {
    // Verificar que los datos no sean una respuesta de comando
    if (len >= 2 && (data[0] == 'O' && data[1] == 'K')) {
        ESP_LOGD(TAG, "Ignorando respuesta OK del XBee");
        return;
    }
    
    if (len == sizeof(cansat_t)) {
        cansat_t *cansat_data = (cansat_t *)data;
        xbee_count++;
        print_cansat_csv(cansat_data, "XBEE");
    } else {
        ESP_LOGW(TAG, "XBee payload inválido (%d bytes esperaba %d)", 
                 len, (int)sizeof(cansat_t));
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
    ESP_LOGI(TAG, "Inicializando LoRa receptor...");
    
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
    
    ESP_LOGI(TAG, "LoRa receptor listo");
}

void read_lora_data(void) {
    uint8_t uart_data[LORA_BUF_SIZE];
    int len = uart_read_bytes(LORA_UART_PORT, uart_data, LORA_BUF_SIZE - 1, pdMS_TO_TICKS(10));
    
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
// FUNCIONES XBEE (RECEPTOR) - VERSIÓN CORREGIDA
// ============================================

static void xbee_send_command(const char *cmd) {
    uart_write_bytes(XBEE_UART_PORT, cmd, strlen(cmd));
}

static bool xbee_enter_command_mode(void) {
    ESP_LOGI(TAG, "Enviando +++ para entrar a modo comando...");
    
    // Limpiar buffer completamente
    uart_flush_rx(XBEE_UART_PORT);
    vTaskDelay(pdMS_TO_TICKS(500));
    
    // Enviar +++ con delays entre caracteres (más robusto)
    uart_write_bytes(XBEE_UART_PORT, "+", 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    uart_write_bytes(XBEE_UART_PORT, "+", 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    uart_write_bytes(XBEE_UART_PORT, "+", 1);
    vTaskDelay(pdMS_TO_TICKS(1500));
    
    return uart_wait_response(XBEE_UART_PORT, "OK", 2000);
}

static void xbee_exit_command_mode(void) {
    ESP_LOGI(TAG, "Saliendo del modo comando (ATCN)...");
    xbee_send_command("ATCN\r");
    vTaskDelay(pdMS_TO_TICKS(500));
    uart_flush_rx(XBEE_UART_PORT);
}

static void xbee_soft_reset(void) {
    ESP_LOGI(TAG, "Reset suave del XBee (ATFR)...");
    xbee_send_command("ATFR\r");
    vTaskDelay(pdMS_TO_TICKS(2000));
    uart_flush_rx(XBEE_UART_PORT);
}

static bool xbee_verify_transparent_mode(void) {
    ESP_LOGI(TAG, "Verificando modo transparente...");
    
    // Limpiar buffer
    uart_flush_rx(XBEE_UART_PORT);
    
    // Enviar un comando AT (no debería responder en modo transparente)
    xbee_send_command("AT\r");
    vTaskDelay(pdMS_TO_TICKS(500));
    
    // Verificar si hay respuesta
    uint8_t test_buf[32];
    int len = uart_read_bytes(XBEE_UART_PORT, test_buf, sizeof(test_buf) - 1, pdMS_TO_TICKS(200));
    
    if (len > 0) {
        test_buf[len] = '\0';
        // Si responde con OK, está en modo comando
        if (strstr((char*)test_buf, "OK") != NULL) {
            ESP_LOGE(TAG, "XBee sigue en modo comando (respondió OK a AT)");
            return false;
        }
    }
    
    ESP_LOGI(TAG, "XBee está en modo transparente");
    return true;
}

bool configure_xbee_once(void) {
    ESP_LOGI(TAG, "Configurando XBee...");
    
    // Limpiar cualquier dato previo
    uart_flush_rx(XBEE_UART_PORT);
    
    // Entrar a modo comando
    if (!xbee_enter_command_mode()) {
        ESP_LOGE(TAG, "No se pudo entrar a modo comando");
        return false;
    }
    
    // Reset suave
    xbee_soft_reset();
    
    // Re-entrar a modo comando después del reset
    vTaskDelay(pdMS_TO_TICKS(1000));
    if (!xbee_enter_command_mode()) {
        ESP_LOGE(TAG, "No se pudo re-entrar a modo comando después del reset");
        return false;
    }
    
    // Resetear a valores de fábrica
    xbee_send_command("ATRE\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATRE");
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar PAN ID
    xbee_send_command("ATID CAFE\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATID");
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar canal
    xbee_send_command("ATCH 0C\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATCH");
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar dirección (receptor)
    xbee_send_command("ATMY 0\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATMY");
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Configurar como coordinador
    xbee_send_command("ATCE 1\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATCE");
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
    
    // Guardar configuración
    xbee_send_command("ATWR\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 2000)) {
        ESP_LOGE(TAG, "Fallo ATWR");
        xbee_exit_command_mode();
        return false;
    }
    vTaskDelay(pdMS_TO_TICKS(200));
    
    // Salir del modo comando
    xbee_exit_command_mode();
    
    // Verificar que realmente salió del modo comando
    vTaskDelay(pdMS_TO_TICKS(500));
    if (!xbee_verify_transparent_mode()) {
        ESP_LOGE(TAG, "Verificación de modo transparente falló");
        return false;
    }
    
    ESP_LOGI(TAG, "XBee configurado exitosamente en modo transparente");
    return true;
}

void init_xbee_receiver(void) {
    ESP_LOGI(TAG, "Inicializando XBee receptor...");
    
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
    
    // Esperar estabilización del módulo
    vTaskDelay(pdMS_TO_TICKS(1000));
    uart_flush_rx(XBEE_UART_PORT);
    
    for (int attempt = 1; attempt <= XBEE_CONFIG_ATTEMPTS; attempt++) {
        ESP_LOGI(TAG, "\n=== Intento de configuración XBee %d/%d ===", attempt, XBEE_CONFIG_ATTEMPTS);
        
        if (configure_xbee_once()) {
            xbee_configured = 1;
            break;
        }
        
        if (attempt < XBEE_CONFIG_ATTEMPTS) {
            ESP_LOGW(TAG, "Reintentando en %d ms...", XBEE_CONFIG_DELAY_MS);
            vTaskDelay(pdMS_TO_TICKS(XBEE_CONFIG_DELAY_MS));
            uart_flush_rx(XBEE_UART_PORT);
        }
    }
    
    if (xbee_configured) {
        ESP_LOGI(TAG, "✅ XBee receptor listo y en modo transparente");
    } else {
        ESP_LOGE(TAG, "❌ No se pudo configurar XBee después de %d intentos", XBEE_CONFIG_ATTEMPTS);
        ESP_LOGI(TAG, "Sugerencias:");
        ESP_LOGI(TAG, "  1. Verificar conexiones (TX->DIN, RX->DOUT)");
        ESP_LOGI(TAG, "  2. Apagar el transmisor XBee durante la configuración");
        ESP_LOGI(TAG, "  3. Verificar alimentación (3.3V)");
    }
}

void read_xbee_data(void) {
    if (!xbee_configured) {
        return;
    }
    
    uint8_t uart_data[XBEE_BUF_SIZE];
    int len = uart_read_bytes(XBEE_UART_PORT, uart_data, XBEE_BUF_SIZE - 1, pdMS_TO_TICKS(10));
    
    if (len > 0) {
        // Verificar si es una respuesta de comando
        if (len >= 2 && uart_data[0] == 'O' && uart_data[1] == 'K') {
            ESP_LOGD(TAG, "Ignorando respuesta OK del XBee");
            return;
        }
        
        // Acumular datos
        if (xbee_buffer_len + len < XBEE_BUF_SIZE - 1) {
            memcpy(xbee_buffer + xbee_buffer_len, uart_data, len);
            xbee_buffer_len += len;
        } else {
            xbee_buffer_len = 0;
            memset(xbee_buffer, 0, XBEE_BUF_SIZE);
        }
        
        // Procesar paquetes completos
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
        
        // Si quedan datos pero no son suficientes para un paquete completo,
        // y el buffer está casi lleno, limpiar para evitar acumulación
        if (xbee_buffer_len > 0 && xbee_buffer_len < sizeof(cansat_t) && 
            xbee_buffer_len > XBEE_BUF_SIZE - 100) {
            ESP_LOGW(TAG, "Buffer XBee casi lleno, limpiando");
            xbee_buffer_len = 0;
            memset(xbee_buffer, 0, XBEE_BUF_SIZE);
        }
    }
}

// ============================================
// LOOP PRINCIPAL
// ============================================

void app_main(void) {
    ESP_LOGI(TAG, "\n");
    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "GROUND STATION - RECEPTOR LoRa + XBee");
    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "Pines LoRa: TX=%d, RX=%d", LORA_TX_PIN, LORA_RX_PIN);
    ESP_LOGI(TAG, "Pines XBee: TX=%d, RX=%d", XBEE_TX_PIN, XBEE_RX_PIN);
    ESP_LOGI(TAG, "========================================\n");
    
    init_lora_receiver();
    init_xbee_receiver();
    
    memset(lora_buffer, 0, LORA_BUF_SIZE);
    memset(xbee_buffer, 0, XBEE_BUF_SIZE);
    lora_buffer_len = 0;
    xbee_buffer_len = 0;
    
    ESP_LOGI(TAG, "Esperando datos...\n");
    ESP_LOGI(TAG, "Formato: [PROTOCOLO]: temp,presion,altitud,ax,ay,az,gx,gy,gz,mx,my,mz,lat,lon\n");
    
    while (1) {
        read_lora_data();
        read_xbee_data();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}