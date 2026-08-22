# Vercel Deployment Guide

This Laravel 13 application can be deployed to Vercel Hobby using serverless functions.

## Prerequisites

- Vercel account
- Domain configured: `worms.markdarling.com`

## Required Environment Variables

Set these in the Vercel Dashboard (Settings → Environment Variables):

### Application
```
APP_NAME=Worms
APP_ENV=production
APP_DEBUG=false
APP_URL=https://worms.markdarling.com
APP_KEY=<generate with: php artisan key:generate --show>
```

### Database (Ephemeral SQLite)
```
DB_CONNECTION=sqlite
DB_DATABASE=/tmp/database.sqlite
```

> **Note**: SQLite database is stored in `/tmp` and will be cleared when the serverless function instance is recycled. Games will be lost on cold starts. This is acceptable for a POC.

### Session & Cache (Stateless)
```
SESSION_DRIVER=cookie
SESSION_LIFETIME=120
CACHE_STORE=array
QUEUE_CONNECTION=sync
```

### Logging
```
LOG_CHANNEL=stderr
LOG_LEVEL=info
```

### VAPID (WebPush)
```
VAPID_SUBJECT=mailto:your-email@example.com
VAPID_PUBLIC_KEY=<your-public-key>
VAPID_PRIVATE_KEY=<your-private-key>
```

Generate VAPID keys locally:
```bash
php artisan webpush:vapid
```

## Deployment

1. Install Vercel CLI: `npm i -g vercel`
2. Link project: `vercel link`
3. Set environment variables in dashboard
4. Deploy: `vercel --prod`

## Build Process

The deployment automatically runs:
1. `composer install --no-dev --optimize-autoloader --no-interaction`
2. `npm ci && npm run build`

This compiles Vite assets and optimizes the autoloader for production.

## Architecture

- **Runtime**: `vercel-php@0.7.4` (PHP 8.3)
- **Entry Point**: `api/index.php` (forwards to `public/index.php`)
- **Static Assets**: Served directly from `public/` (Vite builds, images)
- **Database**: Ephemeral SQLite in `/tmp` (auto-migrated on cold start)
- **Sessions**: Cookie-based (stateless)
- **Cache**: Array (in-memory, per-request)
- **Queue**: Sync (no background jobs)

## Testing Locally

The Vercel configuration doesn't affect local development. Continue using:

```bash
composer run setup
composer run dev
```

## Limitations (Hobby Tier)

- No persistent storage (games lost on instance recycle)
- 10-second function timeout
- 250MB function size limit
- Cold starts may take 2-3 seconds

## Test Plan

After deployment:

1. Visit `https://worms.markdarling.com`
2. Click "Create Game" in the lobby
3. Verify game is created and canvas loads
4. Confirm WebSocket/Push notifications work (if configured)
5. Check Vercel logs for errors
