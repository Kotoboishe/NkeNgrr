const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

let clients = [];
let leader = null;
let currentWord = '';
let drawingHistory = [];

// Слова для угадывания
const words = ['кот', 'собака', 'машина', 'дом', 'яблоко'];

function broadcast(data, excludeWs = null) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
            client.send(msg);
        }
    });
}

wss.on('connection', (ws) => {
    console.log('✅ Новый клиент подключен');

    let name = `Игрок${Math.floor(Math.random() * 100)}`;
    let role = 'player';

    // Если нет ведущего — назначаем его
    if (!leader) {
        leader = ws;
        role = 'leader';
        currentWord = words[Math.floor(Math.random() * words.length)];
        ws.send(JSON.stringify({ type: 'word', word: currentWord }));
    }

    clients.push({ ws, role, name });

    // Отправляем роль новому игроку
    ws.send(JSON.stringify({ type: 'role', role, name }));

    // Отправляем уже нарисованное
    ws.send(JSON.stringify({ type: 'init-draw', lines: drawingHistory }));

    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch {
            return;
        }

        // Чат
        if (data.type === 'chat') {
            broadcast({ type: 'chat', text: `${name}: ${data.text}` });

            // Проверка на угаданное слово
            if (role === 'player' && data.text.trim().toLowerCase() === currentWord.toLowerCase()) {
                broadcast({ type: 'system', text: `${name} угадал слово "${currentWord}"!` });
                ws.send(JSON.stringify({ type: 'start-button' }));
            }
        }

        // Рисование
        if (data.type === 'draw' && role === 'leader') {
            drawingHistory.push({ prevX: data.prevX, prevY: data.prevY, x: data.x, y: data.y });
            broadcast(data, ws);
        }

        // Очистка
        if (data.type === 'clear-canvas' && role === 'leader') {
            drawingHistory = [];
            broadcast({ type: 'clear-canvas' });
        }

        // Старт новой игры
        if (data.type === 'start-game') {
            leader = ws;
            role = 'leader';
            currentWord = words[Math.floor(Math.random() * words.length)];
            drawingHistory = [];
            broadcast({ type: 'clear-canvas' });

            clients.forEach(c => {
                if (c.ws === ws) {
                    c.role = 'leader';
                    c.ws.send(JSON.stringify({ type: 'word', word: currentWord }));
                    c.ws.send(JSON.stringify({ type: 'role', role: 'leader', name: c.name }));
                } else {
                    c.role = 'player';
                    c.ws.send(JSON.stringify({ type: 'role', role: 'player', name: c.name }));
                }
            });
        }
    });

    ws.on('close', () => {
        console.log('❌ Клиент отключился');
        clients = clients.filter(c => c.ws !== ws);
        if (ws === leader) leader = null;
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));