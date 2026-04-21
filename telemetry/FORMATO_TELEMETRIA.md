# Formato final de telemetria para la estacion terrena

La estacion terrena de escritorio y la terrena web ya estan preparadas para recibir lineas etiquetadas desde el ESP receptor por un solo puerto serial.

## Formato unificado recomendado

Cada receptor debe imprimir una unica linea por muestra usando este formato:

```text
[LORA] PRES:1013,TEMP:24.5,HUM:60.1,SPEED:3.2,ACCX:12,ACCY:-3,ACCZ:102,GYROX:1,GYROY:0,GYROZ:-1,MAGX:14,MAGY:-2,MAGZ:3,ALT:128,LAT:20.967370,LON:-89.623710,DECOUP:0,RXLAT:20.967100,RXLON:-89.623400,DIST:35.42
```

o bien:

```text
[XBEE] PRES:1013,TEMP:24.5,HUM:60.1,SPEED:3.2,ACCX:12,ACCY:-3,ACCZ:102,GYROX:1,GYROY:0,GYROZ:-1,MAGX:14,MAGY:-2,MAGZ:3,ALT:128,LAT:20.967370,LON:-89.623710,DECOUP:0,RXLAT:20.967100,RXLON:-89.623400,DIST:35.42
```

## Campos soportados por la terrena

- `PRES`: presion
- `TEMP`: temperatura
- `HUM`: humedad
- `SPEED`: velocidad del viento u otra magnitud equivalente del payload
- `ACCX`, `ACCY`, `ACCZ`: acelerometro
- `GYROX`, `GYROY`, `GYROZ`: giroscopio
- `MAGX`, `MAGY`, `MAGZ`: magnetometro
- `ALT`: altitud
- `LAT`, `LON`: coordenadas del transmisor
- `DECOUP`: estado de desacople
- `RXLAT`, `RXLON`: coordenadas del receptor
- `DIST`: distancia entre receptor y transmisor

## Estado actual del repositorio

- `LoRaReceptor.c` ya fue adaptado para emitir el formato unificado hacia la estacion terrena.
- `XbeeReceptor.c` ya fue adaptado para emitir el formato unificado hacia la estacion terrena.
- El parser de la estacion terrena y sus pruebas ya aceptan este formato.

## Observacion sobre transmisores

En este repositorio solo existe `LoRaTransmisor.c`. No se incluyo un transmisor XBee equivalente. Por lo tanto, se asume que el transmisor XBee debera enviar el mismo payload base que espera `XbeeReceptor.c`, para que ambos receptores produzcan la misma salida final hacia la terrena.

## Regla de compatibilidad futura

Si en el futuro se agregan mas magnitudes, se recomienda mantener este mismo esquema de `CLAVE:VALOR` y solo anadir nuevas etiquetas. La estacion terrena puede procesar telemetria parcial sin romper compatibilidad.
