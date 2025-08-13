const ws = new WebSocket(`wss://${window.location.host}`);
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const btn = document.getElementById('btn');
const clearBtn = document.getElementById('clearBtn');
const roleInfo = document.getElementById('roleInfo');
const wordInfo = document.getElementById('wordInfo');

let role = '';
let drawing = false;
let prevX = 0, prevY = 0;

let currentColor = '#000000';
let currentTool = 'brush';
let currentSize = 5;

// пример выбора цвета
document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => currentColor = swatch.dataset.color);
});

// выбор инструмента
document.querySelectorAll('.tool').forEach(btn => {
    btn.addEventListener('click', () => currentTool = btn.dataset.tool);
});

// ползунок размера
document.getElementById('size-range').addEventListener('input', e => currentSize = +e.target.value);

// очистка холста
document.getElementById('clear-canvas-btn').addEventListener('click', () => {
    if (role === 'leader') {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ws.send(JSON.stringify({ type: 'clear-canvas' }));
    }
});

function addLog(text) {
    const div = document.createElement('div');
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function drawLine(x1, y1, x2, y2, emit) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (!emit) return;
    ws.send(JSON.stringify({ type: 'draw', prevX: x1, prevY: y1, x: x2, y: y2 }));
}

canvas.addEventListener('mousedown', (e) => {
    if (role !== 'leader') return;
    drawing = true;
    prevX = e.offsetX;
    prevY = e.offsetY;
});
canvas.addEventListener('mouseup', () => drawing = false);
canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    drawLine(prevX, prevY, e.offsetX, e.offsetY, true);
    prevX = e.offsetX;
    prevY = e.offsetY;
});

// Отправка по кнопке
btn.addEventListener('click', () => {
    sendMessage();
});

// Отправка по Enter
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { 
        e.preventDefault(); // чтобы не добавлялся перенос строки
        sendMessage();
    }
});

function sendMessage() {
    const text = input.value.trim();
    if (text) {
        ws.send(JSON.stringify({ type: 'chat', text }));
        input.value = '';
    }
}

function updatePlayerList(players) {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name + (p.role === 'leader' ? ' 🎨' : '');
        list.appendChild(li);
    });
}

clearBtn.onclick = () => {
    if (role === 'leader') {
        ws.send(JSON.stringify({ type: 'clear-canvas' }));
    }
};

ws.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'role') {
        role = data.role;
        roleInfo.textContent = `Ваша роль: ${role === 'leader' ? 'Ведущий' : 'Игрок'} (${data.name})`;
        input.disabled = (role === 'leader');
        btn.disabled = (role === 'leader');
        canvas.style.pointerEvents = (role === 'leader') ? 'auto' : 'none';
        if (role !== 'leader') wordInfo.textContent = '';
    }

    if (data.type === 'word') {
        wordInfo.textContent = `Ваше слово: ${data.word}`;
    }

    if (data.type === 'player-list') {
        updatePlayerList(data.players);
    }

    if (data.type === 'chat') {
        addLog(data.text);
    }

    if (data.type === 'system') {
        addLog(`⚡ ${data.text}`);
    }

    if (data.type === 'draw') {
        drawLine(data.prevX, data.prevY, data.x, data.y, false);
    }

    if (data.type === 'clear-canvas') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
};