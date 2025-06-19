const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const WEBAPP_PATH = path.join(__dirname, 'webapp');
const JSON_PATH = path.join(__dirname, 'JSON Files');

const fileMap = {
    'Data Collection.json': 'scores',
    'AdjudicationSheets.json': 'adjudication',
    '2025_judge_comments.json': 'comments',
    'historical_judge_comments.json': 'historical_comments'
};

app.use(express.static(WEBAPP_PATH));

function readFileAndBroadcast(filePath, ws) {
    const fileName = path.basename(filePath);
    const fileType = fileMap[fileName];

    if (!fileType) return;

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                console.log(`${fileName} not found, skipping.`);
                 if (fileType === 'comments') {
                    const payload = JSON.stringify({ type: 'comments', data: [] });
                    if(ws.readyState === WebSocket.OPEN) ws.send(payload);
                 }
            } else {
                console.error(`Error reading ${fileName}:`, err);
            }
            return;
        }

        try {
            const jsonData = JSON.parse(data);
            const payload = JSON.stringify({ type: fileType, data: jsonData });
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
                console.log(`Sent ${fileName} data to client.`);
            }
        } catch (parseErr) {
            console.error(`Error parsing JSON from ${fileName}:`, parseErr);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send initial data
    Object.keys(fileMap).forEach(fileName => {
        const filePath = path.join(JSON_PATH, fileName);
        readFileAndBroadcast(filePath, ws);
    });

    // Watch for changes
    const watcher = chokidar.watch(Object.keys(fileMap).map(f => path.join(JSON_PATH, f)), {
        persistent: true,
        ignoreInitial: true,
    });

    watcher.on('change', (filePath) => {
        console.log(`File ${path.basename(filePath)} has changed.`);
        readFileAndBroadcast(filePath, ws);
    });
    
    watcher.on('add', (filePath) => {
        console.log(`File ${path.basename(filePath)} has been added.`);
        readFileAndBroadcast(filePath, ws);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        watcher.close();
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        watcher.close();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
    console.log('Serving files from:', WEBAPP_PATH);
    console.log('Watching for JSON changes in:', JSON_PATH);
}); 