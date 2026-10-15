#!/usr/bin/env bash

set -Eeuo pipefail

IPTABLES="${DOMOS_IPTABLES:-iptables}"
IP6TABLES="${DOMOS_IP6TABLES:-ip6tables}"
SYSTEMCTL="${DOMOS_SYSTEMCTL:-systemctl}"
IF_INET6="${DOMOS_IF_INET6:-/proc/net/if_inet6}"
BRIDGE_PREFIX="domos-c"
INSTALLED_PATH=/usr/local/sbin/domos-computer-egress
UNIT_PATH=/etc/systemd/system/domos-computer-egress.service

usage() {
  cat <<'EOF'
Usage: restrict-computer-egress.sh [--install|--apply|--check|--remove|--print]
Domos modifies Rakazo's firewall script. Copyright 2026 Rakazo contributors.
Apache-2.0; see deploy/NOTICE and deploy/licenses/rakazo.txt.
  (default)   apply the rules now and persist them across reboots via systemd
  --apply     apply the rules now only (used by the systemd unit)
  --check     verify the required rule prefixes without changing them
  --remove    delete the rules and the systemd unit
  --print     show the iptables commands without changing anything
EOF
}

blocked_destinations_v4() {
  cat <<'EOF'
0.0.0.0/8
10.0.0.0/8
100.64.0.0/10
127.0.0.0/8
169.254.0.0/16
172.16.0.0/12
192.0.0.0/24
192.168.0.0/16
198.18.0.0/15
224.0.0.0/4
240.0.0.0/4
EOF
}

blocked_destinations_v6() {
  cat <<'EOF'
::1/128
fc00::/7
fe80::/10
ff00::/8
EOF
}

egress_rules_v4() {
  local cidr
  while IFS= read -r cidr; do
    printf 'DOCKER-USER -i %s+ -d %s -j DROP\n' "$BRIDGE_PREFIX" "$cidr"
  done < <(blocked_destinations_v4)
  printf 'INPUT -i %s+ -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n' "$BRIDGE_PREFIX"
  printf 'INPUT -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
}

egress_rules_v6() {
  local cidr
  while IFS= read -r cidr; do
    printf 'DOCKER-USER -i %s+ -d %s -j DROP\n' "$BRIDGE_PREFIX" "$cidr"
  done < <(blocked_destinations_v6)
  printf 'INPUT -i %s+ -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT\n' "$BRIDGE_PREFIX"
  printf 'INPUT -i %s+ -j DROP\n' "$BRIDGE_PREFIX"
}

wait_for_docker_user() {
  local cmd="$1" deadline=$((SECONDS + 30))
  until "$cmd" -L DOCKER-USER -n >/dev/null 2>&1; do
    if ((SECONDS > deadline)); then
      echo "DOCKER-USER chain not present — is Docker running with the iptables backend?" >&2
      return 1
    fi
    sleep 1
  done
}

normalize_rule() {
  local spec="$1"
  local -a toks
  read -ra toks <<<"$spec"
  local in="" out="" dest="" jump="" ct="" extra="" i=0
  while ((i < ${#toks[@]})); do
    case "${toks[i]}" in
      -i) in="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      -o) out="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      -d) dest="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      -j) jump="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      --ctstate) ct="${toks[i + 1]:-}"; i=$((i + 2)) ;;
      *) extra+="${toks[i]} "; i=$((i + 1)) ;;
    esac
  done
  if [[ -n $ct ]]; then
    ct="$(printf '%s\n' "$ct" | tr ',' '\n' | LC_ALL=C sort | paste -sd, -)"
  fi
  printf 'in=%s out=%s dest=%s ct=%s jump=%s extra=%s' \
    "$in" "$out" "$dest" "$ct" "$jump" "${extra%" "}"
}

chain_has_prefix() {
  local cmd="$1" chain="$2"
  shift 2
  local -a wanted=("$@") current=()
  local line
  while IFS= read -r line; do
    [[ "$line" == "-A $chain "* ]] || continue
    current+=("${line#-A $chain }")
  done < <("$cmd" -S "$chain" 2>/dev/null || true)
  ((${#current[@]} >= ${#wanted[@]})) || return 1
  local i
  for ((i = 0; i < ${#wanted[@]}; i++)); do
    [[ "$(normalize_rule "${current[i]}")" == "$(normalize_rule "${wanted[i]}")" ]] || return 1
  done
}

delete_stale_below_prefix() {
  local cmd="$1" chain="$2"
  shift 2
  local -a wanted=("$@") lines=() stale=()
  local line i j norm prefix_len=${#wanted[@]}
  while IFS= read -r line; do
    [[ "$line" == "-A $chain "* ]] || continue
    lines+=("${line#-A "$chain" }")
  done < <("$cmd" -S "$chain" 2>/dev/null || true)
  for ((i = prefix_len; i < ${#lines[@]}; i++)); do
    norm="$(normalize_rule "${lines[i]}")"
    for ((j = 0; j < prefix_len; j++)); do
      if [[ "$norm" == "$(normalize_rule "${wanted[j]}")" ]]; then
        stale+=("$((i + 1))")
        break
      fi
    done
  done
  for ((i = ${#stale[@]} - 1; i >= 0; i--)); do
    "$cmd" -D "$chain" "${stale[i]}"
  done
}

apply_family() {
  local cmd="$1" rules=() line chain
  command -v "$cmd" >/dev/null 2>&1 || return 0
  wait_for_docker_user "$cmd"
  while IFS= read -r line; do rules+=("$line"); done < <("$2")
  local -a chain_names=()
  local seen=" "
  for line in "${rules[@]}"; do
    chain="${line%% *}"
    if [[ "$seen" != *" $chain "* ]]; then
      seen+="$chain "
      chain_names+=("$chain")
    fi
  done
  local rewrite=" "
  local chain_needs=0
  for chain in "${chain_names[@]}"; do
    local -a wanted=()
    for line in "${rules[@]}"; do
      [[ "${line%% *}" == "$chain" ]] || continue
      wanted+=("${line#* }")
    done
    if chain_has_prefix "$cmd" "$chain" "${wanted[@]}"; then
      continue
    fi
    rewrite+="$chain "
    chain_needs=1
  done
  if ((chain_needs == 0)); then
    return 0
  fi
  local i
  local -a args wanted=()
  for ((i = ${#rules[@]} - 1; i >= 0; i--)); do
    line="${rules[i]}"
    chain="${line%% *}"
    [[ "$rewrite" == *" $chain "* ]] || continue
    read -ra args <<<"${line#* }"
    "$cmd" -I "$chain" 1 "${args[@]}"
  done
  for chain in "${chain_names[@]}"; do
    [[ "$rewrite" == *" $chain "* ]] || continue
    wanted=()
    for line in "${rules[@]}"; do
      [[ "${line%% *}" == "$chain" ]] || continue
      wanted+=("${line#* }")
    done
    delete_stale_below_prefix "$cmd" "$chain" "${wanted[@]}"
  done
}

remove_family() {
  local cmd="$1" line
  command -v "$cmd" >/dev/null 2>&1 || return 0
  while IFS= read -r line; do
    local -a args
    read -ra args <<<"$line"
    while "$cmd" -C "${args[@]}" 2>/dev/null; do
      "$cmd" -D "${args[@]}"
    done
  done < <("$2")
}

apply_rules() {
  if ! command -v "$IPTABLES" >/dev/null 2>&1; then
    echo "$IPTABLES not found — restricted egress needs the iptables firewall backend." >&2
    exit 1
  fi
  apply_family "$IPTABLES" egress_rules_v4
  if ! command -v "$IP6TABLES" >/dev/null 2>&1; then
    if host_has_ipv6; then
      echo "$IP6TABLES not found but the host has global IPv6 — computers would" >&2
      echo "keep unrestricted IPv6 egress. Install ip6tables or disable IPv6." >&2
      exit 1
    fi
  elif "$IP6TABLES" -L DOCKER-USER -n >/dev/null 2>&1 ||
    { host_has_ipv6 && wait_for_docker_user "$IP6TABLES"; }; then
    apply_family "$IP6TABLES" egress_rules_v6
  elif host_has_ipv6; then
    echo "$IP6TABLES DOCKER-USER is unavailable but the host has global IPv6 —" >&2
    echo "computers would keep unrestricted IPv6 egress. Start Docker first (it" >&2
    echo "creates the chain) or disable IPv6, then re-run." >&2
    exit 1
  fi
}

host_has_ipv6() {
  [[ -f $IF_INET6 ]] && awk '$4 == "00" { found = 1 } END { exit !found }' "$IF_INET6"
}

print_family() {
  local cmd="$1" rules=() line i
  command -v "$cmd" >/dev/null 2>&1 || return 0
  while IFS= read -r line; do rules+=("$line"); done < <("$2")
  for ((i = ${#rules[@]} - 1; i >= 0; i--)); do
    line="${rules[i]}"
    printf '%s -I %s 1 %s\n' "$cmd" "${line%% *}" "${line#* }"
  done
}

require_root() {
  if ((EUID == 0)); then return 0; fi
  if [[ "${DOMOS_EGRESS_SUDOED:-}" == "1" ]]; then
    echo "root privileges required" >&2
    exit 1
  fi
  export DOMOS_EGRESS_SUDOED=1
  exec sudo --preserve-env=DOMOS_EGRESS_SUDOED bash "$0" "$@"
}

install_persistence() {
  if ! command -v "$SYSTEMCTL" >/dev/null 2>&1; then
    echo "systemd not found; rules apply until reboot — re-run this script after one." >&2
    return 0
  fi
  if [[ "$0" == "bash" || "$0" == "-bash" || ! -f "$0" ]]; then
    echo "Run from a saved file to enable reboot persistence; rules were applied anyway." >&2
    return 0
  fi
  if [[ "$(readlink -f "$0")" != "$INSTALLED_PATH" ]]; then
    install -m 0755 "$0" "$INSTALLED_PATH"
  fi
  cat >"$UNIT_PATH" <<EOF
[Unit]
Description=Restrict Domos bot-computer egress (domos-c* bridges)
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$INSTALLED_PATH --apply

[Install]
WantedBy=multi-user.target
EOF
  "$SYSTEMCTL" daemon-reload
  "$SYSTEMCTL" enable domos-computer-egress.service
}

remove_persistence() {
  if command -v "$SYSTEMCTL" >/dev/null 2>&1 && [[ -f "$UNIT_PATH" ]]; then
    "$SYSTEMCTL" disable --now domos-computer-egress.service || true
    rm -f "$UNIT_PATH"
    "$SYSTEMCTL" daemon-reload
  fi
  rm -f "$INSTALLED_PATH"
}

check_family() {
  local cmd="$1" line chain
  command -v "$cmd" >/dev/null 2>&1 || return 1
  for chain in DOCKER-USER INPUT; do
    local -a wanted=()
    while IFS= read -r line; do
      [[ "${line%% *}" == "$chain" ]] || continue
      wanted+=("${line#* }")
    done < <("$2")
    chain_has_prefix "$cmd" "$chain" "${wanted[@]}" || return 1
  done
}

check_rules() {
  check_family "$IPTABLES" egress_rules_v4
  if host_has_ipv6; then check_family "$IP6TABLES" egress_rules_v6; fi
}

mode="${1:---install}"
case "$mode" in
  --check)
    check_rules
    ;;
  --install)
    require_root "$@"
    apply_rules
    install_persistence
    echo "Computer egress restricted: domos-c* bridges drop non-public and host-bound traffic."
    ;;
  --apply)
    apply_rules
    ;;
  --remove)
    require_root "$@"
    remove_family "$IPTABLES" egress_rules_v4
    remove_family "$IP6TABLES" egress_rules_v6
    remove_persistence
    echo "Computer egress rules and persistence removed."
    ;;
  --print)
    print_family "$IPTABLES" egress_rules_v4
    print_family "$IP6TABLES" egress_rules_v6
    ;;
  -h | --help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
