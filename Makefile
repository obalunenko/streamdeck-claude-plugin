GO ?= go

TOOL_MODULES := $(sort $(wildcard tools/*/go.mod))

.DEFAULT_GOAL := tools
.PHONY: tools help

tools:
	@set -eu; \
	module_files='$(TOOL_MODULES)'; \
	if [ -z "$$module_files" ]; then \
		printf 'No Go tool modules found at tools/*/go.mod\n' >&2; \
		exit 1; \
	fi; \
	for module_file in $$module_files; do \
		module_dir="$${module_file%/go.mod}"; \
		printf 'Installing tools from %s\n' "$$module_dir"; \
		if ! (cd "$$module_dir" && $(GO) install tool); then \
			printf 'Failed to install tools from %s\n' "$$module_dir" >&2; \
			exit 1; \
		fi; \
	done

help:
	@printf '%s\n' \
		'Make targets:' \
		'  tools  Install every pinned Go tool from tools/*/go.mod (default).' \
		'  help   Show this help.' \
		'' \
		'After make tools, run task --list for project workflows.'
