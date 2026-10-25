# Optional runtime only. No service is installed or enabled by this package.
%global debug_package %{nil}
%global __os_install_post %{nil}
%define _binary_payload w2.xzdio

Name:           xoa-hl-goose
Version:        1.56.0
Release:        1.xcpng8.3%{?dist}
Summary:        Optional pinned goose runtime for XOA-HL
License:        Apache-2.0
URL:            https://github.com/aaif-goose/goose
ExclusiveArch:  x86_64
AutoReqProv:    no
Requires:       xoa-hl
Source0:        goose-x86_64-unknown-linux-musl.tar.bz2
Source1:        goose-LICENSE
Source2:        GOOSE_RUNTIME.json
Source3:        xoa-hl-assistant.json

%description
Pinned upstream goose CLI for experimental local XOA-HL assistant work.
Installed separately from the XOA-HL payload, disabled by default, without
models, credentials, a daemon or an automatic start action.

%prep
%setup -q -c -T
# CI verifies Source0 against GOOSE_RUNTIME.json and validates archive members
# before rpmbuild. Extract only the expected regular executable.
tar -xjf %{SOURCE0} ./goose
cp %{SOURCE1} LICENSE

%build
# Released musl executable: deliberately not rebuilt or downloaded by RPM scripts.

%install
install -D -m 755 goose %{buildroot}/usr/libexec/xoa-hl/goose
install -D -m 644 %{SOURCE2} %{buildroot}/usr/share/xoa-hl/goose/runtime.json
install -D -m 644 %{SOURCE3} %{buildroot}/etc/xoa-hl/assistant.json

%files
%license LICENSE
/usr/libexec/xoa-hl/goose
/usr/share/xoa-hl/goose/runtime.json
%config(noreplace) /etc/xoa-hl/assistant.json
