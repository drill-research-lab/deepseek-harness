# @deepseek-ai/dsh-auth-ldap

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Provides `ctx.ldapDirectory` for an authentication gateway process. It searches users with a restricted service account and verifies a submitted password through an LDAPS user bind. DSH does not load this package, and this package never creates or modifies LDAP entries.

The default credential references are `LDAP_URL`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USER_SEARCH_FILTER`, `LDAP_USER_ID_ATTRIBUTE`, and `LDAP_USERNAME_ATTRIBUTE`. `LDAP_URL` must use `ldaps://`. The service account needs only the read/search access required for login.

LDAP identities use the configured immutable attribute as `ldap:<id>` for their DSH `userId`.

LDAP operations and connection establishment time out after ten seconds by default. The LDAPS client offers compact standard ECDHE key shares to remain compatible with constrained WireGuard MTUs while retaining certificate verification. Supply an internal CA to the gateway process at startup with `NODE_EXTRA_CA_CERTS`; never give LDAP or CA private keys to DSH.

## Model Experience

None, as this package runs outside DSH and produces only a verified identity assertion for the gateway.

#### KV Cache effect

None; LDAP credentials and attributes never enter a model request.

## Known Limitations and Deferred Work

- Password expiry, LDAP password changes, and directory provisioning remain external LDAP-administration responsibilities.
