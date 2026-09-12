#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu 24.04 EC2 t3.micro for Kully.
# Run as: ssh into the box, then `bash setup-ec2.sh` (as the ubuntu user, with sudo).
set -euo pipefail

echo "== swap file =="
if [ ! -f /swapfile ]; then
  sudo fallocate -l 1G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "== node 20 =="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "== caddy =="
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy

echo "== clone repo =="
if [ ! -d /home/ubuntu/kully ]; then
  read -rp "GitHub repo URL (e.g. https://github.com/you/kully.git): " REPO_URL
  git clone "$REPO_URL" /home/ubuntu/kully
fi

echo "== .env =="
if [ ! -f /home/ubuntu/kully/server/.env ]; then
  cp /home/ubuntu/kully/server/.env.example /home/ubuntu/kully/server/.env
  chmod 600 /home/ubuntu/kully/server/.env
  echo "Fill in /home/ubuntu/kully/server/.env with your API keys before starting the service."
fi

echo "== npm install =="
cd /home/ubuntu/kully/server
npm install --omit=dev

echo "== systemd service =="
sudo cp /home/ubuntu/kully/infra/kully.service /etc/systemd/system/kully.service
sudo systemctl daemon-reload
sudo systemctl enable kully

echo "== caddy config =="
sudo cp /home/ubuntu/kully/infra/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy

echo "Done. Edit /home/ubuntu/kully/server/.env, then: sudo systemctl start kully"
