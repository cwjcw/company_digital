#!/usr/bin/env bash
# Read-only host scheduler inventory. Do not publish logs containing command arguments/secrets.
set -u
export SYSTEMD_PAGER=cat
echo '=== AUDIT DATE / HOST / TIMEZONE ==='
date -Is
hostname
timedatectl show -p Timezone --value 2>/dev/null || true
echo '=== SYSTEM TIMERS (all) ==='
systemctl list-timers --all --no-pager --no-legend 2>&1 || true
echo '=== USER TIMERS (all) ==='
systemctl --user list-timers --all --no-pager --no-legend 2>&1 || true
echo '=== TIMER UNIT FILES ==='
systemctl list-unit-files --type=timer --no-pager --no-legend 2>&1 || true
systemctl --user list-unit-files --type=timer --no-pager --no-legend 2>&1 || true
echo '=== USER LINGER ==='
loginctl show-user "$(id -un)" -p Linger 2>&1 || true
echo '=== CRON COUNTS ONLY (NO RAW CONTENT) ==='
if command -v crontab >/dev/null; then
  current_cron="$(crontab -l 2>/dev/null || true)"
  printf 'current_user_noncomment_entries=%s\n' "$(printf '%s\n' "$current_cron" | grep -Ec '^[[:space:]]*[^#[:space:]]' || true)"
fi
for dir in /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly; do
 if [[ -d "$dir" ]]; then
  printf '%s file_count=' "$dir"
  find "$dir" -maxdepth 1 -type f 2>/dev/null | wc -l
 fi
done
if [[ -f /etc/crontab ]]; then printf 'system_crontab=present (contents redacted)\n'; fi
echo '=== COMPOSE SERVICES (NO ENVIRONMENT OR LOGS) ==='
if command -v docker >/dev/null; then
 docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>&1 || true
fi
echo '=== KDOS KNOWN UNITS (state only) ==='
for unit in kdos-finance-customer-sync.timer kdos-wecom-contact-sync.timer 'kdos-erp-order-sync@e10-main.timer' 'kdos-erp-order-sync@tplus-kainan.timer' 'kdos-erp-order-sync@tplus-kejia.timer' 'kdos-erp-projection@sales-orders-v1.timer' 'kdos-erp-projection@finished-goods-inbound-v1.timer' 'kdos-erp-projection@finished-goods-outbound-v1.timer' dwg-index-update.timer; do
 printf '%s USER=' "$unit"
 systemctl --user is-enabled "$unit" 2>/dev/null || true
 printf '%s SYSTEM=' "$unit"
 systemctl is-enabled "$unit" 2>/dev/null || true
done
echo '=== NOTE ==='
echo 'n8n workflows and application-internal schedulers require separate UI/API/runtime inspection.'
echo 'Do not share unrestricted journalctl, systemctl cat, crontab contents or environment files; they may contain credentials.'
