Name:           xoa-hl
Version:        %{_version}
Release:        1%{?dist}
Summary:        Xen Orchestra HomeLab Edition
License:        AGPLv3
URL:            https://github.com/Vagrantin/xoa-hl
BuildArch:      noarch
Requires:       nodejs >= 24, redis, ntfs-3g, nfs-utils, cifs-utils, lvm2, curl

%description
Thin package that downloads and installs the pre-built Xen Orchestra
HomeLab Edition tarball from GitHub Releases.

%install
mkdir -p %{buildroot}/usr/lib/systemd/system
install -m 644 %{_sourcedir}/xo-server.service %{buildroot}/usr/lib/systemd/system/

%files
/usr/lib/systemd/system/xo-server.service

%post
TARBALL_URL="https://github.com/Vagrantin/xoa-hl/releases/download/v%{version}/xoa-hl-%{version}.tar.gz"
mkdir -p /opt/xo
curl -fsSL "$TARBALL_URL" -o /tmp/xoa-hl.tar.gz
tar xzf /tmp/xoa-hl.tar.gz -C /opt/xo --strip-components=1
rm -f /tmp/xoa-hl.tar.gz

# Bootstrap xo-server user config on first install.
# xo-server reads ~/.config/xo-server/config.toml (via app-conf XDG lookup),
# which overrides any package-level config.toml. Without this file, the XO5
# UI mount and Redis URI are not applied regardless of what's in the tarball.
# On update the file is left untouched to preserve operator customisations.
if [ ! -f /root/.config/xo-server/config.toml ]; then
    mkdir -p /root/.config/xo-server
    cp /opt/xo/packages/xo-server/sample.config.toml \
       /root/.config/xo-server/config.toml
fi

# Expose xo-cli on PATH (mirrors ronivay convention)

ln -sfn /opt/xo/packages/xo-cli /opt/xo/xo-cli
ln -sfn /opt/xo/packages/xo-cli/index.mjs /usr/local/bin/xo-cli
chmod +x /opt/xo/packages/xo-cli/index.mjs

systemctl daemon-reload
systemctl enable redis --now
systemctl enable xo-server
systemctl start xo-server

%preun
systemctl stop xo-server 2>/dev/null || true
systemctl disable xo-server 2>/dev/null || true

%postun
rm -f /usr/local/bin/xo-cli
rm -rf /opt/xo
