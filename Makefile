EXTENSION_DIR = "foresight@pesader.dev"
EXTENSION_ARCHIVE = "$(EXTENSION_DIR).shell-extension.zip"

all: build install

.PHONY: build install run clean lint lint-fix lint-install

build:
	gnome-extensions pack --force $(EXTENSION_DIR)

install: build
	gnome-extensions install $(EXTENSION_ARCHIVE) --force

run:
	env MUTTER_DEBUG_DUMMY_MODE_SPECS=1256x768 dbus-run-session -- gnome-shell --nested --wayland

run-multimonitor:
	env MUTTER_DEBUG_NUM_DUMMY_MONITORS=2 dbus-run-session -- gnome-shell --nested --wayland

clean:
	rm -f $(EXTENSION_ARCHIVE)
	rm -rf docs/

lint:
	npx eslint "**/*.js" --no-warn-ignored

lint-fix:
	npx eslint "**/*.js" --no-warn-ignored --fix

lint-install:
	npm install --user eslint@9.19.0 eslint-plugin-jsdoc --save-dev
