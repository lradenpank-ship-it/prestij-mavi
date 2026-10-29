#!/bin/sh
# Çalıştır: ./baslat.sh   (Node.js 22.13 veya üstü gerekir)
cd "$(dirname "$0")"
exec node --no-warnings server.js
