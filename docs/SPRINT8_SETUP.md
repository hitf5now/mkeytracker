# Sprint 8 Feature Setup Guide

This guide walks through enabling all new features from Sprint 8 (UX Overhaul). Three things need configuration:

1. **Discord OAuth** — website sign-in with Discord
2. **Event Channel** — where the bot posts event embeds from web-created events
3. **Production environment variables** — wiring it all together

---

## 1. Discord OAuth (Website Sign-In)

The website uses Discord OAuth to let users sign in. This requires configuring your Discord application with an OAuth2 redirect URI and getting a client secret.

### Step 1: Get your Client Secret

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your application (**MKey Tracker**, App ID: `1492613055975002263`)
3. In the left sidebar, click **OAuth2**
4. Under **Client information**, find **Client Secret**
   - If you haven't generated one yet, click **Reset Secret** and copy it
   - Save this value — you'll need it for the environment variable `DISCORD_CLIENT_SECRET`

### Step 2: Add the Redirect URI

On the same **OAuth2** page:

1. Scroll down to **Redirects**
2. Click **Add Redirect**
3. Enter: `https://mythicplustracker.com/api/auth/callback/discord`
4. Click **Save Changes**

This tells Discord where to send users after they authorize. The path must match exactly.

> **For local development**, also add: `http://localhost:3000/api/auth/callback/discord`

### Step 3: Generate a NextAuth Secret

NextAuth needs a random secret to encrypt session tokens. Generate one:

```bash
openssl rand -base64 32
```

Save this value — you'll need it for the `NEXTAUTH_SECRET` environment variable.

---

## 2. Event Channel (Bot Event Embeds)

When events are created on the website, the bot automatically posts an interactive embed (with Sign Up / Tentative / Decline buttons) to a Discord channel. You need to tell the bot which channel to use.

### Step 1: Create or choose a channel

In your Discord server, create a channel for events (e.g., `#events` or `#signups`), or use an existing one.

### Step 2: Get the Channel ID

1. In Discord, go to **User Settings** > **Advanced** > enable **Developer Mode**
2. Right-click the channel you want to use
3. Click **Copy Channel ID**

Save this value — you'll need it for the `DISCORD_EVENTS_CHANNEL_ID` environment variable.

### Step 3: Verify bot permissions

The bot needs these permissions in that channel:
- **Send Messages** — to post the event embed
- **Embed Links** — for the rich embed
- **Read Message History** — to edit the embed when signups change

These should already be granted if the bot has the standard permissions from when you added it.

---

## 3. Production Environment Variables

SSH into the Unraid server and update the production `.env` and `docker-compose.prod.yml`.

### Step 1: Update the .env file

```bash
ssh root@192.168.1.4
nano /mnt/user/appdata/mplus-platform/source/.env
```

Add these new variables (keep all existing variables):

```bash
# ─── Discord OAuth (for website sign-in) ─────────────────────
DISCORD_CLIENT_SECRET="<paste your client secret from Step 1.1>"
NEXTAUTH_SECRET="<paste your generated secret from Step 1.3>"
NEXTAUTH_URL="https://mythicplustracker.com"

# ─── Bot Event Channel ───────────────────────────────────────
DISCORD_EVENTS_CHANNEL_ID="<paste your channel ID from Step 2.2>"
```

### Step 2: Update docker-compose.prod.yml

The bot and web services need the new env vars passed through. Edit the compose file:

```bash
nano /mnt/user/appdata/mplus-platform/source/docker-compose.prod.yml
```

**Add to the `bot` service's `environment` section:**

```yaml
  bot:
    environment:
      # ... existing vars ...
      REDIS_URL: redis://mplus-platform-redis:6379
      DISCORD_EVENTS_CHANNEL_ID: ${DISCORD_EVENTS_CHANNEL_ID}
```

**Add to the `web` service's `environment` section:**

```yaml
  web:
    environment:
      # ... existing vars ...
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      DISCORD_CLIENT_SECRET: ${DISCORD_CLIENT_SECRET}
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: https://mythicplustracker.com
```

### Step 3: Rebuild and restart

```bash
cd /mnt/user/appdata/mplus-platform/source
docker compose -f docker-compose.prod.yml up -d --build bot web
```

### Step 4: Verify

1. **Website sign-in**: Go to https://mythicplustracker.com and click "Sign in" in the header. You should be redirected to Discord's authorization page. After authorizing, you'll be back on the site with your Discord avatar showing.

2. **Event creation**: While signed in, click "Create Event" in the header. Fill out the form and submit. The event should appear on the events page AND the bot should post an interactive embed in your configured Discord channel.

3. **Button signups**: In Discord, click "Sign Up" on the event embed. If you have characters linked (from using the companion app), you'll see a dropdown to select one. Otherwise, you'll get a manual entry form.

4. **Bot logs**: Check the bot started the Redis subscriber:
   ```bash
   docker logs mplus-bot 2>&1 | tail -20
   ```
   You should see: `Subscribed to Redis channel: mplus:bot-notifications`

---

## Summary of all new environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `DISCORD_CLIENT_SECRET` | .env | Discord OAuth client secret for website sign-in |
| `NEXTAUTH_SECRET` | .env | Encrypts NextAuth session tokens |
| `NEXTAUTH_URL` | web container | Public URL of the website (for OAuth callback) |
| `DISCORD_EVENTS_CHANNEL_ID` | .env + bot | Discord channel where event embeds are posted |
| `REDIS_URL` | bot container | Redis connection for pub/sub notifications |
| `DISCORD_CLIENT_ID` | web container | Already exists in .env, just needs passing to web |

---

## Feature behavior without configuration

If you skip some configuration, features degrade gracefully:

| Missing | What happens |
|---------|-------------|
| `DISCORD_CLIENT_SECRET` | "Sign in" button on website won't work (OAuth fails) |
| `NEXTAUTH_SECRET` | Sessions won't persist (logged out on every page load) |
| `DISCORD_EVENTS_CHANNEL_ID` | Bot skips Redis subscriber — events created on web won't auto-post to Discord (they still appear on the website) |
| `REDIS_URL` on bot | Same as above — no auto-posting |

All other features (button signups on existing embeds, auto-claim from companion app, leaderboards, profiles) work without any additional configuration.
