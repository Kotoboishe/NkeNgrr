const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('✅ Клиент подключился');
    ws.send(JSON.stringify({ type: 'system', text: 'Добро пожаловать!' }));

    ws.on('message', (msg) => {
        // Пересылаем сообщение ВСЕМ подключенным
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(msg.toString());
            }
        });
    });
});

app.use(express.static('public'));

server.listen(3000, () => console.log('🚀 Сервер: http://localhost:3000'));