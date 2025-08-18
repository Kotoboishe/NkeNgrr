// ====== WebSocket ======
const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
const ws = new WebSocket(`${protocol}://${location.host}/ws`)
ws.onopen = () => logSystem('Соединение установлено')
ws.onclose = () => logSystem('Соединение закрыто')

// ====== DOM ======
const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d', { willReadFrequently: true })
ctx.lineCap = 'round'
ctx.lineJoin = 'round'

const cursorPreview = document.getElementById('cursorPreview')
const canvasWrap = document.getElementById('canvasWrap')

const playersList = document.getElementById('playersList')
//const playerNameEl = document.getElementById('playerName')
//const playerRoleEl = document.getElementById('playerRole')
const roleBar = document.getElementById('roleBar')
const wordBar = document.getElementById('wordBar')

const chatBox = document.getElementById('chatBox')
const chatInput = document.getElementById('chatInput')
const sendBtn = document.getElementById('sendBtn')

const brushSizeInput = document.getElementById('brushSize')
const brushSizeValue = document.getElementById('brushSizeValue')

const colorPalette = document.getElementById('colorPalette')
const colorPicker = document.getElementById('colorPicker')
const advancedPalette = document.getElementById('advancedPalette')
const currentColorSwatch = document.getElementById('currentColorSwatch')

const toolBrush = document.getElementById('toolBrush')
const toolEraser = document.getElementById('toolEraser')
const toolFill = document.getElementById('toolFill')
const clearCanvasBtn = document.getElementById('clearCanvas')

// ====== Состояние ======
let myRole = 'player'
let myName = '—'
let currentWord = ''
let drawing = false
let tool = 'brush' // brush | eraser | fill
let brushSize = 8
let color = '#000000'
let last = null // {x,y} последняя точка для линий
let lastX = 0
let lastY = 0

// ====== Палитра ======
const basicColors = [
	'#000000',
	'#FFFFFF',
	'#FF0000',
	'#00FF00',
	'#0000FF',
	'#FFFF00',
	'#FF00FF',
	'#00FFFF',
	'#FFA500',
	'#800080',
	'#A0522D',
	'#008080',
	'#C0C0C0',
	'#808080',
	'#8B0000',
	'#006400',
]
const extendedColors = [
	'#F44336',
	'#E91E63',
	'#9C27B0',
	'#673AB7',
	'#3F51B5',
	'#2196F3',
	'#03A9F4',
	'#00BCD4',
	'#009688',
	'#4CAF50',
	'#8BC34A',
	'#CDDC39',
	'#FFEB3B',
	'#FFC107',
	'#FF9800',
	'#FF5722',
	'#795548',
	'#9E9E9E',
	'#607D8B',
]

function renderPalette() {
	colorPalette.innerHTML = ''
	const list = advancedPalette.checked
		? basicColors.concat(extendedColors)
		: basicColors
	list.forEach(c => {
		const b = document.createElement('button')
		b.className = 'w-6 h-6 rounded border border-zinc-600'
		b.style.backgroundColor = c
		b.title = c
		b.onclick = () => setColor(c)
		colorPalette.appendChild(b)
	})
}
function setColor(c) {
	color = c
	currentColorSwatch.style.backgroundColor = color
	if (tool === 'eraser') tool = 'brush' // вернёмся на кисть при выборе цвета
}
advancedPalette.onchange = () => {
	colorPicker.classList.toggle('hidden', !advancedPalette.checked)
	renderPalette()
}
colorPicker.oninput = e => setColor(e.target.value)

renderPalette()
setColor(color)

// ====== Толщина ======
brushSizeInput.addEventListener('input', e => {
	brushSize = +e.target.value
	brushSizeValue.textContent = `${brushSize} px`
	updateCursorPreview(last?.x ?? -1000, last?.y ?? -1000) // просто обновить размер кружка
})

// ====== Инструменты ======
toolBrush.onclick = () => {
	tool = 'brush'
}
toolEraser.onclick = () => {
	tool = 'eraser'
}
toolFill.onclick = () => {
	tool = 'fill'
}

clearCanvasBtn.onclick = () => {
	if (myRole !== 'leader') return
	clearCanvas()
	ws.send(JSON.stringify({ type: 'clear-canvas' }))
}

// ====== Курсор-предпросмотр ======
function updateCursorPreview(x, y) {
	// Игрок — обычный курсор, превью скрыто
	if (myRole !== 'leader') {
		cursorPreview.style.display = 'none'
		canvas.style.cursor = 'default'
		return
	}

	// Лидер — скрываем системный курсор и показываем кружок
	canvas.style.cursor = 'none'

	// позиционируем относительно #canvasWrap
	const wrapRect = canvasWrap.getBoundingClientRect()
	const canvasRect = canvas.getBoundingClientRect()

	const offsetX = canvasRect.left - wrapRect.left
	const offsetY = canvasRect.top - wrapRect.top

	const left = offsetX + x - brushSize / 2
	const top = offsetY + y - brushSize / 2

	cursorPreview.style.left = `${left}px`
	cursorPreview.style.top = `${top}px`
	cursorPreview.style.width = `${brushSize}px`
	cursorPreview.style.height = `${brushSize}px`
	cursorPreview.style.background = tool === 'eraser' ? '#ffffff' : color
	cursorPreview.style.display = 'block'
}

// ====== Рисование (с фиксом выхода за границы) ======
// Ловим mousemove/mouseup на window, чтобы при выходе за холст не терять захват
canvas.addEventListener('mousedown', e => {
	if (myRole !== 'leader') return
	const p = clampToCanvas(getCanvasPos(e))
	drawing = true
	last = p[(lastX, lastY)] = [e.offsetX, e.offsetY]

	if (tool === 'fill') {
		floodFill(p.x | 0, p.y | 0, hexToRgba(color))
		ws.send(JSON.stringify({ type: 'fill', x: p.x | 0, y: p.y | 0, color }))
		return
	}

	// точка старта (круг)
	drawDot(p.x, p.y, tool === 'eraser')
	ws.send(
		JSON.stringify({
			type: 'draw',
			x: p.x,
			y: p.y,
			size: brushSize,
			tool,
			color,
		})
	)
})

window.addEventListener('mousemove', e => {
	const within = isPointerOverCanvas(e)
	const p = clampToCanvas(getCanvasPos(e))
	if (within) updateCursorPreview(p.x, p.y)
	else cursorPreview.style.display = 'none'

	if (!drawing || !last || tool === 'fill') return

	// Рисуем сглаженную линию кругами вдоль сегмента без разрывов
	strokeSegment(last.x, last.y, p.x, p.y, tool === 'eraser')

	ws.send(
		JSON.stringify({
			type: 'draw',
			x: p.x,
			y: p.y,
			prevX: last.x,
			prevY: last.y,
			size: brushSize,
			tool,
			color,
		})
	)
	last = p
})
window.addEventListener('mouseup', () => {
	drawing = false
	last = null
})

canvas.addEventListener('mouseleave', () => {
	// не прекращаем рисовать сразу — ждём mouseup (фикс твоего бага)
})

// ====== Вспомогалки рисования ======
function getCanvasPos(e) {
	const r = canvas.getBoundingClientRect()
	return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function clampToCanvas(p) {
	return {
		x: Math.max(0, Math.min(canvas.width, p.x)),
		y: Math.max(0, Math.min(canvas.height, p.y)),
	}
}
function isPointerOverCanvas(e) {
	const r = canvas.getBoundingClientRect()
	return (
		e.clientX >= r.left &&
		e.clientX <= r.right &&
		e.clientY >= r.top &&
		e.clientY <= r.bottom
	)
}
function drawDot(x, y, erase = false) {
	ctx.save()
	ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
	ctx.beginPath()
	ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
	ctx.fillStyle = erase ? 'rgba(0,0,0,1)' : color
	ctx.fill()
	ctx.restore()
}
function strokeSegment(x0, y0, x1, y1, erase = false) {
	// Шаг ~ половина радиуса, чтобы без дыр
	const step = Math.max(1, Math.floor(brushSize / 2))
	const dx = x1 - x0,
		dy = y1 - y0
	const dist = Math.hypot(dx, dy)
	const steps = Math.max(1, Math.ceil(dist / step))
	for (let i = 1; i <= steps; i++) {
		const t = i / steps
		const x = x0 + dx * t
		const y = y0 + dy * t
		drawDot(x, y, erase)
	}
}
function clearCanvas() {
	ctx.clearRect(0, 0, canvas.width, canvas.height)
}

// ====== Заливка как в Paint (Flood Fill, 4-связность) ======
function floodFill(x, y, fillColor) {
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
	const data = img.data
	const target = getPixel(data, x, y)
	if (same(target, fillColor)) return

	const W = canvas.width,
		H = canvas.height
	const stack = [[x, y]]

	while (stack.length) {
		const [cx, cy] = stack.pop()
		if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue
		const c = getPixel(data, cx, cy)
		if (!same(c, target)) continue

		setPixel(data, cx, cy, fillColor)
		stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
	}
	ctx.putImageData(img, 0, 0)
}
function getPixel(data, x, y) {
	const i = (y * canvas.width + x) * 4
	return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}
function setPixel(data, x, y, rgba) {
	const i = (y * canvas.width + x) * 4
	data[i] = rgba[0]
	data[i + 1] = rgba[1]
	data[i + 2] = rgba[2]
	data[i + 3] = rgba[3]
}
function same(a, b) {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}
function hexToRgba(hex) {
	const v = parseInt(hex.slice(1), 16)
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255]
}

// ====== Чат ======
function logSystem(text) {
	const row = document.createElement('div')
	row.className = 'text-zinc-400 text-sm'
	row.textContent = '⚡ ' + text
	chatBox.appendChild(row)
	chatBox.scrollTop = chatBox.scrollHeight
}
function addChat(text) {
	const row = document.createElement('div')
	row.textContent = text
	chatBox.appendChild(row)
	chatBox.scrollTop = chatBox.scrollHeight
}
sendBtn.onclick = sendChat
chatInput.addEventListener('keydown', e => {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault()
		sendChat()
	}
})
function sendChat() {
	const t = chatInput.value.trim()
	if (!t) return
	ws.send(JSON.stringify({ type: 'chat', text: t }))
	chatInput.value = ''
}

// ====== Приём сообщений от сервера ======
ws.onmessage = e => {
	const msg = JSON.parse(e.data)

	if (msg.type === 'role') {
		myRole = msg.role || 'player'
		myName = msg.name || myName
		//playerNameEl.textContent = myName

		// обновляем верхний бар с ролью
		//playerRoleEl.textContent = myRole
		roleBar.textContent = myRole
		// можно добавить цвет или класс в зависимости от роли
		if (myRole === 'leader') {
			roleBar.textContent = 'Роль: Лидер'
			roleBar.style.color = '#c47c17ff' // например желтый для лидера
		} else {
			roleBar.textContent = 'Роль: Игрок'
			roleBar.style.color = '#b5b0b5ff' // серый для обычного игрока
		}

		// курсор и превью по роли
		canvas.style.cursor = myRole === 'leader' ? 'none' : 'default'
		if (myRole !== 'leader') cursorPreview.style.display = 'none'

		return
	}

	if (msg.type === 'word') {
		currentWord = msg.word || ''
		if (myRole === 'leader') {wordBar.textContent = currentWord ? `Слово: ${currentWord}` : ''}
		return
	}

	if (msg.type === 'player-list') {
		playersList.innerHTML = ''
		;(msg.players || []).forEach(p => {
			const li = document.createElement('li')
			li.textContent = `${p.name}${p.role === 'leader' ? ' 🎨' : ''}`
			playersList.appendChild(li)
		})
		return
	}

	if (msg.type === 'chat') {
		addChat(msg.text)
		return
	}

	if (msg.type === 'clear-canvas') {
		clearCanvas()
		return
	}

	if (msg.type === 'fill') {
		floodFill(msg.x | 0, msg.y | 0, hexToRgba(msg.color || '#000000'))
		return
	}

	if (msg.type === 'draw') {
		ctx.strokeStyle = msg.color
		ctx.lineWidth = msg.size
		ctx.beginPath()
		ctx.moveTo(msg.prevX, msg.prevY)
		ctx.lineTo(msg.x, msg.y)
		ctx.stroke()
	}
}
