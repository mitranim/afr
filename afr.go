/*
Tiny library for integrating "live reload" into your HTTP server.
Dependency-free. See `readme.md` for documentation.

Installation:

	go install github.com/mitranim/afr/afr@latest
*/
package afr

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
)

//go:embed client.mjs
var client string

/*
Source code of `client.mjs`, the client part of Afr. Exported "just in case".
The script is served by `Broad.ServeHTTP` on `/afr/client.mjs`. To use the
client, include the following into your HTML, changing the port as needed:

	<script type="module" src="http://localhost:23456/afr/client.mjs"></script>
*/
var ClientScript = scriptExec(client)

/*
Short for "broadcaster". Serves various Afr endpoints. See `readme.md` for
documentation. Functionality is equivalent between Go and JS.
*/
type Broad struct {
	lock  sync.Mutex
	chans map[int]chan chunk
	count int
}

/*
Implements `http.Handler`. Serves various Afr endpoints. See `readme.md` for
documentation. Functionality is equivalent between Go and JS.
*/
func (self *Broad) ServeHTTP(rew http.ResponseWriter, req *http.Request) {
	method, path := req.Method, req.URL.Path

	if method == http.MethodGet && path == `/afr/client.mjs` {
		self.getClient(rew, req)
		return
	}

	if method == http.MethodGet && path == `/afr/event` {
		self.getEvent(rew, req)
		return
	}

	if method == http.MethodGet && path == `/afr/events` {
		self.getEvents(rew, req)
		return
	}

	if method == http.MethodPost && path == `/afr/send` {
		self.postSend(rew, req)
		return
	}

	rew.WriteHeader(http.StatusNotFound)
	fmt.Fprintf(rew, `no endpoint for %v %q`, method, path)
}

/*
Broadcasts the data to all connected clients. For clients waiting on
"/afr/event", this is sent as the complete response body, closing the
connection. For clients waiting on "/afr/events", this is sent as one message
in the data stream, keeping the connection open.
*/
func (self *Broad) Send(val []byte) {
	self.lock.Lock()
	defer self.lock.Unlock()

	for _, ch := range self.initChans() {
		ch <- val
	}
}

// Shortcut for broadcasting a JSON-encoded msg via `Broad.Send`.
func (self *Broad) SendMsg(msg Msg) {
	self.Send(tryByteSlice(json.Marshal(msg)))
}

func (self *Broad) getClient(rew http.ResponseWriter, _ *http.Request) {
	rew.Header().Set(`Content-Type`, `application/javascript`)
	tryInt(io.WriteString(rew, ClientScript))
}

func (self *Broad) getEvent(rew http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	key, events := self.tee()
	defer self.del(key)

	select {
	case <-ctx.Done():
		return
	case event := <-events:
		tryInt(rew.Write(event))
	}
}

func (self *Broad) getEvents(rew http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	key, events := self.tee()
	defer self.del(key)

	eventStreamInit(rew, req)

	for {
		select {
		case <-ctx.Done():
			return
		case event := <-events:
			eventStreamWrite(rew, event)
		}
	}
}

func (self *Broad) postSend(rew http.ResponseWriter, req *http.Request) {
	self.Send(tryByteSlice(io.ReadAll(req.Body)))
}

func (self *Broad) tee() (int, chan chunk) {
	val := make(chan chunk, 1)

	self.lock.Lock()
	defer self.lock.Unlock()

	self.count++
	key := self.count

	self.initChans()[key] = val
	return key, val
}

func (self *Broad) del(key int) {
	self.lock.Lock()
	defer self.lock.Unlock()
	delete(self.initChans(), key)
}

// Must be called under mutex.
func (self *Broad) initChans() map[int]chan chunk {
	if self.chans == nil {
		self.chans = make(map[int]chan chunk)
	}
	return self.chans
}

/*
Message type understood by `client.mjs`. You should use a file-watching library
to watch files, convert file events into Afr msgs, and send them via `Broad`.

To simply reload the page, use the following:

	bro.SendMsg(afr.Msg{Type: `change`})

To reinject CSS, use something like:

	bro.SendMsg(afr.Msg{Type: `change`, Path: `/styles/main.css`})
*/
type Msg struct {
	Type string `json:"type,omitempty"`
	Path string `json:"path,omitempty"`
}

type chunk []byte

func eventStreamInit(rew http.ResponseWriter, req *http.Request) {
	rew.Header().Set(`Content-Type`, `text/event-stream`)
	flush(rew)
}

func eventStreamWrite(rew http.ResponseWriter, val []byte) {
	tryInt(io.WriteString(rew, `data: `))
	tryInt(rew.Write(val))
	tryInt(io.WriteString(rew, "\n\n"))
	flush(rew)
}

func scriptExec(val string) string {
	val = strings.TrimSpace(val)
	val = strings.TrimPrefix(val, `export `)
	return `void ` + val + `()`
}

func flush(rew http.ResponseWriter) { rew.(http.Flusher).Flush() }

func tryByteSlice(val []byte, err error) []byte { try(err); return val }
func tryInt(val int, err error) int             { try(err); return val }

func try(err error) {
	if err != nil {
		panic(err)
	}
}
