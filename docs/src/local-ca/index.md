---
outline: deep
---

# Local CA (mkcert)

> This page documents a feature added by this fork. It does not exist in upstream
> Nginx Proxy Manager.

The Local CA lets a single Nginx Proxy Manager container issue trusted HTTPS
certificates for services on your internal network: private hostnames
(`nas.home.arpa`), wildcards (`*.home.arpa`), and IP addresses (`10.1.1.52`)
— names a public certificate authority will never sign.

It works by running [mkcert](https://github.com/FiloSottile/mkcert) inside the
container. The container generates its own root certificate authority (CA) on
first use, stores it in the `/data` volume, and signs leaf certificates with it.
Leaf certificates are valid for about 825 days and renew automatically, using
the same hourly timer as Let's Encrypt certificates (renewal starts 30 days
before expiry, followed by an Nginx reload).

The Let's Encrypt provider is unchanged. Each certificate picks its own
provider, so public and internal certificates can live side by side in one
instance.

## One manual step: trust the root certificate

A private CA is trusted by no device until its root certificate is installed.
This is a one-time manual step per device — it cannot be automated, because
trust is exactly what a root certificate grants.

1. Open the **Local CA** page in the admin UI.
2. Download `rootCA.pem` and check its SHA256 fingerprint against the one shown
   on the page.
3. Install it on each device that will open your internal services:
   - **Windows**: double-click the file, install into the *Trusted Root
     Certification Authorities* store (Local Machine). Chrome and Edge use the
     Windows store; Firefox has its own store.
   - **macOS**: open the file to add it to the login keychain, then set it to
     *Always Trust* for SSL in Keychain Access. Chrome and Safari use the
     system keychain; Firefox has its own store.
   - **Linux**: copy it to `/usr/local/share/ca-certificates/rootCA.crt` and run
     `sudo update-ca-certificates` (Debian/Ubuntu). Firefox has its own store.
   - **iOS / iPadOS**: open the file on the device, install the profile, then
     enable full trust under *Settings > General > About > Certificate Trust
     Settings*.
   - **Android**: *Settings > Security > Install a certificate > CA
     certificate*. Chrome trusts user-installed CAs, but most apps do not —
     an app only trusts them if its network security config opts in.

After the root is installed, every certificate this CA signs is trusted on that
device until the root itself expires (10 years from creation).

## Requesting a certificate

Two ways, both from the admin UI:

- **SSL Certificates > Add SSL Certificate > Local CA (mkcert)**: enter one or
  more names — hostnames, wildcards and IP addresses can be combined on a
  single certificate.
- **When creating or editing a host**: pick *Request a new Local CA
  Certificate* in the SSL Certificate dropdown. The certificate is issued for
  the host's domain names automatically.

Certificates issued by the Local CA are listed with provider *Local CA
(mkcert)*. They can be renewed, downloaded and deleted like any other
certificate. Deleting a certificate removes only its leaf files; the CA itself
is never deleted from the UI.

## Where things live

All Local CA state is inside the `/data` volume, so it survives container
recreation and upgrades:

| Path | Contents |
| --- | --- |
| `/data/mkcert/rootCA.pem` | The public root certificate (downloadable from the UI) |
| `/data/mkcert/rootCA-key.pem` | The CA private key — **never leaves this volume** |
| `/data/custom_ssl/npm-{id}/` | Leaf certificate and key for certificate `{id}` |

The CA is created lazily: the first time a Local CA certificate is requested,
or when *Create Local CA* is clicked on the Local CA page. The private key is
stored with mode `600` and is never served by the API.

## Security notes

- **Back up the `/data` volume.** Losing `rootCA-key.pem` means the CA is gone:
  existing certificates keep working until they expire, but no new
  certificates can be issued and every device needs the new root installed.
- **Protect the key.** Anyone holding `rootCA-key.pem` can impersonate any site
  the CA is trusted for. Do not copy it off the server, and do not share the
  `/data` volume with untrusted containers.
- The root certificate is valid for 10 years. When it is eventually replaced,
  every device must trust the new root again — plan for that as a one-time
  event, not a silent rotation.
- Certificates from this CA are only meaningful inside networks where the root
  is installed. They are not a substitute for a public certificate on anything
  reachable from the internet.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `MKCERT_CAROOT` | `/data/mkcert` | Directory holding the root CA |
| `MKCERT_BIN` | `mkcert` | Path to the mkcert binary |
| `NPM_DATA_DIR` | `/data` | Data directory (also used for leaf certificates) |
