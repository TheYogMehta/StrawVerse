package room

import (
	"log"
	"time"

	"github.com/TheYogMehta/StrawVerse/server/protocol"
	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 4096 
)

type Client struct {
	ID       byte
	Username string
	Provider string
	Hub      *Hub
	Room     *Room
	Conn     *websocket.Conn
	Send     chan []byte
	IsHost   bool
	msgCounter  int
	lastReset   time.Time
}

func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	return &Client{
		Hub:       hub,
		Conn:      conn,
		Send:      make(chan []byte, 256),
		lastReset: time.Now(),
	}
}

func (c *Client) ReadPump() {
	defer func() {
		if c.Room != nil {
			c.Room.Unregister(c)
		}
		c.Conn.Close()
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("client %s read error: %v", c.Username, err)
			}
			break
		}

		if len(message) == 0 {
			continue
		}

		// max 30 messages per second
		now := time.Now()
		if now.Sub(c.lastReset) > time.Second {
			c.msgCounter = 0
			c.lastReset = now
		}
		c.msgCounter++
		if c.msgCounter > 30 {
			continue
		}

		c.handleMessage(message)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.Conn.NextWriter(websocket.BinaryMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) handleMessage(data []byte) {
	opcode := data[0]

	switch opcode {
	case protocol.OpJoinRoom:
		code, username, provider, err := protocol.DecodeJoinRoom(data)
		if err != nil {
			c.Send <- protocol.EncodeError(0x01, "Invalid join packet")
			return
		}
		if c.Username == "" {
			c.Send <- protocol.EncodeError(0x03, "MyAnimeList authentication is required")
			return
		}
		if username != c.Username {
			c.Send <- protocol.EncodeError(0x04, "Username spoofing detected")
			return
		}
		c.Provider = provider
		room, err := c.Hub.JoinOrCreateRoom(code, c)
		if err != nil {
			c.Send <- protocol.EncodeError(0x02, err.Error())
			return
		}
		c.Room = room

	case protocol.OpPlayPause, protocol.OpTimeSync, protocol.OpAddQueue:
		if c.Room != nil {
			c.Room.Broadcast(data, c)
		}

	case protocol.OpLoadMedia:
		if c.Room != nil {
			c.Room.HandleLoadMedia(data, c)
		}

	case protocol.OpClientReady:
		if c.Room != nil {
			c.Room.HandleClientReady(c)
		}

	case protocol.OpChatMsg:
		if c.Room != nil {
			c.Room.BroadcastChat(data, c)
		}

	case protocol.OpPing:
		pong := make([]byte, len(data))
		copy(pong, data)
		pong[0] = protocol.OpPong
		c.Send <- pong
	}
}
