# Must be run from this directory (`./examples`):
#
#   make example-node
#   make example-deno

MAKEFLAGS := --silent --always-make
PAR := $(MAKE) -j 128
DENO := deno run --watch --allow-net --allow-read

default:
	echo please run 'make example-node' or 'make example-deno'

example-node:
	$(PAR) afr-node srv-node

example-deno:
	$(PAR) afr-deno srv-deno

afr-node:
	node ../afr_node.mjs --port 34566 --verbose true

afr-deno:
	$(DENO) ../afr_deno.mjs --port 34566 --verbose true

srv-node:
	node srv_node.mjs

srv-deno:
	$(DENO) srv_deno.mjs
