MAKEFLAGS := --silent --always-make
PAR := $(MAKE) -j 128
DENO := deno run --watch --allow-net --allow-read --unstable

example:
	$(PAR) afr srv

afr:
	$(DENO) ../afr.mjs --port 34566 --verbose true

srv:
	$(DENO) srv.mjs
