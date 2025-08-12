const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
//const wss = new WebSocket.Server({ server });
const wss = new WebSocket('wss://nkengrr.onrender.com');

let clients = []; // { ws, role, name }
let currentWord = null;
let drawHistory = [];  // сюда будут сохраняться все линии
const words = ['кошка', 'машина', 'дерево', 'телефон', 'река', 'солнце'];

function chooseWord() {
    currentWord = words[Math.floor(Math.random() * words.length)];
}

function broadcast(msg, excludeWs = null) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
            client.send(msg);
        }
    });
}

function broadcastRoles() {
    clients.forEach(c => {
        c.ws.send(JSON.stringify({ type: 'role', role: c.role, name: c.name }));
    });
}

function makeLeader(player) {
    clients.forEach(c => c.role = 'player');
    player.role = 'leader';
}

wss.on('connection', (ws) => {
    const role = clients.length === 0 ? 'leader' : 'player';
    const name = `Игрок${Math.floor(Math.random() * 1000)}`;
    clients.push({ ws, role, name });

    ws.send(JSON.stringify({ type: 'role', role, name }));

    if (role === 'leader') {
        chooseWord();
        ws.send(JSON.stringify({ type: 'word', word: currentWord }));
    }

    // Отправляем новому клиенту всю историю линий, чтобы он сразу увидел текущий рисунок
    drawHistory.forEach(line => {
    	ws.send(JSON.stringify({ type: 'draw', ...line }));
	});
    
    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch {
            return;
        }

        const player = clients.find(c => c.ws === ws);

        if (!player) return;

        if (data.type === 'chat' && player.role === 'player') {
            // Проверка слова
            if (data.text.trim().toLowerCase() === currentWord.toLowerCase()) {
                broadcast(JSON.stringify({ type: 'system', text: `${player.name} угадал слово!` }));
                makeLeader(player);
                player.ws.send(JSON.stringify({ type: 'start-button' }));
            } else {
                broadcast(JSON.stringify({ type: 'chat', text: `${player.name}: ${data.text}` }));
            }
        }

	if (data.type === 'draw' && player.role === 'leader') {
    		console.log("Draw received:", data);
    		drawHistory.push({ prevX: data.prevX, prevY: data.prevY, x: data.x, y: data.y });
   		broadcast(msg); // шлем всем
    		console.log("Broadcast draw to clients");
	}

        if (data.type === 'start-game' && player.role === 'leader') {
            chooseWord();
            player.ws.send(JSON.stringify({ type: 'word', word: currentWord }));
            broadcastRoles();
	    drawHistory = [];
            broadcast(JSON.stringify({ type: 'clear-canvas' }));
        }
    });

    ws.on('close', () => {
        clients = clients.filter(c => c.ws !== ws);

        if (clients.length === 0) return;

        if (clients.find(c => c.role === 'leader') == null) {
            makeLeader(clients[0]);
            chooseWord();
            clients[0].ws.send(JSON.stringify({ type: 'word', word: currentWord }));
            broadcastRoles();
            broadcast(JSON.stringify({ type: 'clear-canvas' }));
        }
    });
});

app.use(express.static('public'));

server.listen(3000, () => console.log('Сервер запущен http://localhost:3000'));