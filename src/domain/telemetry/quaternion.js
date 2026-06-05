class Quaternion {
    constructor(w, x, y, z) {
        this.w = w;
        this.x = x;
        this.y = y;
        this.z = z;
    }

    multiply(q) {
        return new Quaternion(
            this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
            this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
            this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
            this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w
        );
    }

    normalize() {
        const magnitude = Math.sqrt(this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z);
        if (magnitude < 1e-6) {
            return new Quaternion(1, 0, 0, 0);
        }

        return new Quaternion(this.w / magnitude, this.x / magnitude, this.y / magnitude, this.z / magnitude);
    }

    rotateVector(vector) {
        if (vector.some(Number.isNaN)) {
            return [0, 0, 0];
        }

        const quaternionVector = new Quaternion(0, vector[0], vector[1], vector[2]);
        const conjugate = new Quaternion(this.w, -this.x, -this.y, -this.z);
        const result = this.multiply(quaternionVector).multiply(conjugate);
        return [result.x, result.y, result.z];
    }

    update(gyrox, gyroy, gyroz, deltaTimeSeconds) {
        if (Number.isNaN(gyrox) || Number.isNaN(gyroy) || Number.isNaN(gyroz) || Number.isNaN(deltaTimeSeconds)) {
            return this;
        }

        const wx = gyrox * Math.PI / 180;
        const wy = gyroy * Math.PI / 180;
        const wz = gyroz * Math.PI / 180;
        const halfDeltaTime = deltaTimeSeconds / 2;
        const deltaQ = new Quaternion(1, wx * halfDeltaTime, wy * halfDeltaTime, wz * halfDeltaTime).normalize();

        return this.multiply(deltaQ).normalize();
    }

    correctYaw(yawDegrees) {
        if (Number.isNaN(yawDegrees) || yawDegrees < 0 || yawDegrees > 360) {
            return this;
        }

        const yawRadians = yawDegrees * Math.PI / 180;
        const yawQuaternion = new Quaternion(
            Math.cos(yawRadians / 2),
            0,
            0,
            Math.sin(yawRadians / 2)
        );
        const alpha = 0.1;

        return new Quaternion(
            this.w * (1 - alpha) + yawQuaternion.w * alpha,
            this.x * (1 - alpha),
            this.y * (1 - alpha),
            this.z * (1 - alpha) + yawQuaternion.z * alpha
        ).normalize();
    }

    correctOrientation(accelx, accely, accelz, magy, magz) {
        const magnitude = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
        if (magnitude < 1e-6) {
            return this;
        }

        const ax = accelx / magnitude;
        const ay = accely / magnitude;
        const az = accelz / magnitude;

        const pitchFromAccel = Math.asin(-ax);
        const rollFromAccel = Math.atan2(ay, az);

        let pitch = pitchFromAccel;
        let roll = rollFromAccel;
        if (!Number.isNaN(magy) && magy >= -90 && magy <= 90 && !Number.isNaN(magz) && magz >= -90 && magz <= 90) {
            const alphaMag = 0.05;
            pitch = pitchFromAccel * (1 - alphaMag) + (magy * Math.PI / 180) * alphaMag;
            roll = rollFromAccel * (1 - alphaMag) + (magz * Math.PI / 180) * alphaMag;
        }

        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        const cr = Math.cos(roll / 2);
        const sr = Math.sin(roll / 2);
        const accelQuaternion = new Quaternion(cp * cr, sp * cr, cp * sr, -sp * sr);
        const alpha = 0.05;

        return new Quaternion(
            this.w * (1 - alpha) + accelQuaternion.w * alpha,
            this.x * (1 - alpha) + accelQuaternion.x * alpha,
            this.y * (1 - alpha) + accelQuaternion.y * alpha,
            this.z * (1 - alpha) + accelQuaternion.z * alpha
        ).normalize();
    }

    static fromAccelAndMag(accelx, accely, accelz, yawDegrees) {
        const magnitude = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
        if (magnitude < 1e-6) {
            return new Quaternion(1, 0, 0, 0);
        }

        const ax = accelx / magnitude;
        const ay = accely / magnitude;
        const az = accelz / magnitude;
        const pitch = Math.asin(-ax);
        const roll = Math.atan2(ay, az);
        const yaw = Number.isNaN(yawDegrees) || yawDegrees < 0 || yawDegrees > 360
            ? 0
            : yawDegrees * Math.PI / 180;

        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        const cr = Math.cos(roll / 2);
        const sr = Math.sin(roll / 2);
        const cy = Math.cos(yaw / 2);
        const sy = Math.sin(yaw / 2);

        return new Quaternion(
            cp * cr * cy + sp * sr * sy,
            sp * cr * cy - cp * sr * sy,
            cp * sr * cy + sp * cr * sy,
            cp * cr * sy - sp * sr * cy
        ).normalize();
    }

    static fromAccel(accelx, accely, accelz) {
        const magnitude = Math.sqrt(accelx * accelx + accely * accely + accelz * accelz);
        if (magnitude < 1e-6) {
            return new Quaternion(1, 0, 0, 0);
        }

        const ax = accelx / magnitude;
        const ay = accely / magnitude;
        const az = accelz / magnitude;
        const pitch = Math.asin(-ax);
        const roll = Math.atan2(ay, az);

        const cp = Math.cos(pitch / 2);
        const sp = Math.sin(pitch / 2);
        const cr = Math.cos(roll / 2);
        const sr = Math.sin(roll / 2);

        return new Quaternion(cp * cr, sp * cr, cp * sr, -sp * sr).normalize();
    }
}

module.exports = { Quaternion };
