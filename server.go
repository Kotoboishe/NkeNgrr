package main

import (
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	conn *websocket.Conn
	name string
	role string // "leader" | "player"
}

type DrawMsg struct {
	Type  string  `json:"type"` // "draw"
	PrevX float64 `json:"prevX"`
	PrevY float64 `json:"prevY"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Color string  `json:"color"`
	Size  float64 `json:"size"`
	Tool  string  `json:"tool"` // "brush" | "eraser"
}

type FillMsg struct {
	Type  string `json:"type"` // "fill"
	Color string `json:"color"`
}

type ChatMsg struct {
	Type string `json:"type"` // "chat"
	Text string `json:"text"`
}

type SimpleMsg struct {
	Type string `json:"type"` // "system", "clear-canvas"
	Text string `json:"text,omitempty"`
}

type RoleMsg struct {
	Type string `json:"type"` // "role"
	Role string `json:"role"` // "leader" | "player"
	Name string `json:"name"`
}

type WordMsg struct {
	Type string `json:"type"` // "word"
	Word string `json:"word"`
}

type PlayerListMsg struct {
	Type    string        `json:"type"` // "player-list"
	Players []PlayerBrief `json:"players"`
}
type PlayerBrief struct {
	Name string `json:"name"`
	Role string `json:"role"`
}

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	clients    = make(map[*Client]struct{})
	clientsMux sync.Mutex

	leader      *Client
	currentWord string

	// история холста для новых подключений
	drawHistory []json.RawMessage // хранит сырые JSON событий "draw"/"fill"
)

func main() {
	rand.Seed(time.Now().UnixNano())

	// Раздаём статику
	publicPath := filepath.Join(".", "public")
	http.Handle("/", http.FileServer(http.Dir(publicPath)))

	// WebSocket endpoint
	http.HandleFunc("/ws", wsHandler)

	log.Println("Сервер запущен: http://localhost:8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade:", err)
		return
	}
	defer conn.Close()

	client := &Client{
		conn: conn,
		name: "Игрок" + strconv.Itoa(rand.Intn(100)),
		role: "player",
	}

	registerClient(client)
	defer unregisterClient(client)

	// Если лидера нет — стартуем новый раунд с этим клиентом
	clientsMux.Lock()
	if leader == nil {
		startNewRound(client)
	} else {
		// Отправляем роль игроку
		sendJSON(client, RoleMsg{Type: "role", Role: "player", Name: client.name})
		// Высылаем историю холста
		for _, raw := range drawHistory {
			_ = client.conn.WriteMessage(websocket.TextMessage, raw)
		}
	}
	clientsMux.Unlock()

	// При подключении обновим список игроков
	sendPlayerListToAll()

	// Сообщение в систему
	broadcast(SimpleMsg{Type: "system", Text: client.name + " подключился"})

	// Читаем входящие
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			log.Println("read:", err)
			break
		}
		handleIncoming(client, data)
	}
}

func registerClient(c *Client) {
	clientsMux.Lock()
	defer clientsMux.Unlock()
	clients[c] = struct{}{}
}

func unregisterClient(c *Client) {
	clientsMux.Lock()
	defer clientsMux.Unlock()

	delete(clients, c)

	// Если ушёл лидер — назначаем нового (первого попавшегося) и стартуем раунд
	if leader == c {
		leader = nil
		for cl := range clients {
			startNewRound(cl) // стартуем с новым лидером
			break
		}
	}
	// Если все ушли — обнулим состояние
	if len(clients) == 0 {
		leader = nil
		currentWord = ""
		drawHistory = nil
	}
	sendPlayerListToAll()
	broadcast(SimpleMsg{Type: "system", Text: c.name + " отключился"})
}

func handleIncoming(sender *Client, raw []byte) {
	// Определим тип
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return
	}

	switch envelope.Type {
	case "chat":
		var msg ChatMsg
		if json.Unmarshal(raw, &msg) == nil {
			// Лидер не угадывает; игроки могут
			if sender.role != "leader" {
				// Проверка угадывания
				if normalize(msg.Text) == normalize(currentWord) && currentWord != "" {
					broadcast(SimpleMsg{Type: "system", Text: sender.name + ` угадал слово "` + currentWord + `"!`})
					startNewRound(sender)
					return
				}
			}
			// Обычный чат
			broadcast(ChatMsg{Type: "chat", Text: sender.name + ": " + msg.Text})
		}

	case "draw":
		// Рисовать может только лидер
		if sender != leader {
			return
		}
		// сохранить в историю и разослать всем, кроме лидера
		var msg DrawMsg
		if json.Unmarshal(raw, &msg) == nil {
			appendHistory(raw)
			broadcastExcept(raw, sender)
		}

	case "fill":
		if sender != leader {
			return
		}
		var msg FillMsg
		if json.Unmarshal(raw, &msg) == nil {
			appendHistory(raw)
			broadcastExcept(raw, sender)
		}

	case "clear-canvas":
		if sender != leader {
			return
		}
		drawHistory = nil
		broadcast(SimpleMsg{Type: "clear-canvas"})

	default:
		// игнорируем неизвестные типы
	}
}

func startNewRound(newLeader *Client) {
	leader = newLeader
	currentWord = chooseWord()
	drawHistory = nil

	// Разошлём роли и очистим холсты игроков
	for c := range clients {
		if c == leader {
			c.role = "leader"
			sendJSON(c, RoleMsg{Type: "role", Role: "leader", Name: c.name})
			sendJSON(c, WordMsg{Type: "word", Word: currentWord})
		} else {
			c.role = "player"
			sendJSON(c, RoleMsg{Type: "role", Role: "player", Name: c.name})
			sendJSON(c, SimpleMsg{Type: "clear-canvas"})
		}
	}
	sendPlayerListToAll()
	broadcast(SimpleMsg{Type: "system", Text: "Новый раунд начался!"})
}

func chooseWord() string {
	words := []string{"кот", "собака", "машина", "дом", "дерево", "река", "солнце", "мост", "телевизор", "крокодил"}
	return words[rand.Intn(len(words))]
}

func sendPlayerListToAll() {
	clientsMux.Lock()
	defer clientsMux.Unlock()
	var list []PlayerBrief
	for c := range clients {
		list = append(list, PlayerBrief{Name: c.name, Role: c.role})
	}
	msg := PlayerListMsg{Type: "player-list", Players: list}
	for c := range clients {
		_ = c.conn.WriteJSON(msg)
	}
}

func sendJSON(c *Client, v any) {
	_ = c.conn.WriteJSON(v)
}

func broadcast(v any) {
	clientsMux.Lock()
	defer clientsMux.Unlock()
	for c := range clients {
		_ = c.conn.WriteJSON(v)
	}
}

func broadcastExcept(raw []byte, exclude *Client) {
	clientsMux.Lock()
	defer clientsMux.Unlock()
	for c := range clients {
		if c != exclude {
			_ = c.conn.WriteMessage(websocket.TextMessage, raw)
		}
	}
}

func appendHistory(raw []byte) {
	// Храним только draw/fill, чтобы новые игроки получали текущее состояние
	drawHistory = append(drawHistory, json.RawMessage(append([]byte(nil), raw...)))
}

func normalize(s string) string {
	// простая нормализация: трим и в нижний регистр
	return stringsTrimLower(s)
}

// без лишних импортов:
func stringsTrimLower(s string) string {
	b := []rune(s)
	// trim spaces
	i := 0
	j := len(b) - 1
	for i <= j && (b[i] == ' ' || b[i] == '\t' || b[i] == '\n' || b[i] == '\r') {
		i++
	}
	for j >= i && (b[j] == ' ' || b[j] == '\t' || b[j] == '\n' || b[j] == '\r') {
		j--
	}
	if i > j {
		return ""
	}
	// to lower (ASCII хватит для наших слов; если нужны диакритики — подключим strings.ToLower)
	out := make([]rune, j-i+1)
	for k := range out {
		r := b[i+k]
		if r >= 'A' && r <= 'Z' {
			r += 32
		}
		out[k] = r
	}
	return string(out)
}
