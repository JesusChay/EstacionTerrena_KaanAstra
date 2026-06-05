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

module.exports = {
    sendToWindow,
    broadcastPayloadData
};
