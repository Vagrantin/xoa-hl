Name:           xoa-hl
Version:        %{_version}
Release:        %{_release}.xcpng8.3%{?dist}
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
install -m 644 %{_sourcedir}/xoa-hl-check-update.service %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/xoa-hl-update.service %{buildroot}/usr/lib/systemd/system/
mkdir -p %{buildroot}/etc/yum.repos.d
install -m 644 %{_sourcedir}/xoa-hl.repo %{buildroot}/etc/yum.repos.d/
mkdir -p %{buildroot}/usr/libexec/xoa-hl
install -m 755 %{_sourcedir}/xoa-hl-check-update.sh %{buildroot}/usr/libexec/xoa-hl/check-update.sh
install -m 755 %{_sourcedir}/xoa-hl-update.sh %{buildroot}/usr/libexec/xoa-hl/update.sh
mkdir -p %{buildroot}/etc/sudoers.d
install -m 440 %{_sourcedir}/xoa-hl.sudoers %{buildroot}/etc/sudoers.d/xoa-hl
visudo -cf %{buildroot}/etc/sudoers.d/xoa-hl

%files
/usr/lib/systemd/system/xo-server.service
/usr/lib/systemd/system/xoa-hl-check-update.service
/usr/lib/systemd/system/xoa-hl-update.service
/etc/yum.repos.d/xoa-hl.repo
/usr/libexec/xoa-hl
/etc/sudoers.d/xoa-hl

%post
# Stop any running instance before replacing /opt/xo (no-op on fresh install).
systemctl stop xo-server 2>/dev/null || true

TARBALL_URL="https://github.com/Vagrantin/xoa-hl/releases/download/v%{version}/xoa-hl-%{version}.tar.gz"
rm -rf /opt/xo
mkdir -p /opt/xo
curl -fsSL "$TARBALL_URL" -o /tmp/xoa-hl.tar.gz
tar xzf /tmp/xoa-hl.tar.gz -C /opt/xo --strip-components=1
rm -f /tmp/xoa-hl.tar.gz
mv /opt/xo/packages/xo-server/xoahl.key /opt/xo/
mv /opt/xo/packages/xo-server/xoahl.crt /opt/xo/

# Bootstrap xo-server user config on first install.
# xo-server reads ~/.config/xo-server/config.toml (via app-conf XDG lookup),
# which overrides any package-level config.toml. Without this file, the XO5
# UI mount and Redis URI are not applied regardless of what's in the tarball.
# On update the file is left untouched to preserve operator customisations.
if [ ! -f /root/.config/xo-server/config.toml ]; then
    mkdir -p /root/.config/xo-server
    cp /opt/xo/packages/xo-server/xoahl.config.toml \
       /root/.config/xo-server/config.toml
fi

ln -sfn /opt/xo/packages/xo-cli /opt/xo/xo-cli
ln -sfn /opt/xo/packages/xo-cli/index.mjs /usr/local/bin/xo-cli
chmod +x /opt/xo/packages/xo-cli/index.mjs

systemctl daemon-reload
systemctl enable redis --now
systemctl enable xo-server
systemctl restart xo-server

%preun
# $1 = instances remaining after this action: 0 = final removal, 1 = upgrade.
# Skip on upgrade so we don't stop the service the new %post just started.
if [ "$1" -eq 0 ]; then
    systemctl stop xo-server 2>/dev/null || true
    systemctl disable xo-server 2>/dev/null || true
fi

%postun
# Same upgrade guard as %preun: only wipe files on final removal.
if [ "$1" -eq 0 ]; then
    rm -f /usr/local/bin/xo-cli
    rm -rf /opt/xo
    rm -f /etc/sudoers.d/xoa-hl
    rm -rf /usr/libexec/xoa-hl
fi
