import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("public"));

const words = ["дом", "машина", "кот", "солнце", "компьютер"];
let clients = [];
let leader = null;
let currentWord = "";
let drawingHistory = [];

function broadcast(data, exclude) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client !== exclude) {
            client.send(msg);
        }
    });
}

function getClient(ws) {
    return clients.find(c => c.ws === ws);
}

function sendDrawingHistory(ws) {
    if (drawingHistory.length > 0) {
        ws.send(JSON.stringify({ type: "init-draw", lines: drawingHistory }));
    }
}

function assignLeader(newLeaderWs) {
    leader = newLeaderWs;
    currentWord = words[Math.floor(Math.random() * words.length)];
    drawingHistory = []; // очищаем историю

    clients.forEach(c => {
        if (c.ws === newLeaderWs) {
            c.role = "leader";
            c.ws.send(JSON.stringify({ type: "role", role: "leader", name: c.name }));
            c.ws.send(JSON.stringify({ type: "word", word: currentWord }));
        } else {
            c.role = "player";
            c.ws.send(JSON.stringify({ type: "role", role: "player", name: c.name }));
            c.ws.send(JSON.stringify({ type: "clear-word" }));
        }
    });

    broadcast({ type: "clear-canvas" });
}

wss.on("connection", (ws) => {
    let name = `Игрок${Math.floor(Math.random() * 100)}`;
    let role = leader ? "player" : "leader";

    if (!leader) {
        leader = ws;
        currentWord = words[Math.floor(Math.random() * words.length)];
        ws.send(JSON.stringify({ type: "word", word: currentWord }));
    }

    clients.push({ ws, role, name });

    ws.send(JSON.stringify({ type: "role", role, name }));

    // при подключении сразу отдаём историю
    sendDrawingHistory(ws);

    ws.on("message", (msg) => {
        let data;
        try { data = JSON.parse(msg); } catch { return; }

        const client = getClient(ws);
        if (!client) return;

        // Чат
        if (data.type === "chat") {
            if (client.role === "leader") return; // ведущий не пишет
            broadcast({ type: "chat", text: `${client.name}: ${data.text}` });

            if (data.text.trim().toLowerCase() === currentWord.toLowerCase()) {
                broadcast({ type: "system", text: `${client.name} угадал слово "${currentWord}"!` });
                assignLeader(ws);
            }
        }

        // Рисование
        if (data.type === "draw" && client.role === "leader") {
            const line = { prevX: data.prevX, prevY: data.prevY, x: data.x, y: data.y };
            drawingHistory.push(line);
            broadcast({ type: "draw", ...line }, ws); // отправляем всем кроме отправителя
        }

        // Очистка холста
        if (data.type === "clear-canvas" && client.role === "leader") {
            drawingHistory = [];
            broadcast({ type: "clear-canvas" });
        }
    });

    ws.on("close", () => {
        clients = clients.filter(c => c.ws !== ws);
        if (ws === leader) leader = null;
    });
});

server.listen(process.env.PORT || 10000, () => console.log("Server started"));