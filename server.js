import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Раздаём клиентские файлы
app.use(express.static(path.join(__dirname, "public")));

// Игровая логика
let clients = [];
let canvasHistory = [];
let currentWord = "";
let leader = null;

function broadcast(msg, excludeWs = null) {
    wss.clients.forEach((client) => {
        if (client.readyState === 1 && client !== excludeWs) {
            client.send(msg);
        }
    });
}

function getRandomWord() {
    const words = ["кошка", "собака", "машина", "дерево", "книга"];
    return words[Math.floor(Math.random() * words.length)];
}

wss.on("connection", (ws) => {
    console.log("Новый игрок подключился");

    // Присваиваем роль
    let role, name;
    if (!leader) {
        leader = ws;
        role = "leader";
        name = "Ведущий";
        currentWord = getRandomWord();
        ws.send(JSON.stringify({ type: "word", word: currentWord }));
    } else {
        role = "player";
        name = `Игрок${Math.floor(Math.random() * 100)}`;
    }

    clients.push({ ws, role, name });

    ws.send(JSON.stringify({ type: "role", role, name }));

    // Отправляем историю рисунка новому игроку
    canvasHistory.forEach((line) => {
        ws.send(JSON.stringify(line));
    });

    ws.on("message", (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch {
            console.log("Не удалось распарсить:", msg.toString());
            return;
        }

        if (data.type === "draw") {
            const player = clients.find((c) => c.ws === ws);
            if (player && player.role === "leader") {
                canvasHistory.push(data);
                broadcast(JSON.stringify(data), ws);
            }
        }

        if (data.type === "clear-canvas") {
            canvasHistory = [];
            broadcast(JSON.stringify({ type: "clear-canvas" }));
        }

        if (data.type === "chat") {
            broadcast(JSON.stringify({ type: "chat", text: `${name}: ${data.text}` }));
            if (role === "player" && data.text.toLowerCase() === currentWord.toLowerCase()) {
                ws.send(JSON.stringify({ type: "system", text: "Вы угадали!" }));
                broadcast(JSON.stringify({ type: "system", text: `${name} угадал слово!` }), ws);
                ws.send(JSON.stringify({ type: "start-button" }));
            }
        }

        if (data.type === "start-game") {
            leader = ws;
            role = "leader";
            currentWord = getRandomWord();
            ws.send(JSON.stringify({ type: "word", word: currentWord }));
            ws.send(JSON.stringify({ type: "role", role, name }));
            broadcast(JSON.stringify({ type: "role", role: "player", name }));
            broadcast(JSON.stringify({ type: "clear-canvas" }));
            canvasHistory = [];
        }
    });

    ws.on("close", () => {
        console.log("Игрок отключился");
        clients = clients.filter((c) => c.ws !== ws);
        if (leader === ws) {
            leader = null;
            if (clients.length > 0) {
                leader = clients[0].ws;
                clients[0].role = "leader";
                currentWord = getRandomWord();
                leader.send(JSON.stringify({ type: "word", word: currentWord }));
                leader.send(JSON.stringify({ type: "role", role: "leader", name: clients[0].name }));
            }
        }
    });
});

// Render даёт порт через process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});