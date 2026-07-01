#include <stdio.h>
#include <string.h>
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

#define SERIAL_UART_PORT          UART_NUM_0
#define SERIAL_BUF_SIZE           256

#define LORA_UART_PORT            UART_NUM_1
#define LORA_TX_PIN               GPIO_NUM_36
#define LORA_RX_PIN               GPIO_NUM_35
#define LORA_BUF_SIZE             512

#define XBEE_UART_PORT            UART_NUM_2
#define XBEE_TX_PIN               GPIO_NUM_38
#define XBEE_RX_PIN               GPIO_NUM_37
#define XBEE_BUF_SIZE             512

#define XBEE_CONFIG_ATTEMPTS      5
#define XBEE_CONFIG_DELAY_MS      2000

#define CANSAT_LORA_ADDRESS       0

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
static int  lora_buffer_len = 0;
static int  xbee_buffer_len = 0;

static char serial_buffer[SERIAL_BUF_SIZE];
static int  serial_buffer_len = 0;

static uint32_t lora_count  = 0;
static uint32_t xbee_count  = 0;
static int      xbee_configured = 0;

static bool mission_mode_sent = false;
static uint8_t xbee_sync_buffer[256];
static int     xbee_sync_len = 0;

// ============================================
// FUNCIONES AUXILIARES UART
// ============================================

static void uart_flush_rx(uart_port_t uart) {
    uint8_t tmp[64];
    int total = 0;
    int len;
    while ((len = uart_read_bytes(uart, tmp, sizeof(tmp), pdMS_TO_TICKS(10))) > 0) {
        total += len;
    }
    if (total > 0) {
        ESP_LOGD(TAG, "Flushed %d bytes from UART%d", total, (int)uart);
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
// IMPRIMIR DATOS EN FORMATO CSV (para Electron)
// ============================================
static void print_cansat_csv(cansat_t *data, const char *source) {
    float temp  = (float)data->temperature / 100.0f;
    float press = (float)data->pressure    / 1000.0f;
    float ax    = (float)data->accel[0]    / 1000.0f;
    float ay    = (float)data->accel[1]    / 1000.0f;
    float az    = (float)data->accel[2]    / 1000.0f;
    float gx    = (float)data->gyro[0]     / 1000.0f;
    float gy    = (float)data->gyro[1]     / 1000.0f;
    float gz    = (float)data->gyro[2]     / 1000.0f;
    float mx    = (float)data->mag[0]      / 10.0f;
    float my    = (float)data->mag[1]      / 10.0f;
    float mz    = (float)data->mag[2]      / 10.0f;
    float alt   = (float)data->altitude_gy;
    float lat   = (float)data->latitude    / 10000000.0f;
    float lon   = (float)data->longitude   / 10000000.0f;

    printf("%s,%lu,%.2f,%.2f,%.2f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.6f,%.6f\n",
           source, (unsigned long)data->timestamp,
           temp, press, alt, ax, ay, az, gx, gy, gz, mx, my, mz, lat, lon);
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
// VALIDACIÓN DE DATOS
// ============================================
static bool validate_cansat_data(cansat_t *data) {
    // Validar temperatura: -50°C a 85°C
    float temp = (float)data->temperature / 100.0f;
    if (temp < -50.0f || temp > 85.0f) {
        ESP_LOGW(TAG, "Datos corruptos - temperatura inválida: %.2f", temp);
        return false;
    }
    
    // Validar presión: 800-1100 hPa
    float pressure = (float)data->pressure / 1000.0f;
    if (pressure < 800.0f || pressure > 1100.0f) {
        // Durante el lanzamiento la presión puede ser menor, pero no absurdamente baja
        if (pressure > 10.0f && pressure < 800.0f) {
            // Permitir presión baja durante ascenso
            return true;
        }
        ESP_LOGW(TAG, "Datos corruptos - presión inválida: %.2f", pressure);
        return false;
    }
    
    // Validar altitud: -100 a 10000m
    if (data->altitude_gy < -100 || data->altitude_gy > 10000) {
        ESP_LOGW(TAG, "Datos corruptos - altitud inválida: %d", data->altitude_gy);
        return false;
    }
    
    // Validar aceleración: no debería superar ±16g
    for (int i = 0; i < 3; i++) {
        float accel = (float)data->accel[i] / 1000.0f;
        if (accel < -20.0f || accel > 20.0f) {
            ESP_LOGW(TAG, "Datos corruptos - aceleración inválida en eje %d: %.3f", i, accel);
            return false;
        }
    }
    
    return true;
}

// ============================================
// PROCESAR PAYLOAD LORA (formato hex)
// ============================================
static void process_lora_payload(const char *payload_hex) {
    uint8_t raw_data[sizeof(cansat_t)];
    int len;
    
    // Intentar hex primero
    len = hex_to_bytes(payload_hex, raw_data, sizeof(cansat_t));
    
    // Si falla, intentar binario directo
    if (len != sizeof(cansat_t)) {
        // Asumir que payload_hex son bytes binarios
        len = strlen(payload_hex);
        if (len == sizeof(cansat_t)) {
            memcpy(raw_data, payload_hex, len);
        } else {
            ESP_LOGW(TAG, "Payload LoRa inválido: longitud %d, esperaba %d", 
                     len, (int)sizeof(cansat_t));
            return;
        }
    }

    // Procesar datos
    cansat_t *data = (cansat_t *)raw_data;
    if (validate_cansat_data(data)) {
        lora_count++;
        print_cansat_csv(data, "LORA");
    }
}

// ============================================
// PROCESAR PAYLOAD XBEE (binario directo) - CORREGIDO
// ============================================
static void process_xbee_payload(uint8_t *data, int len) {
    if (len >= 2 && (data[0] == 'O' && data[1] == 'K')) {
        ESP_LOGD(TAG, "Ignorando respuesta OK del XBee");
        return;
    }

    // Ignorar comandos AT (empiezan con 'A' y 'T')
    if (len >= 2 && data[0] == 'A' && data[1] == 'T') {
        ESP_LOGD(TAG, "Ignorando comando AT del XBee");
        return;
    }

    if (len == (int)sizeof(cansat_t)) {
        cansat_t *cansat_data = (cansat_t *)data;
        if (validate_cansat_data(cansat_data)) {
            xbee_count++;
            print_cansat_csv(cansat_data, "XBEE");
        }
    } else {
        ESP_LOGW(TAG, "XBee payload inválido (%d bytes, esperaba %d)",
                 len, (int)sizeof(cansat_t));
    }
}

// ============================================
// FUNCIONES LORA (RECEPTOR + TRANSMISOR DE COMANDOS)
// ============================================

static void lora_send_command(const char *cmd) {
    uart_write_bytes(LORA_UART_PORT, cmd, strlen(cmd));
    uart_write_bytes(LORA_UART_PORT, "\r\n", 2);
}

void init_lora_receiver(void) {
    ESP_LOGI(TAG, "Inicializando LoRa receptor...");

    uart_config_t uart_config = {
        .baud_rate  = 115200,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
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

    lora_send_command("AT+ADDRESS=1");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+NETWORKID=18");
    uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    vTaskDelay(pdMS_TO_TICKS(100));

    lora_send_command("AT+RX");
    vTaskDelay(pdMS_TO_TICKS(100));

    ESP_LOGI(TAG, "LoRa receptor listo (ADDRESS=1)");
}

static void lora_send_mission_on(void) {
    const char *payload = "MISSION_ON";
    char cmd[128];
    snprintf(cmd, sizeof(cmd), "AT+SEND=%d,%d,%s\r\n",
             CANSAT_LORA_ADDRESS, (int)strlen(payload), payload);

    uart_write_bytes(LORA_UART_PORT, cmd, strlen(cmd));

    bool ok = uart_wait_response(LORA_UART_PORT, "+OK", 1000);
    if (ok) {
        ESP_LOGI(TAG, "MISSION_ON enviado al CanSat correctamente");
    } else {
        ESP_LOGW(TAG, "No se recibió +OK al enviar MISSION_ON");
    }

    lora_send_command("AT+RX");
    vTaskDelay(pdMS_TO_TICKS(100));
}

void read_lora_data(void) {
    uint8_t uart_data[LORA_BUF_SIZE];
    int len = uart_read_bytes(LORA_UART_PORT, uart_data, LORA_BUF_SIZE - 1, pdMS_TO_TICKS(10));

    if (len <= 0) return;

    uart_data[len] = '\0';

    if (strstr((char*)uart_data, "+OK") != NULL ||
        strstr((char*)uart_data, "+ERR") != NULL ||
        strstr((char*)uart_data, "AT+") != NULL) {
        ESP_LOGD(TAG, "Ignorando respuesta AT del LoRa");
        return;
    }

    if (lora_buffer_len + len < LORA_BUF_SIZE - 1) {
        memcpy(lora_buffer + lora_buffer_len, uart_data, len);
        lora_buffer_len += len;
        lora_buffer[lora_buffer_len] = '\0';
    } else {
        lora_buffer_len = 0;
        lora_buffer[0] = '\0';
    }

    bool processed = false;
    char *rcv = strstr(lora_buffer, "+RCV=");
    while (rcv != NULL) {
        char *end = strstr(rcv, "\r\n");
        if (end == NULL) break;

        *end = '\0';

        int addr, length, rssi, snr;
        char payload[256] = {0};

        int parsed = sscanf(rcv, "+RCV=%d,%d,%[^,],%d,%d",
                            &addr, &length, payload, &rssi, &snr);

        if (parsed >= 3 && length == sizeof(cansat_t) * 2) {
            process_lora_payload(payload);
            processed = true;
        } else {
            ESP_LOGW(TAG, "Payload LoRa inválido: longitud %d, esperaba %d", 
                     length, (int)sizeof(cansat_t) * 2);
        }

        char *next = end + 2;
        int remaining = lora_buffer_len - (int)(next - lora_buffer);
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

    if (processed) {
        lora_send_command("AT+RX");
    }
}

// ============================================
// FUNCIONES XBEE (RECEPTOR) - CORREGIDO
// ============================================

static void xbee_send_command(const char *cmd) {
    uart_write_bytes(XBEE_UART_PORT, cmd, strlen(cmd));
}

static bool xbee_enter_command_mode(void) {
    ESP_LOGI(TAG, "Enviando +++ para entrar a modo comando...");
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
    uart_flush_rx(XBEE_UART_PORT);

    xbee_send_command("AT\r");
    vTaskDelay(pdMS_TO_TICKS(500));

    uint8_t test_buf[32];
    int len = uart_read_bytes(XBEE_UART_PORT, test_buf, sizeof(test_buf) - 1, pdMS_TO_TICKS(200));

    if (len > 0) {
        test_buf[len] = '\0';
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
    uart_flush_rx(XBEE_UART_PORT);

    if (!xbee_enter_command_mode()) {
        ESP_LOGE(TAG, "No se pudo entrar a modo comando");
        return false;
    }

    xbee_soft_reset();

    vTaskDelay(pdMS_TO_TICKS(1000));
    if (!xbee_enter_command_mode()) {
        ESP_LOGE(TAG, "No se pudo re-entrar a modo comando después del reset");
        return false;
    }

    xbee_send_command("ATRE\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATRE"); xbee_exit_command_mode(); return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));

    xbee_send_command("ATID CAFE\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATID"); xbee_exit_command_mode(); return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));

    xbee_send_command("ATCH 0C\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATCH"); xbee_exit_command_mode(); return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));

    xbee_send_command("ATMY 0\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATMY"); xbee_exit_command_mode(); return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));

    xbee_send_command("ATCE 1\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 1000)) {
        ESP_LOGE(TAG, "Fallo ATCE"); xbee_exit_command_mode(); return false;
    }
    vTaskDelay(pdMS_TO_TICKS(100));

    xbee_send_command("ATWR\r");
    if (!uart_wait_response(XBEE_UART_PORT, "OK", 2000)) {
        ESP_LOGE(TAG, "Fallo ATWR"); xbee_exit_command_mode(); return false;
    }
    vTaskDelay(pdMS_TO_TICKS(200));

    xbee_exit_command_mode();

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
        .baud_rate  = 9600,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(XBEE_UART_PORT, XBEE_BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(XBEE_UART_PORT, &uart_config));
    ESP_ERROR_CHECK(uart_set_pin(XBEE_UART_PORT, XBEE_TX_PIN, XBEE_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    vTaskDelay(pdMS_TO_TICKS(1000));
    uart_flush_rx(XBEE_UART_PORT);

    // ⭐⭐⭐ NUEVO: NO configurar el XBee, solo asumir que está en modo transparente ⭐⭐⭐
    ESP_LOGI(TAG, "XBee receptor en modo transparente (sin configuración)");
    xbee_configured = 1;  // Forzar como configurado
    
    /*
    // COMENTAR TODA ESTA PARTE:
    for (int attempt = 1; attempt <= XBEE_CONFIG_ATTEMPTS; attempt++) {
        ESP_LOGI(TAG, "=== Intento de configuración XBee %d/%d ===", attempt, XBEE_CONFIG_ATTEMPTS);
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
    */

    if (xbee_configured) {
        ESP_LOGI(TAG, "XBee receptor listo y en modo transparente");
    } else {
        ESP_LOGE(TAG, "No se pudo configurar XBee después de %d intentos", XBEE_CONFIG_ATTEMPTS);
        ESP_LOGI(TAG, "Verificar conexiones (TX->DIN, RX->DOUT) y alimentación (3.3V)");
    }
}

static void read_xbee_data(void) {
    if (!xbee_configured) return;
    
    uint8_t uart_data[64];
    int len = uart_read_bytes(XBEE_UART_PORT, uart_data, sizeof(uart_data), pdMS_TO_TICKS(10));

    if (len > 0) {
        for (int i = 0; i < len && xbee_sync_len < sizeof(xbee_sync_buffer); i++) {
            xbee_sync_buffer[xbee_sync_len++] = uart_data[i];
        }
        
        while (xbee_sync_len >= sizeof(cansat_t)) {
            cansat_t *test = (cansat_t*)xbee_sync_buffer;
            
            if (validate_cansat_data(test)) {
                process_xbee_payload((uint8_t*)test, sizeof(cansat_t));
                memmove(xbee_sync_buffer, xbee_sync_buffer + sizeof(cansat_t), 
                        xbee_sync_len - sizeof(cansat_t));
                xbee_sync_len -= sizeof(cansat_t);
            } else {
                memmove(xbee_sync_buffer, xbee_sync_buffer + 1, xbee_sync_len - 1);
                xbee_sync_len--;
            }
        }
    }
}

// ============================================
// INICIALIZAR UART SERIAL (USB / Electron) - CORREGIDO
// ============================================
void init_serial_uart(void) {
    uart_config_t uart_config = {
        .baud_rate  = 115200,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    // INSTALAR el driver de UART0 (necesario para ESP32-S3)
    ESP_ERROR_CHECK(uart_driver_install(SERIAL_UART_PORT, SERIAL_BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(SERIAL_UART_PORT, &uart_config));
    // No cambiar pines para UART0 (usar los predeterminados)
    ESP_ERROR_CHECK(uart_set_pin(SERIAL_UART_PORT, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    ESP_LOGI(TAG, "UART Serial listo para recibir comandos de Electron");
}

// ============================================
// LEER COMANDOS DESDE ELECTRON (UART0 / USB)
// ============================================

static bool read_serial_command(void) {
    uint8_t uart_data[SERIAL_BUF_SIZE];
    int len = uart_read_bytes(SERIAL_UART_PORT, uart_data, SERIAL_BUF_SIZE - 1, pdMS_TO_TICKS(5));

    if (len <= 0) return false;

    if (serial_buffer_len + len < SERIAL_BUF_SIZE - 1) {
        memcpy(serial_buffer + serial_buffer_len, uart_data, len);
        serial_buffer_len += len;
        serial_buffer[serial_buffer_len] = '\0';
    } else {
        serial_buffer_len = 0;
        serial_buffer[0]  = '\0';
        return false;
    }

    bool mission_received = false;
    char *start = serial_buffer;

    while (1) {
        char *end = strchr(start, '\n');
        if (!end) break;

        *end = '\0';

        int line_len = (int)(end - start);
        if (line_len > 0 && start[line_len - 1] == '\r') {
            start[line_len - 1] = '\0';
        }

        // Ignorar líneas vacías
        if (strlen(start) > 0) {
            ESP_LOGI(TAG, "Comando recibido de Electron: '%s'", start);
        }

        if (strcmp(start, "MISSION_ON") == 0) {
            mission_received = true;
        }

        start = end + 1;
    }

    int remaining = serial_buffer_len - (int)(start - serial_buffer);
    if (remaining > 0) {
        memmove(serial_buffer, start, remaining);
        serial_buffer_len = remaining;
        serial_buffer[serial_buffer_len] = '\0';
    } else {
        serial_buffer_len = 0;
        serial_buffer[0]  = '\0';
    }

    return mission_received;
}

// ============================================
// LOOP PRINCIPAL
// ============================================

void app_main(void) {
    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, " GROUND STATION - Receptor LoRa + XBee");
    ESP_LOGI(TAG, "========================================");
    ESP_LOGI(TAG, "Pines LoRa: TX=%d, RX=%d", LORA_TX_PIN, LORA_RX_PIN);
    ESP_LOGI(TAG, "Pines XBee: TX=%d, RX=%d", XBEE_TX_PIN, XBEE_RX_PIN);
    ESP_LOGI(TAG, "Comandos desde Electron: UART0 (USB)");
    ESP_LOGI(TAG, "========================================");

    init_lora_receiver();
    init_xbee_receiver();
    init_serial_uart();

    memset(lora_buffer,   0, LORA_BUF_SIZE);
    memset(xbee_buffer,   0, XBEE_BUF_SIZE);
    memset(serial_buffer, 0, SERIAL_BUF_SIZE);
    lora_buffer_len   = 0;
    xbee_buffer_len   = 0;
    serial_buffer_len = 0;
    mission_mode_sent = false;

    ESP_LOGI(TAG, "Esperando datos...");
    ESP_LOGI(TAG, "Formato CSV: [PROTO],timestamp,temp,presion,altitud,ax,ay,az,gx,gy,gz,mx,my,mz,lat,lon");
    ESP_LOGI(TAG, "Para activar Modo Mision: enviar 'MISSION_ON\\n' por UART0");

    while (1) {
        read_lora_data();
        read_xbee_data();

        if (!mission_mode_sent) {
            bool mission_requested = read_serial_command();

            if (mission_requested) {
                ESP_LOGI(TAG, ">>> MISSION_ON recibido de Electron. Reenviando al CanSat por LoRa...");
                lora_send_mission_on();
                mission_mode_sent = true;

                printf("MISSION_ON_ACK\n");
                fflush(stdout);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}