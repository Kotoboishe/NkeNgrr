// server.js
const express = require('express')
const { WebSocketServer } = require('ws')
const { createServer } = require('http')
const path = require('path')

// ====== Настройка ======
const app = express()
const port = process.env.PORT || 8080

// Раздача статики из папки public
const publicPath = path.join(__dirname, 'public')
app.use(express.static(publicPath))

// Создаём HTTP сервер и WebSocket сервер поверх него
const server = createServer(app)
const wss = new WebSocketServer({ server })

// ====== Состояние ======
let clients = new Set()
let leader = null
let currentWord = ''
let drawHistory = [] // JSON сообщений draw/fill

// ====== Слова для угадывания ======
const words = ["кот","собака","машина","дом","дерево","река","солнце","мост","телевизор","крокодил"]

function chooseWord() {
    return words[Math.floor(Math.random() * words.length)]
}

// ====== Вспомогательные функции ======
function broadcast(msg) {
    const data = JSON.stringify(msg)
    clients.forEach(c => {
        if (c.readyState === c.OPEN) c.send(data)
    })
}

function broadcastExcept(msg, exclude) {
    const data = JSON.stringify(msg)
    clients.forEach(c => {
        if (c !== exclude && c.readyState === c.OPEN) c.send(data)
    })
}

function sendPlayerListToAll() {
    const list = Array.from(clients).map(c => ({ name: c.name, role: c.role }))
    broadcast({ type: 'player-list', players: list })
}

function startNewRound(newLeader) {
    leader = newLeader
    currentWord = chooseWord()
    drawHistory = []

    clients.forEach(c => {
        if (c === leader) {
            c.role = 'leader'
            c.send(JSON.stringify({ type: 'role', role: 'leader', name: c.name }))
            c.send(JSON.stringify({ type: 'word', word: currentWord }))
        } else {
            c.role = 'player'
            c.send(JSON.stringify({ type: 'role', role: 'player', name: c.name }))
            c.send(JSON.stringify({ type: 'clear-canvas' }))
        }
    })
    sendPlayerListToAll()
    broadcast({ type: 'system', text: 'Новый раунд начался!' })
}

function normalize(s) {
    return s.trim().toLowerCase()
}

// ====== WebSocket ======
wss.on('connection', (ws) => {
    ws.name = 'Игрок' + Math.floor(Math.random() * 100)
    ws.role = 'player'
    clients.add(ws)

    // Если нет лидера — назначаем
    if (!leader) startNewRound(ws)
    else {
        ws.send(JSON.stringify({ type: 'role', role: 'player', name: ws.name }))
        drawHistory.forEach(raw => ws.send(JSON.stringify(raw)))
    }

    sendPlayerListToAll()
    broadcast({ type: 'system', text: `${ws.name} подключился` })

    ws.on('message', (raw) => {
        let msg
        try { msg = JSON.parse(raw) } catch { return }

        switch(msg.type) {
            case 'chat':
                if (ws.role !== 'leader' && normalize(msg.text) === normalize(currentWord) && currentWord) {
                    broadcast({ type: 'system', text: `${ws.name} угадал слово "${currentWord}"!` })
                    startNewRound(ws)
                    return
                }
                broadcast({ type: 'chat', text: `${ws.name}: ${msg.text}` })
                break

            case 'draw':
            case 'fill':
                if (ws !== leader) return
                drawHistory.push(msg)
                broadcastExcept(msg, ws)
                break

            case 'clear-canvas':
                if (ws !== leader) return
                drawHistory = []
                broadcast({ type: 'clear-canvas' })
                break
        }
    })

    ws.on('close', () => {
        clients.delete(ws)
        if (ws === leader) {
            leader = null
            const next = clients.values().next().value
            if (next) startNewRound(next)
        }
        if (clients.size === 0) {
            leader = null
            currentWord = ''
            drawHistory = []
        }
        sendPlayerListToAll()
        broadcast({ type: 'system', text: `${ws.name} отключился` })
    })
})

// ====== Запуск сервера ======
server.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`)
})