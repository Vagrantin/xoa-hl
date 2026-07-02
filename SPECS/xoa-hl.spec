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

systemctl daemon-reload
systemctl enable redis --now
systemctl enable xo-server

%preun
systemctl stop xo-server 2>/dev/null || true
systemctl disable xo-server 2>/dev/null || true

%postun
rm -rf /opt/xo
