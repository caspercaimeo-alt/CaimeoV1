# CAIMEO Raspberry Pi Deployment Guide

These steps assume a Raspberry Pi running Debian/Raspberry Pi OS with Cloudflare DNS + Tunnel and nginx serving the built React UI.

## 1) Install system packages
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm nginx cloudflared
```

## 2) Clone the repository
```bash
cd /home/pi
git clone https://github.com/caspercaimeo-alt/CaimeoV1.git
cd CaimeoV1
```

## 3) Python virtual environment
```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 4) Environment variables
Copy the example env and fill in secrets (do not commit the real file):
```bash
cp deploy/env/.env.example .env
nano .env
```

## 5) Build the frontend
```bash
cd alpaca-ui
npm install
npm run build
cd ..
```

## 6) nginx configuration
```bash
sudo cp deploy/nginx/caspercaimeo.conf /etc/nginx/sites-available/caspercaimeo.conf
sudo ln -sf /etc/nginx/sites-available/caspercaimeo.conf /etc/nginx/sites-enabled/caspercaimeo.conf
sudo nginx -t
sudo systemctl restart nginx
```
nginx serves the React build at `/home/pi/CaimeoV1/alpaca-ui/build` and proxies `/api/` to `http://127.0.0.1:8000/`.

## 7) Cloudflare Tunnel
1. Authenticate Cloudflare (`cloudflared login`) and create a tunnel named `caimeo`.
2. Place the credentials file at `/home/pi/.cloudflared/caimeo.json` (default path referenced in config).
3. Copy the example config and adjust hostnames/paths if needed:
```bash
cp deploy/cloudflared/config.yml.example deploy/cloudflared/config.yml
```
4. Verify DNS entries for `caspercaimeo.com` and `api.caspercaimeo.com` point to the tunnel.

## 8) Systemd services
Copy service files into systemd and reload units:
```bash
sudo cp deploy/systemd/caimeo-backend.service /etc/systemd/system/caimeo-backend.service
sudo cp deploy/systemd/cloudflared-caimeo.service /etc/systemd/system/cloudflared-caimeo.service
sudo systemctl daemon-reload
sudo systemctl enable --now caimeo-backend
sudo systemctl enable --now cloudflared-caimeo
```

The backend service runs `uvicorn server:app --host 127.0.0.1 --port 8000` using the virtualenv at `/home/pi/CaimeoV1/venv` and environment from `/home/pi/CaimeoV1/.env`. The Cloudflare service uses the config at `/home/pi/CaimeoV1/deploy/cloudflared/config.yml`.

## 9) Updating
Pull new code, rebuild the frontend, reinstall dependencies if needed, then restart services:
```bash
cd /home/pi/CaimeoV1
git pull
source venv/bin/activate
pip install -r requirements.txt
cd alpaca-ui && npm install && npm run build && cd ..
sudo systemctl restart caimeo-backend
sudo systemctl restart cloudflared-caimeo
sudo systemctl restart nginx
```

## 10) Verification
- Visit https://caspercaimeo.com to load the UI via Cloudflare.
- Confirm API calls use `/api` or https://api.caspercaimeo.com.
- Check service status if anything fails:
```bash
sudo systemctl status caimeo-backend
sudo systemctl status cloudflared-caimeo
sudo journalctl -u caimeo-backend -n 200 --no-pager
sudo journalctl -u cloudflared-caimeo -n 200 --no-pager
```
