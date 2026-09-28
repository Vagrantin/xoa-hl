# Payload is a huge node_modules tree: skip brp strip and bytecompile,
# they would take hours or fail outright.
%global __os_install_post %{nil}
%global debug_package %{nil}

Name:           xoa-hl
# Outranks pre-ce RPMs whose Release used the old run number. Permanent:
# an epoch can never be lowered again, which is intended here.
Epoch:          1
Version:        %{_version}
# CI passes _version, _release and _shortcommit via --define.
# _release is the tag's ce counter, g<shortcommit> the xoa-hl commit.
Release:        %{_release}.g%{_shortcommit}.xcpng8.3%{?dist}
Summary:        Xen Orchestra HomeLab Edition
License:        AGPLv3
URL:            https://github.com/Vagrantin/xoa-hl
# Not noarch: the shipped node_modules tree carries native addons (.node).
# No dependency scan of the shipped node_modules tree, deps are declared below.
AutoReqProv:    no
Requires:       (nodejs >= 24 with nodejs < 25)
Requires:       redis, ntfs-3g, nfs-utils, cifs-utils, lvm2, dnf-plugins-core

Source0:        xoa-hl-%{version}.tar.gz

%description
Xen Orchestra HomeLab Edition: the pre-built Xen Orchestra server and XO 5
web UI, shipped in the package and installed under /opt/xo.

%prep
%setup -q -n xen-orchestra

%install
mkdir -p %{buildroot}/opt/xo
cp -a . %{buildroot}/opt/xo/

# The config the appliance runs with references the TLS pair from /opt/xo.
mv %{buildroot}/opt/xo/packages/xo-server/xoahl.key %{buildroot}/opt/xo/
mv %{buildroot}/opt/xo/packages/xo-server/xoahl.crt %{buildroot}/opt/xo/
chmod 600 %{buildroot}/opt/xo/xoahl.key
chmod 644 %{buildroot}/opt/xo/xoahl.crt

chmod +x %{buildroot}/opt/xo/packages/xo-cli/index.mjs
ln -sfn /opt/xo/packages/xo-cli %{buildroot}/opt/xo/xo-cli
mkdir -p %{buildroot}/usr/local/bin
ln -sfn /opt/xo/packages/xo-cli/index.mjs %{buildroot}/usr/local/bin/xo-cli

mkdir -p %{buildroot}/usr/lib/systemd/system
install -m 644 %{_sourcedir}/xo-server.service %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/xoa-hl-check-update.service %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/xoa-hl-check-update.timer %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/xoa-hl-update.service %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/xoa-hl-auto-update.service %{buildroot}/usr/lib/systemd/system/
install -m 644 %{_sourcedir}/xoa-hl-auto-update.timer %{buildroot}/usr/lib/systemd/system/

mkdir -p %{buildroot}/etc/yum.repos.d
install -m 644 %{_sourcedir}/xoa-hl.repo %{buildroot}/etc/yum.repos.d/
mkdir -p %{buildroot}/usr/libexec/xoa-hl
install -m 755 %{_sourcedir}/xoa-hl-check-update.sh %{buildroot}/usr/libexec/xoa-hl/check-update.sh
install -m 755 %{_sourcedir}/xoa-hl-update.sh %{buildroot}/usr/libexec/xoa-hl/update.sh
install -m 755 %{_sourcedir}/xoa-hl-auto-update.sh %{buildroot}/usr/libexec/xoa-hl/auto-update.sh
install -m 755 %{_sourcedir}/xoa-hl-configure-updates.sh %{buildroot}/usr/libexec/xoa-hl/configure-updates.sh

mkdir -p %{buildroot}/etc/xoa-hl
install -m 644 %{_sourcedir}/xoa-hl-update.conf %{buildroot}/etc/xoa-hl/update.conf
mkdir -p %{buildroot}/etc/sudoers.d
install -m 440 %{_sourcedir}/xoa-hl.sudoers %{buildroot}/etc/sudoers.d/xoa-hl
visudo -cf %{buildroot}/etc/sudoers.d/xoa-hl

mkdir -p %{buildroot}/var/lib/xoa-hl
# Runtime files are touched only so RPM can own their %%ghost paths. Their
# contents are created by the scripts on the appliance, not packaged.
touch %{buildroot}/var/lib/xoa-hl/update.log
touch %{buildroot}/var/lib/xoa-hl/auto-update.status

%files
# /opt/xo covers the TLS pair too, the install section already set their modes.
/opt/xo
/usr/local/bin/xo-cli
/usr/lib/systemd/system/xo-server.service
/usr/lib/systemd/system/xoa-hl-check-update.service
/usr/lib/systemd/system/xoa-hl-check-update.timer
/usr/lib/systemd/system/xoa-hl-update.service
/usr/lib/systemd/system/xoa-hl-auto-update.service
/usr/lib/systemd/system/xoa-hl-auto-update.timer
/etc/yum.repos.d/xoa-hl.repo
/usr/libexec/xoa-hl
/etc/sudoers.d/xoa-hl
%dir /etc/xoa-hl
%config(noreplace) /etc/xoa-hl/update.conf
%dir /var/lib/xoa-hl
%ghost /var/lib/xoa-hl/update.log
%ghost /var/lib/xoa-hl/auto-update.status

%post
# Bootstrap xo-server user config on first install. On update the file is left
# untouched to preserve operator customisations.
if [ ! -f /root/.config/xo-server/config.toml ]; then
    mkdir -p /root/.config/xo-server
    cp /opt/xo/packages/xo-server/xoahl.config.toml \
       /root/.config/xo-server/config.toml
fi

systemctl daemon-reload
systemctl enable redis --now
systemctl enable xo-server
systemctl restart xo-server
# Both update timers intentionally remain disabled. An explicit configuration
# change is required before checks or installations become automatic.

%preun
# $1 = instances remaining after this action: 0 = final removal, 1 = upgrade.
if [ "$1" -eq 0 ]; then
    systemctl disable --now xoa-hl-check-update.timer xoa-hl-auto-update.timer 2>/dev/null || true
    systemctl stop xo-server 2>/dev/null || true
    systemctl disable xo-server 2>/dev/null || true
fi

%postun
# RPM owns the packaged files; only the systemd reload remains after erasure.
if [ "$1" -eq 0 ]; then
    systemctl daemon-reload 2>/dev/null || true
fi
