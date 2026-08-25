#!/bin/sh
# Cron container: gọi endpoint đánh giá cuối ngày mỗi giờ (đúng cho mọi múi giờ user,
# vì /internal/evaluate idempotent theo timezone + cut-off của từng user).
apk add --no-cache curl >/dev/null 2>&1
echo "5 * * * * curl -s -X POST http://app:3000/api/v1/internal/evaluate -H \"x-cron-secret: ${INTERNAL_CRON_SECRET}\" -o /dev/null" > /etc/crontabs/root
echo "[cron] scheduled hourly end-of-day evaluation"
crond -f -l 8
