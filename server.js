const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = [];

wss.on('connection', (ws) => {
    // Определяем роль
    let role = clients.length === 0 ? 'leader' : 'player';
    clients.push({ ws, role });

    console.log(`✅ Новый клиент (${role})`);

    ws.send(JSON.stringify({ type: 'role', role }));

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);

        if (data.type === 'chat') {
            // Игроки могут писать, ведущий — нет
            if (role === 'player') {
                broadcast(msg);
            }
        }

        if (data.type === 'draw') {
            // Рисовать может только ведущий
            if (role === 'leader') {
                broadcast(msg);
            }
        }
    });

    ws.on('close', () => {
        console.log(`❌ Клиент (${role}) отключился`);
        clients = clients.filter(c => c.ws !== ws);

        // Если ведущий ушёл — назначаем нового
        if (role === 'leader' && clients.length > 0) {
            clients[0].role = 'leader';
            clients[0].ws.send(JSON.stringify({ type: 'role', role: 'leader' }));
        }
    });
});

function broadcast(msg) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg.toString());
        }
    });
}

app.use(express.static('public'));

server.listen(3000, () => console.log('🚀 Сервер: http://localhost:3000'));