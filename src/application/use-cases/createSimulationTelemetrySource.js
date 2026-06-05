function createSimulationTelemetrySource({ stepSeconds = 0.5, randomFn = Math.random } = {}) {
    let simTime = 0;

    function nextTelemetryInput() {
        simTime += stepSeconds;

        let altitude;
        let accelz;
        let speed;
        let latitude = 19.6;
        let longitude = -99.1;

        if (simTime < 10) {
            altitude = 100 * simTime;
            accelz = 1.5;
            speed = 3.6 * 100 / 10;
            latitude += simTime * 0.0001;
            longitude += simTime * 0.0001;
        } else if (simTime < 12) {
            altitude = 1000;
            accelz = 1.0;
            speed = 0;
            latitude += 10 * 0.0001;
            longitude += 10 * 0.0001;
        } else if (simTime <= 30) {
            altitude = 1000 - 50 * (simTime - 12);
            accelz = 1.0;
            speed = 3.6 * 50;
            latitude += (10 + (simTime - 12) * 0.00005);
            longitude += (10 + (simTime - 12) * 0.00005);
        } else {
            altitude = 0;
            accelz = 1.0;
            speed = 0;
            latitude += 10 * 0.0001;
            longitude += 10 * 0.0001;
        }

        const accelx = randomNumber(-0.1, 0.1);
        const accely = randomNumber(-0.1, 0.1);
        const gyrox = randomNumber(-10, 10);
        const gyroy = randomNumber(-10, 10);
        const gyroz = randomNumber(-10, 10);
        const magx = randomNumber(0, 360);
        const magy = randomNumber(-10, 10);
        const magz = randomNumber(-10, 10);

        return [
            speed,
            randomNumber(15, 35, true),
            randomNumber(95000, 105000, true),
            accelx,
            accely,
            accelz,
            gyrox,
            gyroy,
            gyroz,
            magx,
            magy,
            magz,
            altitude,
            latitude,
            longitude,
            simTime > 10 ? 'true' : 'false'
        ].join(',');
    }

    function reset() {
        simTime = 0;
    }

    function randomNumber(min, max, preserveString = false) {
        const value = (randomFn() * (max - min) + min).toFixed(2);
        return preserveString ? value : parseFloat(value);
    }

    return {
        nextTelemetryInput,
        reset
    };
}

module.exports = {
    createSimulationTelemetrySource
};
