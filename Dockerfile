# syntax=docker/dockerfile:1
# Worms: Armistice — single-container production image.
# Apache + mod_php 8.4 (the lock file needs >= 8.4), SQLite, assets built by Vite at image build.
# The app is served under the sub-path in docker/apache.conf (/worms) so that
# Laravel derives its base URL from SCRIPT_NAME and emits prefixed links.

FROM composer:2 AS vendor
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction --ignore-platform-reqs
COPY . .
RUN composer dump-autoload --no-dev --optimize --classmap-authoritative --no-scripts

FROM node:22-alpine AS assets
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts
COPY vite.config.js ./
COPY resources ./resources
COPY public ./public
RUN npm run build

FROM php:8.4-apache
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgmp-dev \
 && docker-php-ext-install -j"$(nproc)" bcmath gmp opcache \
 && php -m | grep -qi '^pdo_sqlite$' \
 && a2enmod rewrite headers \
 && rm -rf /var/lib/apt/lists/*
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY docker/php.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint
WORKDIR /var/www/html
COPY --from=vendor /app /var/www/html
COPY --from=assets /app/public/build /var/www/html/public/build
RUN php artisan package:discover --ansi \
 && chown -R www-data:www-data storage bootstrap/cache
ENTRYPOINT ["entrypoint"]
CMD ["apache2-foreground"]
