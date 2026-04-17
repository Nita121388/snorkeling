#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/snorkeling' -a -e '/usr/bin/snorkeling' -a "`readlink '/usr/bin/snorkeling'`" != '/etc/alternatives/snorkeling' ]; then
        rm -f '/usr/bin/snorkeling'
    fi
    update-alternatives --install '/usr/bin/snorkeling' 'snorkeling' '/opt/Snorkeling/snorkeling' 100 || ln -sf '/opt/Snorkeling/snorkeling' '/usr/bin/snorkeling'
else
    ln -sf '/opt/Snorkeling/snorkeling' '/usr/bin/snorkeling'
fi

chmod 4755 '/opt/Snorkeling/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
