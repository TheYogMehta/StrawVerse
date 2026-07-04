package room

import (
	"log"
	"sync"

	"github.com/TheYogMehta/StrawVerse/server/protocol"
)

type Room struct {
	Code      string
	Hub       *Hub
	Clients   map[*Client]byte 
	Host      *Client
	NextID    byte
	mu        sync.RWMutex
	isLoading    bool
	readyClients map[byte]bool
}

func NewRoom(code string, hub *Hub) *Room {
	return &Room{
		Code:         code,
		Hub:          hub,
		Clients:      make(map[*Client]byte),
		NextID:       1,
		readyClients: make(map[byte]bool),
	}
}

func (r *Room) Register(client *Client) {
	r.mu.Lock()

	userID := r.NextID
	r.NextID++
	r.Clients[client] = userID
	client.ID = userID

	if r.Host == nil {
		r.Host = client
		client.IsHost = true
	} else {
		client.IsHost = false
	}

	isHost := client.IsHost
	code := r.Code
	r.mu.Unlock()

	client.Send <- protocol.EncodeRoomJoined(isHost, userID, code)

	eventBuf := protocol.EncodeUserEvent(protocol.UserEventJoined, userID, client.Username)
	r.Broadcast(eventBuf, client)

	log.Printf("[Room %s] User %s (ID %d) joined. Total: %d, Host: %s",
		code, client.Username, userID, len(r.Clients), r.Host.Username)
}

func (r *Room) Unregister(client *Client) {
	r.mu.Lock()

	userID, exists := r.Clients[client]
	if !exists {
		r.mu.Unlock()
		return
	}

	delete(r.Clients, client)
	delete(r.readyClients, userID)

	if r.Host == client {
		r.Host = nil
		for c := range r.Clients {
			r.Host = c
			c.IsHost = true
			c.Send <- protocol.EncodeRoomJoined(true, c.ID, r.Code)
			break
		}
	}

	empty := len(r.Clients) == 0
	r.mu.Unlock()

	if !empty {
		eventBuf := protocol.EncodeUserEvent(protocol.UserEventLeft, userID, client.Username)
		r.Broadcast(eventBuf, client)
	} else {
		r.Hub.DestroyRoom(r.Code)
		log.Printf("[Room %s] All users left. Room destroyed.", r.Code)
	}
}

func (r *Room) Broadcast(data []byte, sender *Client) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for c := range r.Clients {
		if sender != nil && c == sender {
			continue
		}
		select {
		case c.Send <- data:
		default:
		}
	}
}

func (r *Room) HandleLoadMedia(data []byte, sender *Client) {
	r.mu.Lock()
	r.isLoading = true
	r.readyClients = make(map[byte]bool)
	r.mu.Unlock()
	r.Broadcast(data, nil)
}

func (r *Room) HandleClientReady(client *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.readyClients[client.ID] = true

	r.broadcastLocked(protocol.EncodeClientReady(client.ID), nil)

	if len(r.readyClients) >= len(r.Clients) && r.isLoading {
		r.isLoading = false
		r.broadcastLocked(protocol.EncodeStartPlayback(), nil)
		log.Printf("[Room %s] All %d clients ready. Broadcasted START_PLAYBACK.", r.Code, len(r.Clients))
	}
}

func (r *Room) BroadcastChat(data []byte, sender *Client) {
	_, msg, err := protocol.DecodeChatMsg(data)
	if err != nil {
		return
	}
	relayData := protocol.EncodeChatMsg(sender.Username, msg)
	r.Broadcast(relayData, nil)
}

func (r *Room) broadcastLocked(data []byte, sender *Client) {
	for c := range r.Clients {
		if sender != nil && c == sender {
			continue
		}
		select {
		case c.Send <- data:
		default:
		}
	}
}
