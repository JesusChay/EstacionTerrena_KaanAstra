function sendToWindow(window, channel, payload) {
    if (window && !window.isDestroyed()) {
        window.webContents.send(channel, payload);
    }
}

function broadcastPayloadData(windows, payloadData) {
    windows.forEach((window) => {
        sendToWindow(window, 'payload-data', payloadData);
    });
}

function broadcastLandingPrediction(windows, landingPrediction) {
    windows.forEach((window) => {
        sendToWindow(window, 'landing-prediction', landingPrediction);
    });
}

module.exports = {
    sendToWindow,
    broadcastLandingPrediction,
    broadcastPayloadData
};
