MAKEFLAGS := --silent --always-make
PAR := $(MAKE) -j 128
DENO := deno run --watch --allow-net --allow-read

example:
	$(PAR) afr srv

afr:
	$(DENO) ../afr.ts --port 34566 --verbose true

srv:
	$(DENO) srv.ts
