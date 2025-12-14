# CAIMEO Raspberry Pi Deployment Guide

These steps assume a Raspberry Pi running Debian/Raspberry Pi OS with Cloudflare DNS + Tunnel and nginx serving the built React
UI.

## 1) Cloudflare DNS (remove Pages, point to the tunnel)
Delete any Cloudflare DNS records that point `caspercaimeo.com` or `www` to Cloudflare Pages (e.g., `caimeov1.pages.dev`). Then add
proxied CNAMEs for the tunnel hostname (replace `<tunnel-id>` with your value):

```
CNAME caspercaimeo.com   <tunnel-id>.cfargotunnel.com   (Proxied, TTL Auto)
CNAME www                <tunnel-id>.cfargotunnel.com   (Proxied, TTL Auto)
CNAME api                <tunnel-id>.cfargotunnel.com   (Proxied, TTL Auto)
```

## 2) Install system packages
These steps assume a Raspberry Pi running Debian/Raspberry Pi OS with Cloudflare DNS + Tunnel and nginx serving the built React UI.

## 1) Install system packages
```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip nodejs npm nginx cloudflared
```

## 3) Clone the repository
## 2) Clone the repository
```bash
cd /home/pi
git clone https://github.com/caspercaimeo-alt/CaimeoV1.git
cd CaimeoV1
```

## 4) Python virtual environment
## 3) Python virtual environment
```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 5) Environment variables
## 4) Environment variables
Copy the example env and fill in secrets (do not commit the real file):
```bash
cp deploy/env/.env.example .env
nano .env
```

## 6) Build the frontend (production)
## 5) Build the frontend
```bash
cd alpaca-ui
npm install
npm run build
cd ..
```

## 7) nginx configuration (serves the build + /api proxy)
## 6) nginx configuration
```bash
sudo cp deploy/nginx/caspercaimeo.conf /etc/nginx/sites-available/caspercaimeo.conf
sudo ln -sf /etc/nginx/sites-available/caspercaimeo.conf /etc/nginx/sites-enabled/caspercaimeo.conf
sudo nginx -t
sudo systemctl restart nginx
```
Important: the `/api/` location is defined *before* the SPA fallback. Keep the trailing slash on `proxy_pass` so `/api/foo`
forwards to `/foo` in FastAPI (no HTML fallbacks). nginx serves the React build at `/home/pi/CaimeoV1/alpaca-ui/build`, proxies
`/api/` to `http://127.0.0.1:8000/`, and adds `X-CAIMEO-ORIGIN: raspberry-pi-nginx` to responses for verification.
`/api/` to `http://127.0.0.1:8000/`, and adds `X-CAIMEO-ORIGIN: raspberry-pi` to responses for verification.
nginx serves the React build at `/home/pi/CaimeoV1/alpaca-ui/build`, proxies `/api/` to `http://127.0.0.1:8000/`, and adds
`X-CAIMEO-ORIGIN: raspberry-pi` to responses for verification.

## 8) Cloudflare Tunnel
1. Authenticate Cloudflare (`cloudflared login`) and create a tunnel named `caimeo`.
2. Place the credentials file at `/etc/cloudflared/caimeo.json` (default path referenced in config).
3. Copy the example config and adjust hostnames/paths if needed, then move it into place:
```bash
sudo mkdir -p /etc/cloudflared
sudo cp deploy/cloudflared/config.yml.example /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml
```
   The config should include ingress for `caspercaimeo.com`, `www.caspercaimeo.com`, and `api.caspercaimeo.com`, routing 80/8080
   to nginx and 8000 to FastAPI.
4. Verify DNS entries point to the tunnel hostname (see step 1).

## 9) Systemd services
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

The backend service runs `uvicorn server:app --host 127.0.0.1 --port 8000` using the virtualenv at `/home/pi/CaimeoV1/venv` and
environment from `/home/pi/CaimeoV1/.env`. The Cloudflare service uses `/etc/cloudflared/config.yml` and restarts on failure.

## 10) Updating
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

## 11) Verification
- Visit https://caspercaimeo.com to load the UI via Cloudflare. The UI should call `/api` (tunneled to the Pi).
- Visit https://api.caspercaimeo.com/docs to confirm the FastAPI docs are reachable through the tunnel.
- Confirm responses show the origin header:
```bash
curl -I https://caspercaimeo.com
```
The response headers should include `X-CAIMEO-ORIGIN: raspberry-pi-nginx`.
- Local verification on the Pi (should return JSON, never `<!DOCTYPE`):
```bash
curl -i http://127.0.0.1:8080/api/auth
curl -i http://127.0.0.1:8080/api/logs | head
```

- Public verification through Cloudflare Tunnel (look for the proof header and JSON):
```bash
curl -i https://caspercaimeo.com/api/auth | sed -n '1,30p'
```
All three checks should show JSON (or FastAPI JSON errors) with `/api/*` routed through nginx to the backend and headers including
`X-CAIMEO-ORIGIN: raspberry-pi-nginx`.
The response headers should include `X-CAIMEO-ORIGIN: raspberry-pi`.
- Ensure API routes never return HTML (no `<!DOCTYPE` in responses):
```bash
curl -i http://127.0.0.1:8080/api/auth
curl -i http://127.0.0.1:8080/api/logs
curl -i https://caspercaimeo.com/api/auth
```
All three should return JSON (or FastAPI JSON errors) with `/api/*` routed through nginx to the backend.
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
