#!/bin/bash
# Deal Pros Paperclip — DigitalOcean Droplet Setup Script
# Run this on a fresh Ubuntu 22.04 droplet as root.
#
# Usage: bash setup-droplet.sh
#
# After running, set environment variables in /etc/environment,
# then: source /etc/environment && cd /home/paperclip/termsforsale-site/jobs && pm2 start ecosystem.config.js

set -e

echo "=== Deal Pros Paperclip — Droplet Setup ==="

# 1. System updates
echo ">>> Updating system packages..."
apt-get update -y && apt-get upgrade -y

# 2. Install Node.js 18 LTS
echo ">>> Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

echo "Node.js version: $(node -v)"
echo "npm version: $(npm -v)"

# 3. Install PM2 globally
echo ">>> Installing PM2..."
npm install -g pm2

# 4. Install git
echo ">>> Installing git..."
apt-get install -y git

# 5. Create paperclip user
echo ">>> Creating paperclip user..."
if ! id paperclip &>/dev/null; then
  adduser --disabled-password --gecos "Paperclip AI" paperclip
fi

# 6. Clone the repo
echo ">>> Cloning repo..."
cd /home/paperclip
if [ ! -d "termsforsale-site" ]; then
  sudo -u paperclip git clone https://github.com/brooke-wq/termsforsale-site.git
fi
cd termsforsale-site

# 7. Set up PM2 to start on boot
echo ">>> Configuring PM2 startup..."
pm2 startup systemd -u paperclip --hp /home/paperclip
env PATH=$PATH:/usr/bin pm2 startup systemd -u paperclip --hp /home/paperclip

echo ""
echo "=== Setup Complete ==="
echo ""
echo "NEXT STEPS:"
echo "1. Add environment variables to /etc/environment:"
echo "   sudo nano /etc/environment"
echo "   Add these lines (replace with actual values):"
echo '   ANTHROPIC_API_KEY="sk-ant-..."'
echo '   GHL_API_KEY="..."'
echo '   GHL_LOCATION_ID="7IyUgu1zpi38MDYpSDTs"'
echo '   GHL_LOCATION_ID_TERMS="..."'
echo '   GHL_LOCATION_ID_ACQASSIST="..."'
echo '   GHL_LOCATION_ID_DISPO="7IyUgu1zpi38MDYpSDTs"'
echo '   BROOKE_PHONE="+1..."'
echo '   NOTION_TOKEN="..."'
echo '   NOTION_DB_ID="a3c0a38fd9294d758dedabab2548ff29"'
echo '   CEO_BRIEFING_CONTACT_ID="..."'
echo ""
echo "2. Source the environment and start PM2:"
echo "   source /etc/environment"
echo "   su - paperclip"
echo "   cd /home/paperclip/termsforsale-site/jobs"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo ""
echo "3. Verify:"
echo "   pm2 list"
echo "   pm2 logs --lines 20"
