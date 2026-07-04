package room

import (
	"crypto/rand"
	"math/big"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

const roomCodeCharset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"

type Hub struct {
	rooms map[string]*Room
	mu    sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
	}
}

func (h *Hub) JoinOrCreateRoom(code string, client *Client) (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	code = strings.TrimSpace(code)

	if code == "" || code == "CREATE" || code == "      " {
		var newCode string
		for {
			newCode = generateCode(6)
			if _, exists := h.rooms[newCode]; !exists {
				break
			}
		}
		room := NewRoom(newCode, h)
		h.rooms[newCode] = room
		room.Register(client)
		return room, nil
	}

	room, exists := h.rooms[code]
	if !exists {
		room = NewRoom(code, h)
		h.rooms[code] = room
	}

	room.Register(client)
	return room, nil
}

func (h *Hub) DestroyRoom(code string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.rooms, code)
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := NewClient(h, conn)
	go client.WritePump()
	go client.ReadPump()
}

func (h *Hub) GetStats() (activeRooms int, activeClients int) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	activeRooms = len(h.rooms)
	for _, room := range h.rooms {
		room.mu.RLock()
		activeClients += len(room.Clients)
		room.mu.RUnlock()
	}
	return activeRooms, activeClients
}

func generateCode(length int) string {
	b := make([]byte, length)
	charsetLen := big.NewInt(int64(len(roomCodeCharset)))
	for i := range b {
		n, err := rand.Int(rand.Reader, charsetLen)
		if err != nil {
			b[i] = roomCodeCharset[i%len(roomCodeCharset)]
		} else {
			b[i] = roomCodeCharset[n.Int64()]
		}
	}
	return string(b)
}
