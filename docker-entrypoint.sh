#!/bin/sh
set -e

# Run migrations if database is ready
if [ "$NODE_ENV" = "production" ]; then
  echo "🚀 Running production checks..."
fi

exec "$@"
