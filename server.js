const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Папка для фронтенда
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Если путь не найден — возвращаем index.html (для SPA)
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// Игроки, ведущий, слово, история холста
let clients = [];
let leader = null;
let currentWord = '';
let drawHistory = [];

// Слово для рисования
function chooseWord() {
    const words = ['кот', 'собака', 'машина', 'дом', 'дерево', 'река', 'солнце'];
    return words[Math.floor(Math.random() * words.length)];
}

// Отправка сообщения всем клиентам, кроме excludeWs (если нужно)
function broadcast(msg, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client !== excludeWs) {
            client.send(msg);
        }
    });
}

// Установка роли
function sendRole(ws, role, name) {
    ws.send(JSON.stringify({ type: 'role', role, name }));
}

function sendPlayerList() {
    const list = clients.map(c => ({
        name: c.name,
        role: c.ws === leader ? 'leader' : 'player'
    }));
    broadcast(JSON.stringify({ type: 'player-list', players: list }));
}

// Новый раунд
function startNewRound(newLeader) {
    leader = newLeader;
    currentWord = chooseWord();
    drawHistory = [];

    clients.forEach(c => {
        if (c.ws === leader) {
            sendRole(c.ws, 'leader', c.name);
            c.ws.send(JSON.stringify({ type: 'word', word: currentWord }));
        } else {
            sendRole(c.ws, 'player', c.name);
            c.ws.send(JSON.stringify({ type: 'clear-canvas' }));
        }
    });

    sendPlayerList(); // обновляем список игроков
    broadcast(JSON.stringify({ type: 'system', text: 'Новый раунд начался!' }));
}

// WebSocket
wss.on('connection', (ws) => {
    const name = `Игрок${Math.floor(Math.random() * 100)}`;
    clients.push({ ws, name, role: 'player' });
    sendPlayerList(); // обновляем список игроков

    if (!leader) {
        leader = ws;
        startNewRound(ws);
    } else {
        sendRole(ws, 'player', name);
        // Отправка истории холста
        drawHistory.forEach(line => ws.send(JSON.stringify(line)));
    }

    ws.on('message', (message) => {
        let data;
        try {
            data = JSON.parse(message);
        } catch {
            return;
        }

        // Рисование
        if (data.type === 'draw') {
            const player = clients.find(c => c.ws === ws);
            if (player && player.ws === leader) {
            // Сохраняем всё, что пришло (включая цвет, размер, инструмент)
                drawHistory.push({
                type: 'draw',
                prevX: data.prevX,
                prevY: data.prevY,
                x: data.x,
                y: data.y,
                color: data.color,
                size: data.size,
                tool: data.tool
                });

            // Отправляем всем остальным
            broadcast(JSON.stringify({
            type: 'draw',
            prevX: data.prevX,
            prevY: data.prevY,
            x: data.x,
            y: data.y,
            color: data.color,
            size: data.size,
            tool: data.tool
                }), ws);
            }
        }

        // Чат
        if (data.type === 'chat') {
            const player = clients.find(c => c.ws === ws);
            if (player.role === 'leader') return;

            broadcast(JSON.stringify({ type: 'chat', text: `${player.name}: ${data.text}` }));

            if (data.text.trim().toLowerCase() === currentWord.toLowerCase()) {
                broadcast(JSON.stringify({ type: 'system', text: `${player.name} угадал слово "${currentWord}"!` }));
                startNewRound(player.ws);
            }
        }

        // Очистка холста
        if (data.type === 'clear-canvas') {
            const player = clients.find(c => c.ws === ws);
            if (player && player.ws === leader) {
                drawHistory = [];
                broadcast(JSON.stringify({ type: 'clear-canvas' }));
            }
        }
    });

    ws.on('close', () => {
        clients = clients.filter(c => c.ws !== ws);
        if (ws === leader && clients.length > 0) {
            startNewRound(clients[0].ws);
        } else {
            sendPlayerList();
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});