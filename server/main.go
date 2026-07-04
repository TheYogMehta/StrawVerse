package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/TheYogMehta/StrawVerse/server/room"
)

func main() {
	port := "5610"

	hub := room.NewHub()

	http.HandleFunc("/ws", hub.ServeWS)

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		activeRooms, activeClients := hub.GetStats()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":         "ok",
			"server":         "StrawVerse Watch Together",
			"active_rooms":   activeRooms,
			"active_clients": activeClients,
		})
	})

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprintf(w, "StrawVerse Watch Together WebSocket Server is running.\nConnect via WebSocket to /ws")
	})

	log.Printf("StrawVerse Watch Together server starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
