const express = require('express');
const { WebSocketServer } = require('ws');
const { createServer } = require('http');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Раздаём статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Если не найден статический файл — отдаём index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Список игроков и холст
let clients = [];
let leader = null;
let currentWord = '';
let drawHistory = [];

function chooseWord() {
    const words = ['кот', 'собака', 'машина', 'дом', 'дерево', 'река', 'солнце'];
    return words[Math.floor(Math.random() * words.length)];
}

function broadcast(msg, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client !== excludeWs) {
            client.send(msg);
        }
    });
}

function sendRole(ws, role, name) {
    ws.send(JSON.stringify({ type: 'role', role, name }));
}

function startNewRound(newLeader) {
    leader = newLeader;
    currentWord = chooseWord();
    drawHistory = []; // Очищаем холст

    clients.forEach(c => {
        if (c.ws === leader) {
            sendRole(c.ws, 'leader', c.name);
            c.ws.send(JSON.stringify({ type: 'word', word: currentWord }));
        } else {
            sendRole(c.ws, 'player', c.name);
            c.ws.send(JSON.stringify({ type: 'clear-canvas' }));
        }
    });

    broadcast(JSON.stringify({ type: 'system', text: 'Новый раунд начался!' }));
}

wss.on('connection', (ws) => {
    const name = `Игрок${Math.floor(Math.random() * 100)}`;
    clients.push({ ws, name, role: 'player' });

    if (!leader) {
        leader = ws;
        startNewRound(ws);
    } else {
        sendRole(ws, 'player', name);
        // Отправляем историю рисования
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
                drawHistory.push(data);
                broadcast(JSON.stringify(data), ws);
            }
        }

        // Чат
        if (data.type === 'chat') {
            const player = clients.find(c => c.ws === ws);
            if (player.role === 'leader') return; // Ведущий не пишет в чат

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
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});