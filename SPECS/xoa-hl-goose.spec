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
Source4:        xoa-hl-run-read-chat.py
Source5:        xoa-hl-mcp-read-proxy.mjs
Source6:        xoa-hl-mcp-network.mjs
Source7:        xoa-hl-read-chat.recipe.json
Source8:        xoa-hl-LICENSE
Source9:        xoa-hl-create-vm.schema.json
Source10:       xoa-hl-proposals.py
Source11:       assistant-panel.mjs
Source12:       assistant-locales.mjs
Source13:       assistant-panel.css

%description
Pinned upstream goose CLI for experimental local XOA-HL assistant work.
Installed separately from the XOA-HL payload, disabled by default, without
models, credentials, a daemon or an automatic start action.

%package -n xoa-hl-assistant
Summary:        Disabled local read-only assistant entry point for XOA-HL
License:        AGPLv3
Requires:       xoa-hl-goose = %{version}-%{release}
Requires:       python3
Requires:       (nodejs >= 2:24 with nodejs < 2:25)

%description -n xoa-hl-assistant
Local operator entry point with a bounded read-only MCP proxy and explicit
goose Approve configuration. No model, MCP dependency, service or UI is
automatically installed or enabled. Complete local configuration is required.

%prep
%setup -q -c -T
# CI verifies Source0 against GOOSE_RUNTIME.json and validates archive members
# before rpmbuild. Extract only the expected regular executable.
tar -xjf %{SOURCE0} ./goose
cp %{SOURCE1} LICENSE
cp %{SOURCE8} PROJECT-LICENSE

%build
# Released musl executable: deliberately not rebuilt or downloaded by RPM scripts.

%install
install -D -m 755 goose %{buildroot}/usr/libexec/xoa-hl/goose
install -D -m 644 %{SOURCE2} %{buildroot}/usr/share/xoa-hl/goose/runtime.json
install -D -m 644 %{SOURCE3} %{buildroot}/etc/xoa-hl/assistant.json
install -D -m 755 %{SOURCE4} %{buildroot}/usr/libexec/xoa-hl/assistant/xoa-hl-run-read-chat.py
install -D -m 644 %{SOURCE5} %{buildroot}/usr/libexec/xoa-hl/assistant/xoa-hl-mcp-read-proxy.mjs
install -D -m 644 %{SOURCE6} %{buildroot}/usr/libexec/xoa-hl/assistant/xoa-hl-mcp-network.mjs
install -D -m 644 %{SOURCE7} %{buildroot}/usr/libexec/xoa-hl/assistant/xoa-hl-read-chat.recipe.json
install -D -m 644 %{SOURCE9} %{buildroot}/usr/libexec/xoa-hl/assistant/xoa-hl-create-vm.schema.json
install -D -m 644 %{SOURCE10} %{buildroot}/usr/libexec/xoa-hl/assistant/xoa-hl-proposals.py
install -D -m 644 %{SOURCE11} %{buildroot}/usr/share/xoa-hl/assistant-ui/panel.mjs
install -D -m 644 %{SOURCE12} %{buildroot}/usr/share/xoa-hl/assistant-ui/locales.mjs
install -D -m 644 %{SOURCE13} %{buildroot}/usr/share/xoa-hl/assistant-ui/panel.css

%files
%license LICENSE
/usr/libexec/xoa-hl/goose
/usr/share/xoa-hl/goose/runtime.json
%config(noreplace) /etc/xoa-hl/assistant.json

%files -n xoa-hl-assistant
%license PROJECT-LICENSE
/usr/libexec/xoa-hl/assistant
/usr/share/xoa-hl/assistant-ui
