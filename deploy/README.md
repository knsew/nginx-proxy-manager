# Deploying npm-mkcert

This folder deploys the fork image: Nginx Proxy Manager with a built-in
[mkcert](https://github.com/FiloSottile/mkcert) Local CA for internal networks.
The image is delivered as a tarball (it is not published to a registry).

## 1. Load the image

```bash
docker load -i npm-mkcert-2.17.1-mkcert1.tar.gz
docker images npm-mkcert
# npm-mkcert   2.17.1-mkcert1
```

## 2. Start it

```bash
cd deploy
docker compose up -d
docker compose logs -f
```

The compose file maps two folders only — no named volumes:

| Host folder | Container path | Contents |
| --- | --- | --- |
| `./data` | `/data` | NPM database, mkcert CA (`mkcert/`), leaf certificates (`custom_ssl/`) |
| `./letsencrypt` | `/etc/letsencrypt` | Let's Encrypt certificates |

Ports: `80` (HTTP), `443` (HTTPS), `81` (admin UI).

The Local CA is **not** created at container start. It is created lazily the
first time a Local CA certificate is requested, or when *Create Local CA* is
clicked on the Local CA page — either way it lands in `./data/mkcert/` and
survives container recreation and upgrades.

## 3. Log in and trust the root certificate

1. Open `http://<server-ip>:81` and log in with the default admin credentials
   (`admin@example.com` / `changeme`) — change them immediately.
2. Open the **Local CA** page, click *Create Local CA* if it does not exist yet.
3. Download `rootCA.pem` and check its SHA256 fingerprint against the one shown
   on the page.
4. Install the root certificate once on each device that will open your
   internal services. The Local CA page has per-platform instructions
   (Windows / macOS / Linux system import; iOS profile + full trust;
   Android user CA). After that, every certificate from this CA is trusted
   on the device.

## 4. Issue a certificate and verify

1. **SSL Certificates > Add SSL Certificate > Local CA (mkcert)**: enter a
   name, e.g. `nas.home.arpa` or `10.1.1.52`, and save. Or create a Proxy Host
   and pick *Request a new Local CA Certificate* in the SSL dropdown.
2. Point the host at an internal service and save.
3. From a device with the root installed, open `https://<name>` — the browser
   should show a valid padlock with no warning. `curl` on a machine with the
   root in its system store should also pass:
   ```bash
   curl -I https://nas.home.arpa
   ```
4. Check the certificate details in the browser: issuer is the Local CA,
   validity about 825 days.

## 5. Renewal and persistence

- Certificates renew automatically: an hourly timer re-issues any Local CA
  certificate expiring within 30 days, then reloads Nginx.
- Everything Local CA-related lives under `./data`. To move the instance,
  stop the container, copy `./data` (and `./letsencrypt` if you use Let's
  Encrypt), and start it on the new host — the CA and all certificates come
  along. **Back up `./data`: the CA private key lives there and cannot be
  recovered if lost.**

## Upgrading

Load the new tarball, update the `image:` tag in `docker-compose.yml`,
then `docker compose up -d`. The `/data` volume is untouched, so the CA,
database and certificates carry over.
