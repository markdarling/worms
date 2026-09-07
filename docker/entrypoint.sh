#!/bin/sh
# First-run + every-start housekeeping: SQLite file, writable dirs, migrations,
# and Laravel's compiled config/route/view caches (env is available now).
set -e
cd /var/www/html
mkdir -p /var/www/empty data \
  storage/framework/cache/data storage/framework/sessions storage/framework/views \
  storage/logs storage/app/public
[ -f data/database.sqlite ] || touch data/database.sqlite
chown -R www-data:www-data storage bootstrap/cache data
su -s /bin/sh www-data -c "php artisan migrate --force --no-interaction"
# Deliberately NOT route:cache: the compiled matcher trims the trailing slash
# from REQUEST_URI before matching, which under a sub-path (/worms/) makes
# Laravel lose its base URL and answer 405 for the lobby. ~20 routes, so
# registering them per request costs nothing measurable.
su -s /bin/sh www-data -c "php artisan route:clear --no-interaction"
su -s /bin/sh www-data -c "php artisan config:cache --no-interaction"
su -s /bin/sh www-data -c "php artisan view:cache --no-interaction"
su -s /bin/sh www-data -c "php artisan event:cache --no-interaction"
exec "$@"
