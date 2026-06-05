class KalmanFilter {
    constructor() {
        this.x = [[0], [0]];
        this.P = [[1000, 0], [0, 1000]];
        this.A = [[1, 0], [0, 1]];
        this.B = [[0], [0]];
        this.H = [[1, 0]];
        this.Q = [[0.001, 0], [0, 0.001]];
        this.R = [[1]];
    }

    multiplyMatrix(A, B) {
        if (!A[0] || !B[0] || A[0].length !== B.length) {
            return [[0]];
        }

        const rowsA = A.length;
        const colsA = A[0].length;
        const colsB = B[0].length;
        const result = Array(rowsA).fill(null).map(() => Array(colsB).fill(0));

        for (let i = 0; i < rowsA; i += 1) {
            for (let j = 0; j < colsB; j += 1) {
                for (let k = 0; k < colsA; k += 1) {
                    result[i][j] += A[i][k] * B[k][j];
                }
            }
        }

        return result;
    }

    transpose(A) {
        return A[0].map((_, columnIndex) => A.map((row) => row[columnIndex]));
    }

    inverseMatrix1x1(A) {
        if (Math.abs(A[0][0]) < 1e-6) {
            return [[1]];
        }

        return [[1 / A[0][0]]];
    }

    predict(acceleration, deltaTimeSeconds) {
        if (Number.isNaN(acceleration) || deltaTimeSeconds <= 0 || Number.isNaN(deltaTimeSeconds) || deltaTimeSeconds > 1) {
            return;
        }

        this.A = [[1, deltaTimeSeconds], [0, 1]];
        this.B = [[deltaTimeSeconds * deltaTimeSeconds / 2], [deltaTimeSeconds]];

        const Ax = this.multiplyMatrix(this.A, this.x);
        const Bu = this.multiplyMatrix(this.B, [[acceleration]]);
        this.x = [[Ax[0][0] + Bu[0][0]], [Ax[1][0] + Bu[1][0]]];

        const P_A = this.multiplyMatrix(this.P, this.transpose(this.A));
        this.P = this.multiplyMatrix(this.A, P_A);
        for (let i = 0; i < 2; i += 1) {
            for (let j = 0; j < 2; j += 1) {
                this.P[i][j] += this.Q[i][j];
            }
        }
    }

    update(altitude) {
        if (Number.isNaN(altitude) || altitude < 0 || altitude > 2000) {
            return;
        }

        const Ht = this.transpose(this.H);
        const H_P = this.multiplyMatrix(this.H, this.P);
        const H_P_Ht = this.multiplyMatrix(H_P, Ht);
        const H_P_Ht_R = [[H_P_Ht[0][0] + this.R[0][0]]];
        const K_num = this.multiplyMatrix(this.P, Ht);
        const K_den = this.inverseMatrix1x1(H_P_Ht_R);
        const K = this.multiplyMatrix(K_num, K_den);

        const Hx = this.multiplyMatrix(this.H, this.x);
        const innovation = altitude - Hx[0][0];
        this.x[0][0] += K[0][0] * innovation;
        this.x[1][0] += K[1][0] * innovation;

        const KH = this.multiplyMatrix(K, this.H);
        const I_KH = [[1 - KH[0][0], -KH[0][1]], [-KH[1][0], 1 - KH[1][1]]];
        this.P = this.multiplyMatrix(I_KH, this.P);
    }

    getState() {
        return {
            relativeAltitude: Math.max(0, this.x[0][0]),
            velocityZ: this.x[1][0]
        };
    }

    reset() {
        this.x = [[0], [0]];
        this.P = [[1000, 0], [0, 1000]];
    }
}

module.exports = { KalmanFilter };
