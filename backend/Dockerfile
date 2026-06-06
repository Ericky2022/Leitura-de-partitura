FROM node:20-bookworm

ENV NODE_ENV=production
ENV AUDIVERIS_CMD=/usr/local/bin/audiveris

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    python3 \
  && rm -rf /var/lib/apt/lists/*

RUN python3 - <<'PY'
import json
import pathlib
import re
import urllib.request

api_url = "https://api.github.com/repos/Audiveris/audiveris/releases/latest"
release = json.load(urllib.request.urlopen(api_url))
assets = release.get("assets", [])
pattern = re.compile(r"ubuntu(24\.04|22\.04).*x86_64\.deb$", re.I)
asset = next((item for item in assets if pattern.search(item.get("name", ""))), None)

if asset is None:
    raise SystemExit("Nao encontrei o instalador Linux do Audiveris no release mais recente.")

pathlib.Path("/tmp/audiveris.deb").write_bytes(
    urllib.request.urlopen(asset["browser_download_url"]).read()
)
PY

RUN apt-get update \
  && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
  || true \
  && mkdir -p /usr/share/applications /usr/share/desktop-directories \
  && dpkg --configure -a \
  && rm -rf /var/lib/apt/lists/* /tmp/audiveris.deb \
  && AUDIVERIS_BIN="$(find /opt /usr -type f \( -iname audiveris -o -iname Audiveris \) -perm /111 2>/dev/null | head -n 1)" \
  && test -n "$AUDIVERIS_BIN" \
  && ln -sf "$AUDIVERIS_BIN" /usr/local/bin/audiveris

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./

EXPOSE 3001

CMD ["node", "server.js"]
