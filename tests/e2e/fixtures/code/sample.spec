# RPM spec: preamble, macros, sections, changelog.
Name:           native-file-editor
Version:        0.1.0
Release:        1%{?dist}
Summary:        Native File Editor plugin for Obsidian
License:        GPL-3.0-only
URL:            https://github.com/maxkalem/obsidian-native-file-editor
Source0:        %{name}-%{version}.tar.gz
BuildArch:      noarch

%description
Opens text, code and Office files in Obsidian from their own bytes.

%prep
%autosetup

%install
mkdir -p %{buildroot}%{_datadir}/%{name}
install -m 644 main.js manifest.json styles.css %{buildroot}%{_datadir}/%{name}/

%files
%license LICENSE
%{_datadir}/%{name}

%changelog
* Thu Sep 04 2026 maxkalem - 0.1.0-1
- First internal build
