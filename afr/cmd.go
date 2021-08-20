/*
Tiny CLI that implements a broadcaster, mirroring the JS CLI. Does not serve
files, other than its own client script. See `readme.md` for the explanation of
the CLI.

Installation:

	go install github.com/mitranim/afr/afr@latest

Usage:

	afr --help
	afr -v -p 23456
	afr -v
*/
package main

import (
	"flag"
	"fmt"
	"io"
	l "log"
	"net/http"
	"os"

	"github.com/mitranim/afr"
)

var log = l.New(os.Stderr, "[afr] ", 0)

func main() {
	verb := flag.Bool("v", false, "enable logging")
	port := flag.Int("p", 23456, "HTTP port")
	flag.Parse()

	if !*verb {
		log.SetOutput(io.Discard)
	}

	serve(*port)
}

func serve(port int) {
	log.Printf("listening on http://localhost:%v", port)
	try(http.ListenAndServe(fmt.Sprintf(":%v", port), new(Server)))
}

type Server struct{ afr.Broad }

func (self *Server) ServeHTTP(rew http.ResponseWriter, req *http.Request) {
	preventCaching(rew.Header())
	allowCors(rew.Header())

	if req.Method == http.MethodOptions {
		return
	}

	self.Broad.ServeHTTP(rew, req)
}

func preventCaching(head http.Header) {
	head.Set("cache-control", "no-store, max-age=0")
}

func allowCors(head http.Header) {
	head.Add("access-control-allow-credentials", "true")
	head.Add("access-control-allow-headers", "cache-control, content-type")
	head.Add("access-control-allow-methods", "OPTIONS, GET, HEAD, POST, PUT, PATCH, DELETE")
	head.Add("access-control-allow-origin", "*")
}

func try(err error) {
	if err != nil {
		panic(err)
	}
}
