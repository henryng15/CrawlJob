#!/usr/bin/env bash
# Disk selection in cloud-init (spec §17.8).
#
# The dangerous branch is "format", so the cases that matter are the ones that
# must not reach it. §17.8 forbids identifying a disk by a guessed device name;
# these tests are what make that a property rather than an intention.
#
#   bash infra/terraform/tests/test_mount_data_volume.sh
#
# Renders the template, then runs the extracted script against stub lsblk/blkid
# so every branch can be exercised without a second disk or root.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

python3 - "$HERE/../cloud-init.yaml.tftpl" "$WORK/mount.sh" <<'RENDER'
import re, sys, pathlib
raw = pathlib.Path(sys.argv[1]).read_text()
rendered = raw.replace("${app_user}", "internshipops").replace("${tailscale_auth_key}", "")
rendered = rendered.replace("$${", "${")
leftover = re.findall(r"(?<!\$)\$\{[a-z_]+\}", rendered)
assert not leftover, f"unsubstituted template variables: {leftover}"

# Pull the script out of write_files without a YAML library: the block is
# indented under a `content: |` key.
lines = rendered.splitlines()
start = next(i for i, line in enumerate(lines) if "mount-data-volume.sh" in line)
body, collecting = [], False
for line in lines[start:]:
    if line.strip().startswith("content: |"):
        collecting = True
        continue
    if collecting:
        if line and not line.startswith("      "):
            break
        body.append(line[6:])
pathlib.Path(sys.argv[2]).write_text("\n".join(body))
RENDER

bash -n "$WORK/mount.sh" || { echo "the rendered script is not valid bash"; exit 1; }

: > "$WORK/fstab"
sed "s#/etc/fstab#$WORK/fstab#g" "$WORK/mount.sh" > "$WORK/mount-testable.sh"
SCRIPT="$WORK/mount-testable.sh"
pass=0; fail=0

run_case() {
  local name="$1" lsblk_out="$2" blkid_type="$3" expect="$4"
  local bin; bin="$(mktemp -d)"

  cat > "$bin/lsblk" <<EOF
#!/usr/bin/env bash
# -no MOUNTPOINT /dev/X  -> per-disk mountpoint query
if [[ "\$*" == *"MOUNTPOINT /dev/"* ]]; then printf '\n'; exit 0; fi
if [[ "\$*" == *"PKNAME"* ]]; then echo "sda"; exit 0; fi
cat <<'ROWS'
$lsblk_out
ROWS
EOF
  cat > "$bin/findmnt" <<'EOF'
#!/usr/bin/env bash
echo /dev/sda1
EOF
  cat > "$bin/blkid" <<EOF
#!/usr/bin/env bash
if [[ "\$*" == *"-s TYPE"* ]]; then printf '%s' "$blkid_type"; exit 0; fi
if [[ "\$*" == *"-s UUID"* ]]; then echo "1111-2222"; exit 0; fi
EOF
  cat > "$bin/mkfs.ext4" <<'EOF'
#!/usr/bin/env bash
echo "FORMATTED $*" >> "$SPY"
EOF
  for stub in mkdir mount mountpoint install chmod grep; do :; done
  cat > "$bin/mountpoint" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  # /data and /etc/fstab are root-owned here; stub the writes so the test is
  # about which branch was taken, not about being root.
  cat > "$bin/mkdir" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$bin/chmod" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$bin/tee" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  cat > "$bin/install" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$bin"/*

  export SPY="$bin/spy"; : > "$SPY"
  # /etc/fstab and /data are not writable here; the script's writes are allowed
  # to fail, we only care about which branch it took.
  PATH="$bin:$PATH" bash "$SCRIPT" > "$bin/out" 2>&1
  local code=$?
  local got="ok"
  grep -q FORMATTED "$SPY" && got="formatted"
  [[ $code -ne 0 ]] && got="refused"
  grep -q "nothing to do" "$bin/out" && got="skipped"

  if [[ "$got" == "$expect" ]]; then
    echo "  PASS  $name -> $got"; pass=$((pass+1))
  else
    echo "  FAIL  $name -> $got (expected $expect)"; sed 's/^/        /' "$bin/out"; fail=$((fail+1))
  fi
  rm -rf "$bin"
}

echo "disk selection:"
run_case "empty disk is formatted" \
  "sda disk /
sdb disk " "" "formatted"

run_case "a disk with a filesystem is never formatted" \
  "sda disk /
sdb disk " "ext4" "ok"

run_case "two candidates: refuses to guess" \
  "sda disk /
sdb disk 
sdc disk " "" "refused"

run_case "no extra disk: nothing to do" \
  "sda disk /" "" "skipped"

echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
