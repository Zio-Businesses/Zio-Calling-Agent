# Master VPS Deployment Guide: Sync, Sync, and SSL

This guide shows you how to move your current local setup (with all our Docker and dependency fixes) to a Linux VPS using your GitHub repository.

## 🛠️ Part 1: VPS Server Preparation
Connect to your VPS (Ubuntu 22.04/24.04 recommended) and run these commands to install the engine.

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Install Docker & Compose
sudo apt install -y docker.io docker-compose-v2 git nginx certbot python3-certbot-nginx

# 3. Enable Docker for user
sudo usermod -aG docker $USER
# (Logout and login again for this to take effect)
```

## 🔄 Part 2: Synchronizing Your Setup
Instead of uploading files, we will use your new repository.

```bash
# 1. Clone your repository
git clone https://github.com/Zio-Businesses/Zio-Calling-Agent.git
cd Zio-Calling-Agent

# 2. Create the .env from your local one
# (Copy-paste the contents of your local .env into this file)
nano .env
```

> [!IMPORTANT]
> Since we removed the database port mapping for security, your VPS `.env` should use:
> `DATABASE_URL=postgresql://agentlabs:agentlabs_pass@db:5432/agentlabs`

## 🚀 Part 3: Deployment (Docker)
We use the exact same configuration that is working on your machine.

```bash
# 1. Start the containers (this will build the image on the VPS)
docker compose up -d --build

# 2. Initialize the Database (Exactly like we did locally)
docker exec -it agentlabs-app npm run db:push
docker exec -it agentlabs-app npm run db:seed
```

## 🌏 Part 4: Nginx Reverse Proxy (SSL Ready)
We want to point your domain (e.g., `agent.yourdomain.com`) to the Docker container.

```bash
# 1. Create Nginx config
sudo nano /etc/nginx/sites-available/agentlabs
```

**Paste this block:**
```nginx
server {
    listen 80;
    server_name your-domain.com; # <--- Replace with your domain

    # Increase upload limits for knowledge base files
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

```bash
# 2. Enable and test Nginx
sudo ln -s /etc/nginx/sites-available/agentlabs /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 🔒 Part 5: One-Command SSL
Now that Nginx is pointing to your app, let's secure it.

```bash
# 1. Run Certbot to get the padlock
sudo certbot --nginx -d your-domain.com

# 2. Test SSL auto-renewal (it lasts forever)
sudo certbot renew --dry-run
```

---
## 🏁 Summary Checklist
- [ ] Domain points to VPS IP (A Record).
- [ ] `.env` has correct database URL for internal Docker.
- [ ] `db:seed` has been run on the VPS container.
- [ ] Port 80 and 443 are open in the VPS firewall (UFW).
