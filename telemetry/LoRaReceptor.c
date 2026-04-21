#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include <inttypes.h>

static const char *TAG = "LORA_RX_CANSAT";

// ==================== DEFINICIONES ====================
typedef struct {
    uint16_t pressure;
    int16_t  temperature;
    int16_t  humidity;
    int16_t  speed;
    int16_t  accel[3];
    int16_t  gyro[3];
    int16_t  mag[3];
    int16_t  altitude;
    int32_t  latitude;
    int32_t  longitude;
    bool     decoupling;
} cansat_t;

// PINES
#define GPS_UART    UART_NUM_2
#define GPS_TX_PIN  GPIO_NUM_26
#define GPS_RX_PIN  GPIO_NUM_25

#define LORA_UART   UART_NUM_1
#define LORA_TX_PIN GPIO_NUM_17
#define LORA_RX_PIN GPIO_NUM_16

#define BUF_SIZE    512

// Buffers
static char gps_buffer[BUF_SIZE];
static char lora_buffer[BUF_SIZE];
static uint8_t uart_data[BUF_SIZE];

static bool extract_i32_tag(const char *payload, const char *key, int32_t *value) {
    char pattern[32];
    snprintf(pattern, sizeof(pattern), "%s=", key);
    char *ptr = strstr(payload, pattern);
    if (!ptr) return false;
    return sscanf(ptr + strlen(pattern), "%" SCNd32, value) == 1;
}

static bool extract_i16_tag(const char *payload, const char *key, int16_t *value) {
    int parsed = 0;
    char pattern[32];
    snprintf(pattern, sizeof(pattern), "%s=", key);
    char *ptr = strstr(payload, pattern);
    if (!ptr) return false;
    if (sscanf(ptr + strlen(pattern), "%d", &parsed) != 1) return false;
    *value = (int16_t)parsed;
    return true;
}

static void emit_ground_station_packet(const char *source, const cansat_t *data, double rx_lat, double rx_lon, bool has_rx_gps, double distance_to_rx) {
    char line[512];
    int written = snprintf(
        line,
        sizeof(line),
        "[%s] PRES:%u,TEMP:%.1f,HUM:%.1f,SPEED:%.1f,ACCX:%d,ACCY:%d,ACCZ:%d,GYROX:%d,GYROY:%d,GYROZ:%d,MAGX:%d,MAGY:%d,MAGZ:%d,ALT:%d,LAT:%.6f,LON:%.6f,DECOUP:%d",
        source,
        data->pressure,
        data->temperature / 10.0f,
        data->humidity / 10.0f,
        data->speed / 10.0f,
        data->accel[0], data->accel[1], data->accel[2],
        data->gyro[0], data->gyro[1], data->gyro[2],
        data->mag[0], data->mag[1], data->mag[2],
        data->altitude,
        data->latitude / 10000000.0,
        data->longitude / 10000000.0,
        data->decoupling ? 1 : 0
    );

    if (has_rx_gps && written > 0 && written < (int)sizeof(line)) {
        snprintf(
            line + written,
            sizeof(line) - (size_t)written,
            ",RXLAT:%.6f,RXLON:%.6f,DIST:%.2f",
            rx_lat,
            rx_lon,
            distance_to_rx
        );
    }

    printf("%s\n", line);
}

// ==================== HAVERSINE ====================
static double haversine(double lat1, double lon1, double lat2, double lon2) {
    double dlat = (lat2 - lat1) * M_PI / 180.0;
    double dlon = (lon2 - lon1) * M_PI / 180.0;
    lat1 *= M_PI / 180.0;
    lat2 *= M_PI / 180.0;
    double a = sin(dlat/2)*sin(dlat/2) + cos(lat1)*cos(lat2)*sin(dlon/2)*sin(dlon/2);
    return 6371000.0 * 2.0 * atan2(sqrt(a), sqrt(1.0 - a));
}

// ==================== GPS PARSER ====================
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

// ==================== LORA INIT ====================
static void lora_send_command(const char *cmd) {
    uart_write_bytes(LORA_UART, cmd, strlen(cmd));
    uart_write_bytes(LORA_UART, "\r\n", 2);
}

static void lora_init(void) {
    ESP_LOGI(TAG, "Inicializando RYLR998 LoRa (Receptor)...");
    
    vTaskDelay(pdMS_TO_TICKS(1000));
    
    lora_send_command("AT+RESET");
    vTaskDelay(pdMS_TO_TICKS(1000));
    
    lora_send_command("AT+BAND=869500000");
    vTaskDelay(pdMS_TO_TICKS(100));
    
    lora_send_command("AT+CRFOP=12");
    vTaskDelay(pdMS_TO_TICKS(100));
    
    lora_send_command("AT+PARAMETER=9,7,1,12");
    vTaskDelay(pdMS_TO_TICKS(100));
    
    lora_send_command("AT+ADDRESS=1");
    vTaskDelay(pdMS_TO_TICKS(100));
    
    lora_send_command("AT+NETWORKID=18");
    vTaskDelay(pdMS_TO_TICKS(100));
    
    ESP_LOGI(TAG, "LoRa receptor configurado correctamente");
}

// ==================== PARSER PAYLOAD ====================
static bool parse_cansat_payload(const char *payload, cansat_t *data) {
    memset(data, 0, sizeof(*data));

    char *lat_ptr = strstr(payload, "Lat=");
    char *lon_ptr = strstr(payload, "Lon=");
    if (lat_ptr && lon_ptr) {
        data->latitude = atoi(lat_ptr + 4);
        data->longitude = atoi(lon_ptr + 4);
    }

    int parsed = sscanf(payload,
        "P=%hu,T=%hd,"
        "Ax=%hd,Ay=%hd,Az=%hd,"
        "Gx=%hd,Gy=%hd,Gz=%hd,"
        "Mx=%hd,My=%hd,Mz=%hd,"
        "Alt=%hd",
        &data->pressure,
        &data->temperature,
        &data->accel[0], &data->accel[1], &data->accel[2],
        &data->gyro[0], &data->gyro[1], &data->gyro[2],
        &data->mag[0], &data->mag[1], &data->mag[2],
        &data->altitude
    );

    if (parsed != 12) {
        if (data->latitude != 0 || data->longitude != 0) {
            return true;
        }
        ESP_LOGW(TAG, "Campos base parseados: %d", parsed);
        return false;
    }

    if (!lat_ptr || !lon_ptr) {
        ESP_LOGW(TAG, "No se encontraron Lat/Lon");
        return false;
    }

    extract_i16_tag(payload, "H", &data->humidity);
    extract_i16_tag(payload, "Hum", &data->humidity);
    extract_i16_tag(payload, "Speed", &data->speed);
    extract_i16_tag(payload, "V", &data->speed);

    int32_t decoupling = 0;
    if (extract_i32_tag(payload, "Dec", &decoupling) || extract_i32_tag(payload, "Decoup", &decoupling) || extract_i32_tag(payload, "Relay", &decoupling)) {
        data->decoupling = decoupling != 0;
    }

    return true;
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
    
    ESP_ERROR_CHECK(uart_driver_install(GPS_UART, BUF_SIZE * 2, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(GPS_UART, &gps_cfg));
    ESP_ERROR_CHECK(uart_set_pin(GPS_UART, GPS_TX_PIN, GPS_RX_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    // --- UART LoRa ---
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

    ESP_LOGI(TAG, "=== RECEPTOR CANSAT (LoRa) INICIADO ===");

    memset(gps_buffer, 0, BUF_SIZE);
    memset(lora_buffer, 0, BUF_SIZE);
    
    int gps_len = 0;
    int lora_len = 0;
    
    double rx_lat = 0, rx_lon = 0;
    bool has_rx_gps = false;
    
    cansat_t telemetry_rx = {0};
    int packet_count = 0;

    while (1) {
        // --- LEER GPS LOCAL ---
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
                    if (parse_gpgga(start, &rx_lat, &rx_lon)) {
                        has_rx_gps = true;
                        ESP_LOGI(TAG, "GPS Local: %.6f, %.6f", rx_lat, rx_lon);
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
        
        // --- LEER LORA ---
        len = uart_read_bytes(LORA_UART, uart_data, BUF_SIZE - 1, pdMS_TO_TICKS(50));
        if (len > 0) {
            uart_data[len] = '\0';
            
            if (lora_len + len < BUF_SIZE - 1) {
                strcat(lora_buffer, (char*)uart_data);
                lora_len += len;
            } else {
                lora_len = 0;
                memset(lora_buffer, 0, BUF_SIZE);
            }
            
            // Buscar mensajes +RCV completos
            char *rcv = strstr(lora_buffer, "+RCV=");
            while (rcv != NULL) {
                char *end = strstr(rcv, "\r\n");
                if (end == NULL) break;
                
                *end = '\0';
                
            int addr, length, rssi, snr;
			char payload[256] = {0};
			
			if (sscanf(rcv, "+RCV=%d,%d,", &addr, &length) == 2) {
			
			    char *first_comma = strchr(rcv, ',');
			    char *second_comma = first_comma ? strchr(first_comma + 1, ',') : NULL;
			
			    if (second_comma && length > 0 && length < sizeof(payload)) {
			        char *payload_start = second_comma + 1;
			
			        memcpy(payload, payload_start, length);
			        payload[length] = '\0';
			
			        char *meta = payload_start + length;
			
			        if (sscanf(meta, ",%d,%d", &rssi, &snr) == 2) {
			            packet_count++;
			
			            if (parse_cansat_payload(payload, &telemetry_rx)) {
			                ESP_LOGI(TAG, "RSSI=%d dBm SNR=%d", rssi, snr);
			                ESP_LOGI(TAG, "========================================");
	                        ESP_LOGI(TAG, "Paquete #%d desde addr=%d", packet_count, addr);
	                        ESP_LOGI(TAG, "Presion: %u hPa", telemetry_rx.pressure);
	                        ESP_LOGI(TAG, "Temperatura: %.1f grad/C", telemetry_rx.temperature / 10.0f);
	                        ESP_LOGI(TAG, "Acelerometro: X=%d Y=%d Z=%d", 
	                                 telemetry_rx.accel[0], telemetry_rx.accel[1], telemetry_rx.accel[2]);
	                        ESP_LOGI(TAG, "Giroscopio: X=%d Y=%d Z=%d",
	                                 telemetry_rx.gyro[0], telemetry_rx.gyro[1], telemetry_rx.gyro[2]);
	                        ESP_LOGI(TAG, "Magnetometro: X=%d Y=%d Z=%d",
	                                 telemetry_rx.mag[0], telemetry_rx.mag[1], telemetry_rx.mag[2]);
	                        ESP_LOGI(TAG, "Altitud: %d m", telemetry_rx.altitude);
	                        
	                        // Convertir coordenadas (escala 1e7)
	                        double tx_lat = telemetry_rx.latitude / 10000000.0;
	                        double tx_lon = telemetry_rx.longitude / 10000000.0;
	                        ESP_LOGI(TAG, "GPS TX: %.6f, %.6f", tx_lat, tx_lon);
	                        
	                        if (has_rx_gps) {
	                            double dist = haversine(tx_lat, tx_lon, rx_lat, rx_lon);
	                            ESP_LOGI(TAG, "DISTANCIA: %.2f metros", dist);
	                            emit_ground_station_packet("LORA", &telemetry_rx, rx_lat, rx_lon, true, dist);
	                        } else {
	                            ESP_LOGI(TAG, "GPS Local: (sin senal)");
	                            emit_ground_station_packet("LORA", &telemetry_rx, 0, 0, false, 0);
	                        }
                        ESP_LOGI(TAG, "========================================");
			            } else {
			                ESP_LOGW(TAG, "Error al parsear payload: %s", payload);
			            }
			        }
			    }
			}
                
                // Mover al siguiente mensaje
                char *next = end + 2;
                int remaining = lora_len - (next - lora_buffer);
                if (remaining > 0) {
                    memmove(lora_buffer, next, remaining);
                    lora_len = remaining;
                    lora_buffer[lora_len] = '\0';
                } else {
                    lora_buffer[0] = '\0';
                    lora_len = 0;
                }
                
                rcv = strstr(lora_buffer, "+RCV=");
            }
        }
        
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
