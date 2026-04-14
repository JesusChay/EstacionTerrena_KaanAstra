#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_log.h"

static const char *TAG = "XBEE_RX";

// UARTS
#define GPS_UART    UART_NUM_2
#define GPS_TX_PIN  26
#define GPS_RX_PIN  25

#define XBEE_UART   UART_NUM_1
#define TX_PIN      14
#define RX_PIN      13

#define BUF_SIZE    512

static char gps_buffer[BUF_SIZE];
static uint8_t uart_data[BUF_SIZE];

// -------- DISTANCIA --------
double haversine(double lat1,double lon1,double lat2,double lon2){
    double dlat=(lat2-lat1)*M_PI/180;
    double dlon=(lon2-lon1)*M_PI/180;
    lat1*=M_PI/180; lat2*=M_PI/180;
    double a=sin(dlat/2)*sin(dlat/2)+cos(lat1)*cos(lat2)*sin(dlon/2)*sin(dlon/2);
    return 6371000*2*atan2(sqrt(a),sqrt(1-a));
}

// -------- GPS --------
bool parse_gpgga(const char *sentence,double *lat,double *lon){
    if (!strstr(sentence,"$GPGGA")) return false;

    char copy[128];
    strncpy(copy,sentence,sizeof(copy)-1);

    char *tokens[15];
    int i=0;
    char *p=strtok(copy,",");
    while(p && i<15) tokens[i++]=p,p=strtok(NULL,",");

    if(i<10 || atoi(tokens[6])==0) return false;

    *lat=atof(tokens[2]);
    *lon=atof(tokens[4]);

    int d=(int)(*lat/100);
    *lat=d+(*lat-d*100)/60.0;
    if(tokens[3][0]=='S') *lat=-*lat;

    d=(int)(*lon/100);
    *lon=d+(*lon-d*100)/60.0;
    if(tokens[5][0]=='W') *lon=-*lon;

    return true;
}

// -------- XBEE CONFIG --------
void flush_uart(){ uart_flush_input(XBEE_UART); }

bool wait_ok(int timeout_ms){
    uint8_t buf[100];
    int len=uart_read_bytes(XBEE_UART,buf,sizeof(buf)-1,pdMS_TO_TICKS(timeout_ms));
    if(len>0){
        buf[len]=0;
        return strstr((char*)buf,"OK")!=NULL;
    }
    return false;
}

bool send_cmd(const char *cmd){
    flush_uart();
    uart_write_bytes(XBEE_UART,cmd,strlen(cmd));
    return wait_ok(800);
}

bool enter_cmd_mode(){
    vTaskDelay(pdMS_TO_TICKS(1200));
    flush_uart();
    uart_write_bytes(XBEE_UART,"+++",3);
    vTaskDelay(pdMS_TO_TICKS(1200));
    return wait_ok(1000);
}

// -------- MAIN --------
void app_main(void){

    // GPS
    uart_config_t gps_cfg={
        .baud_rate=9600,
        .data_bits=UART_DATA_8_BITS,
        .parity=UART_PARITY_DISABLE,
        .stop_bits=UART_STOP_BITS_1,
        .flow_ctrl=UART_HW_FLOWCTRL_DISABLE
    };
    uart_driver_install(GPS_UART,BUF_SIZE*2,0,0,NULL,0);
    uart_param_config(GPS_UART,&gps_cfg);
    uart_set_pin(GPS_UART,GPS_TX_PIN,GPS_RX_PIN,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE);

    // XBEE
    uart_config_t xbee_cfg={
        .baud_rate=9600,
        .data_bits=UART_DATA_8_BITS,
        .parity=UART_PARITY_DISABLE,
        .stop_bits=UART_STOP_BITS_1,
        .flow_ctrl=UART_HW_FLOWCTRL_DISABLE
    };
    uart_driver_install(XBEE_UART,BUF_SIZE*2,0,0,NULL,0);
    uart_param_config(XBEE_UART,&xbee_cfg);
    uart_set_pin(XBEE_UART,TX_PIN,RX_PIN,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE);

    ESP_LOGI(TAG,"=== XBEE RX GPS ===");

    if(enter_cmd_mode()){
        send_cmd("ATAP 0\r");
        send_cmd("ATRE\r");
        send_cmd("ATID CAFE\r");
        send_cmd("ATCH 0C\r");
        send_cmd("ATMY 0\r");
        send_cmd("ATCE 1\r");
        send_cmd("ATPL 0\r");
        send_cmd("ATWR\r");
        send_cmd("ATCN\r");
    }

    double rx_lat=0,rx_lon=0;
    double tx_lat=0,tx_lon=0;
    bool has_gps=false;
	static int gps_len = 0;

    while(1){

        // GPS LOCAL
		int len = uart_read_bytes(GPS_UART, uart_data, BUF_SIZE-1, 50);
		if (len > 0) {
		    memcpy(gps_buffer + gps_len, uart_data, len);
		    gps_len += len;
		    gps_buffer[gps_len] = 0;
		
		    char *start = gps_buffer;
		    char *end;
		
		    while ((end = strstr(start, "\r\n"))) {
		        *end = 0;
		
		        if (parse_gpgga(start, &rx_lat, &rx_lon)) {
		            has_gps = true;
		            ESP_LOGI(TAG, "GPS RX: %.6f, %.6f", rx_lat, rx_lon);
		        }
		
		        start = end + 2;
		    }
		
		    gps_len = strlen(start);
		    memmove(gps_buffer, start, gps_len);
		}

        // XBEE
        len=uart_read_bytes(XBEE_UART,uart_data,BUF_SIZE-1,50);
        if(len>0){
            uart_data[len]=0;

            if(sscanf((char*)uart_data,"LAT:%lf,LON:%lf",&tx_lat,&tx_lon)==2){
                if(has_gps){
                    double d=haversine(tx_lat,tx_lon,rx_lat,rx_lon);

                    ESP_LOGI(TAG,"TX:%.6f,%.6f | RX:%.6f,%.6f | D=%.2fm",
                        tx_lat,tx_lon,rx_lat,rx_lon,d);
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}