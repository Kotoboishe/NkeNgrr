const ws = new WebSocket(`wss://${window.location.host}`);
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

const playersList = document.getElementById('playersList');
const currentWord = document.getElementById('currentWord');

const brushBtn = document.getElementById('brushBtn');
const eraserBtn = document.getElementById('eraserBtn');
const fillBtn = document.getElementById('fillBtn');
const sizeSlider = document.getElementById('sizeSlider');
const clearBtn = document.getElementById('clearBtn');

const cursorPreview = document.getElementById('cursor-preview');

let role = '';
let drawing = false;
let prevX = 0, prevY = 0;

let currentColor = '#000000';
let currentTool = 'brush';
let currentSize = 5;

// 🎨 выбор цвета
document.querySelectorAll('.color').forEach(swatch => {
    swatch.addEventListener('click', () => {
        currentColor = swatch.dataset.color;
        ctx.strokeStyle = currentColor;
        ctx.fillStyle = currentColor;
    });
});

// 🛠 выбор инструмента
brushBtn.addEventListener('click', () => currentTool = 'brush');
eraserBtn.addEventListener('click', () => currentTool = 'eraser');
fillBtn.addEventListener('click', () => currentTool = 'fill');

// 📏 толщина кисти/ластика
sizeSlider.addEventListener('input', e => currentSize = +e.target.value);

// 🧹 очистка холста
clearBtn.addEventListener('click', () => {
    if (role === 'leader') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ws.send(JSON.stringify({ type: 'clear-canvas' }));
    }
});

// 📜 лог чата
function addLog(text) {
    const div = document.createElement('div');
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ✏️ рисование линии
function drawLine(x1, y1, x2, y2, color, size, tool, emit) {
    // Учитываем инструмент
    if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (!emit) return;
    ws.send(JSON.stringify({
        type: 'draw',
        prevX: x1,
        prevY: y1,
        x: x2,
        y: y2,
        color,
        size,
        tool
    }));
}

// 🪣 заливка (простейший вариант — просто цвет фона)
function fillCanvas(color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ws.send(JSON.stringify({ type: 'fill', color }));
}

// 🎯 события мыши
canvas.addEventListener('mousedown', (e) => {
    if (role !== 'leader') return;

    if (currentTool === 'fill') {
        fillCanvas(currentColor);
        return;
    }

    drawing = true;
    prevX = e.offsetX;
    prevY = e.offsetY;
});

canvas.addEventListener('mouseup', () => drawing = false);

canvas.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    let color = (currentTool === 'eraser') ? '#ffffff' : currentColor;
    drawLine(prevX, prevY, e.offsetX, e.offsetY, currentColor, currentSize, currentTool, true);
    prevX = e.offsetX;
    prevY = e.offsetY;
});

// показываем и обновляем курсор при движении мыши по холсту
canvas.addEventListener('mousemove', (e) => {
    if (role !== 'leader') {
        cursorPreview.style.display = 'none';
        return;
    }

    cursorPreview.style.display = 'block';

    const x = e.clientX;
    const y = e.clientY;

    cursorPreview.style.left = `${x}px`;
    cursorPreview.style.top = `${y}px`;
    cursorPreview.style.width = `${currentSize}px`;
    cursorPreview.style.height = `${currentSize}px`;
    cursorPreview.style.background = currentTool === 'eraser' ? '#fff' : currentColor;
    cursorPreview.style.border = currentTool === 'eraser'
        ? '1px solid rgba(0,0,0,0.3)'
        : '1px solid rgba(0,0,0,0.3)';
});

// скрываем курсор, когда мышь покидает холст
canvas.addEventListener('mouseleave', () => {
    cursorPreview.style.display = 'none';
});

// 💬 отправка чата
sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function sendMessage() {
    const text = chatInput.value.trim();
    if (text) {
        ws.send(JSON.stringify({ type: 'chat', text }));
        chatInput.value = '';
    }
}

// 👥 обновление списка игроков
function updatePlayerList(players) {
    playersList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.name + (p.role === 'leader' ? ' 🎨' : '');
        playersList.appendChild(li);
    });
}

// 📡 получение сообщений от сервера
ws.onmessage = (e) => {
    const data = JSON.parse(e.data);

    if (data.type === 'role') {
        role = data.role;
        chatInput.disabled = (role === 'leader');
        sendBtn.disabled = (role === 'leader');
        canvas.style.pointerEvents = (role === 'leader') ? 'auto' : 'none';
        if (role !== 'leader') currentWord.textContent = '—';
    }

    if (data.type === 'word') {
        currentWord.textContent = data.word;
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
    drawLine(data.prevX, data.prevY, data.x, data.y, data.color, data.size, data.tool, false);
    }

    if (data.type === 'fill') {
        ctx.fillStyle = data.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (data.type === 'clear-canvas') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
};