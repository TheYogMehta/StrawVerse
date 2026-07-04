package protocol

import (
	"encoding/binary"
	"errors"
	"math"
)

const (
	OpJoinRoom      byte = 0x01
	OpRoomJoined    byte = 0x02
	OpUserEvent     byte = 0x03
	OpPlayPause     byte = 0x04
	OpTimeSync      byte = 0x05
	OpLoadMedia     byte = 0x06
	OpClientReady   byte = 0x07
	OpStartPlayback byte = 0x08
	OpAddQueue      byte = 0x09
	OpChatMsg       byte = 0x0A
	OpPing          byte = 0x0B
	OpPong          byte = 0x0C
	OpError         byte = 0x0D
)

const (
	UserEventJoined byte = 0x00
	UserEventLeft   byte = 0x01
)

var (
	ErrPacketTooShort = errors.New("packet too short")
	ErrInvalidOpcode  = errors.New("invalid opcode")
	ErrStringTooLong  = errors.New("string length exceeds limit")
)

func EncodeJoinRoom(roomCode string, username string, provider string) []byte {
	uLen := byte(len(username))
	pLen := byte(len(provider))
	buf := make([]byte, 1+6+1+int(uLen)+1+int(pLen))
	buf[0] = OpJoinRoom
	copy(buf[1:7], padOrTruncate(roomCode, 6))
	buf[7] = uLen
	copy(buf[8:8+int(uLen)], username)
	buf[8+int(uLen)] = pLen
	copy(buf[9+int(uLen):], provider)
	return buf
}

func DecodeJoinRoom(data []byte) (roomCode string, username string, provider string, err error) {
	if len(data) < 8 {
		return "", "", "", ErrPacketTooShort
	}
	code := string(data[1:7])
	nameLen := int(data[7])
	if len(data) < 8+nameLen {
		return "", "", "", ErrPacketTooShort
	}
	name := string(data[8 : 8+nameLen])

	prov := ""
	if len(data) > 8+nameLen {
		pLen := int(data[8+nameLen])
		if len(data) >= 9+nameLen+pLen {
			prov = string(data[9+nameLen : 9+nameLen+pLen])
		}
	}
	return code, name, prov, nil
}

func EncodeRoomJoined(isHost bool, userID byte, roomCode string, hostProvider string) []byte {
	pLen := byte(len(hostProvider))
	buf := make([]byte, 1+1+1+6+1+int(pLen))
	buf[0] = OpRoomJoined
	if isHost {
		buf[1] = 1
	} else {
		buf[1] = 0
	}
	buf[2] = userID
	copy(buf[3:9], padOrTruncate(roomCode, 6))
	buf[9] = pLen
	copy(buf[10:], hostProvider)
	return buf
}

func DecodeRoomJoined(data []byte) (isHost bool, userID byte, roomCode string, hostProvider string, err error) {
	if len(data) < 9 {
		return false, 0, "", "", ErrPacketTooShort
	}
	isHost = data[1] == 1
	userID = data[2]
	roomCode = string(data[3:9])
	hostProvider = ""
	if len(data) > 9 {
		pLen := int(data[9])
		if len(data) >= 10+pLen {
			hostProvider = string(data[10 : 10+pLen])
		}
	}
	return isHost, userID, roomCode, hostProvider, nil
}

func EncodeUserEvent(eventType byte, userID byte, username string) []byte {
	buf := make([]byte, 1+1+1+1+len(username))
	buf[0] = OpUserEvent
	buf[1] = eventType
	buf[2] = userID
	buf[3] = byte(len(username))
	copy(buf[4:], username)
	return buf
}

func DecodeUserEvent(data []byte) (eventType byte, userID byte, username string, err error) {
	if len(data) < 4 {
		return 0, 0, "", ErrPacketTooShort
	}
	eType := data[1]
	uID := data[2]
	nameLen := int(data[3])
	if len(data) < 4+nameLen {
		return 0, 0, "", ErrPacketTooShort
	}
	return eType, uID, string(data[4 : 4+nameLen]), nil
}

func EncodePlayPause(isPlaying bool, timestamp float32) []byte {
	buf := make([]byte, 1+1+4)
	buf[0] = OpPlayPause
	if isPlaying {
		buf[1] = 1
	} else {
		buf[1] = 0
	}
	binary.BigEndian.PutUint32(buf[2:6], math.Float32bits(timestamp))
	return buf
}

func DecodePlayPause(data []byte) (isPlaying bool, timestamp float32, err error) {
	if len(data) < 6 {
		return false, 0, ErrPacketTooShort
	}
	playing := data[1] == 1
	ts := math.Float32frombits(binary.BigEndian.Uint32(data[2:6]))
	return playing, ts, nil
}

func EncodeTimeSync(timestamp float32, speed float32) []byte {
	buf := make([]byte, 1+4+4)
	buf[0] = OpTimeSync
	binary.BigEndian.PutUint32(buf[1:5], math.Float32bits(timestamp))
	binary.BigEndian.PutUint32(buf[5:9], math.Float32bits(speed))
	return buf
}

func DecodeTimeSync(data []byte) (timestamp float32, speed float32, err error) {
	if len(data) < 9 {
		return 0, 0, ErrPacketTooShort
	}
	ts := math.Float32frombits(binary.BigEndian.Uint32(data[1:5]))
	sp := math.Float32frombits(binary.BigEndian.Uint32(data[5:9]))
	return ts, sp, nil
}

type MediaItem struct {
	ProviderID uint16
	AnimeID    uint32
	Episode    uint16
}

func EncodeLoadMedia(item MediaItem) []byte {
	buf := make([]byte, 1+2+4+2)
	buf[0] = OpLoadMedia
	binary.BigEndian.PutUint16(buf[1:3], item.ProviderID)
	binary.BigEndian.PutUint32(buf[3:7], item.AnimeID)
	binary.BigEndian.PutUint16(buf[7:9], item.Episode)
	return buf
}

func DecodeLoadMedia(data []byte) (MediaItem, error) {
	if len(data) < 9 {
		return MediaItem{}, ErrPacketTooShort
	}
	item := MediaItem{
		ProviderID: binary.BigEndian.Uint16(data[1:3]),
		AnimeID:    binary.BigEndian.Uint32(data[3:7]),
		Episode:    binary.BigEndian.Uint16(data[7:9]),
	}
	return item, nil
}

func EncodeClientReady(userID byte) []byte {
	return []byte{OpClientReady, userID}
}

func DecodeClientReady(data []byte) (userID byte, err error) {
	if len(data) < 2 {
		return 0, ErrPacketTooShort
	}
	return data[1], nil
}

func EncodeStartPlayback() []byte {
	return []byte{OpStartPlayback}
}

func EncodeAddQueue(item MediaItem) []byte {
	buf := make([]byte, 1+2+4+2)
	buf[0] = OpAddQueue
	binary.BigEndian.PutUint16(buf[1:3], item.ProviderID)
	binary.BigEndian.PutUint32(buf[3:7], item.AnimeID)
	binary.BigEndian.PutUint16(buf[7:9], item.Episode)
	return buf
}

func DecodeAddQueue(data []byte) (MediaItem, error) {
	return DecodeLoadMedia(data) 
}

func EncodeChatMsg(sender string, message string) []byte {
	sLen := byte(len(sender))
	mLen := uint16(len(message))
	buf := make([]byte, 1+1+int(sLen)+2+int(mLen))
	buf[0] = OpChatMsg
	buf[1] = sLen
	copy(buf[2:2+int(sLen)], sender)
	binary.BigEndian.PutUint16(buf[2+int(sLen):4+int(sLen)], mLen)
	copy(buf[4+int(sLen):], message)
	return buf
}

func DecodeChatMsg(data []byte) (sender string, message string, err error) {
	if len(data) < 4 {
		return "", "", ErrPacketTooShort
	}
	sLen := int(data[1])
	if len(data) < 4+sLen {
		return "", "", ErrPacketTooShort
	}
	sName := string(data[2 : 2+sLen])
	mLen := int(binary.BigEndian.Uint16(data[2+sLen : 4+sLen]))
	if len(data) < 4+sLen+mLen {
		return "", "", ErrPacketTooShort
	}
	msg := string(data[4+sLen : 4+sLen+mLen])
	return sName, msg, nil
}

func EncodeError(errCode byte, message string) []byte {
	mLen := uint16(len(message))
	buf := make([]byte, 1+1+2+int(mLen))
	buf[0] = OpError
	buf[1] = errCode
	binary.BigEndian.PutUint16(buf[2:4], mLen)
	copy(buf[4:], message)
	return buf
}

func DecodeError(data []byte) (errCode byte, message string, err error) {
	if len(data) < 4 {
		return 0, "", ErrPacketTooShort
	}
	code := data[1]
	mLen := int(binary.BigEndian.Uint16(data[2:4]))
	if len(data) < 4+mLen {
		return 0, "", ErrPacketTooShort
	}
	return code, string(data[4 : 4+mLen]), nil
}

func padOrTruncate(s string, length int) string {
	if len(s) >= length {
		return s[:length]
	}
	padded := make([]byte, length)
	copy(padded, s)
	for i := len(s); i < length; i++ {
		padded[i] = ' '
	}
	return string(padded)
}
