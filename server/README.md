# StrawVerse Watch Together Server

WebSocket server written in Go for synchronized playback in StrawVerse.

## Overview

- In-memory room management without database storage.
- Binary WebSockets protocol for playback events, media loading, chat, and queue sync.
- Rooms auto-destroy when all participants disconnect.

## Binary Protocol Specification

| Opcode | Hex    | Name                | Payload Structure                                                              |
| :----- | :----- | :------------------ | :----------------------------------------------------------------------------- |
| 1      | `0x01` | `OP_JOIN_ROOM`      | `[1B Opcode][6B RoomCode][1B NameLen][NameStr]`                                |
| 2      | `0x02` | `OP_ROOM_JOINED`    | `[1B Opcode][1B IsHost (0/1)][1B UserID][6B RoomCode]`                         |
| 3      | `0x03` | `OP_USER_EVENT`     | `[1B Opcode][1B EventType (0=Joined, 1=Left)][1B UserID][1B NameLen][NameStr]` |
| 4      | `0x04` | `OP_PLAY_PAUSE`     | `[1B Opcode][1B State (0=Pause, 1=Play)][4B Timestamp Float32]`                |
| 5      | `0x05` | `OP_TIME_SYNC`      | `[1B Opcode][4B Timestamp Float32][4B Speed Float32]`                          |
| 6      | `0x06` | `OP_LOAD_MEDIA`     | `[1B Opcode][2B ProviderID][4B AnimeID][2B Episode]`                           |
| 7      | `0x07` | `OP_CLIENT_READY`   | `[1B Opcode][1B UserID]`                                                       |
| 8      | `0x08` | `OP_START_PLAYBACK` | `[1B Opcode]`                                                                  |
| 9      | `0x09` | `OP_ADD_QUEUE`      | `[1B Opcode][2B ProviderID][4B AnimeID][2B Episode]`                           |
| 10     | `0x0A` | `OP_CHAT_MSG`       | `[1B Opcode][1B SenderLen][SenderStr][2B MsgLen][MsgStr]`                      |
| 11     | `0x0B` | `OP_PING`           | `[1B Opcode][8B ClientTime UnixNano]`                                          |
| 12     | `0x0C` | `OP_PONG`           | `[1B Opcode][8B ClientTime UnixNano]`                                          |
| 13     | `0x0D` | `OP_ERROR`          | `[1B Opcode][1B ErrCode][2B MsgLen][MsgStr]`                                   |

## Building & Running

```bash
# Build binary
go build -o strawverse-server main.go

# Run server
./strawverse-server
```

## Environment Variables

| Variable | Default | Description                          |
| :------- | :------ | :----------------------------------- |
| `PORT`   | `5610`  | Port for the HTTP & WebSocket server |
