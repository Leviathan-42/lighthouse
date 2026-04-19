# Media stack — zurg + rclone + Jellyfin

Standalone compose stack. Lives at `/opt/media/` on the Ubuntu host. Fed by
your Real-Debrid account via [zurg](https://github.com/debridmediamanager/zurg-testing),
mounted as a local filesystem via rclone, then served by Jellyfin.

## First-time install

```bash
# 1. Make the install dir and mount point
sudo mkdir -p /opt/media /mnt/zurg
sudo chown -R $USER:$USER /opt/media

# 2. Pull the configs from the Lighthouse repo
cp /opt/lighthouse/infra/media/compose.yml            /opt/media/
cp /opt/lighthouse/infra/media/zurg-config.example.yml /opt/media/zurg-config.yml
mkdir -p /opt/media/rclone-config
cp /opt/lighthouse/infra/media/rclone.conf            /opt/media/rclone-config/

# 3. Paste your Real-Debrid token into the zurg config
nano /opt/media/zurg-config.yml   # replace REPLACE_ME

# 4. Start it
cd /opt/media && docker compose up -d

# 5. Verify zurg warmed up and rclone mounted
docker compose logs -f zurg      # wait for "Zurg is ready"
ls /mnt/zurg                     # expect: shows  movies  __all__
```

## Finish Jellyfin setup

Point your browser at `http://<server-ip>:8096` (or over the tailnet once
`tailscale serve --set-path=/jellyfin http://127.0.0.1:8096` is set).

- Add Library → Shows → `/media/shows`
- Add Library → Movies → `/media/movies`
