"""Network safety checks: scheme allowlist and SSRF protection.

Every URL the crawler touches (including each redirect hop) passes through
`check_url`. Hosts that resolve to private, loopback, link-local, multicast,
reserved or cloud-metadata addresses are refused.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit

ALLOWED_SCHEMES = {"http", "https"}
ALLOWED_PORTS = {None, 80, 443, 8080, 8443}
MAX_URL_LENGTH = 2048


class UnsafeURLError(ValueError):
    """Raised when a URL is malformed or points somewhere we refuse to go."""


class UnresolvableHostError(UnsafeURLError):
    """Raised when DNS lookup fails (site unreachable rather than unsafe)."""


def normalize_url(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        raise UnsafeURLError("empty URL")
    if len(raw) > MAX_URL_LENGTH:
        raise UnsafeURLError("URL too long")
    if "://" not in raw:
        raw = "https://" + raw
    parts = urlsplit(raw)
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise UnsafeURLError(f"scheme '{scheme}' is not allowed (http/https only)")
    if parts.username or parts.password:
        raise UnsafeURLError("credentials in URLs are not allowed")
    host = (parts.hostname or "").lower().rstrip(".")
    if not host or any(c in host for c in " \t\r\n\\"):
        raise UnsafeURLError("missing or invalid host")
    try:
        port = parts.port
    except ValueError as exc:
        raise UnsafeURLError("invalid port") from exc
    if port not in ALLOWED_PORTS:
        raise UnsafeURLError(f"port {port} is not allowed")
    hostpart = f"[{host}]" if ":" in host else host
    netloc = hostpart if port is None else f"{hostpart}:{port}"
    path = parts.path or "/"
    return urlunsplit((scheme, netloc, path, parts.query, ""))


def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def resolve_public(host: str) -> list[str]:
    """Resolve host and ensure *every* address is public. Returns the IPs."""
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
        addrs = [literal]
    except ValueError:
        if host in {"localhost"} or host.endswith((".localhost", ".local", ".internal")):
            raise UnsafeURLError(f"host '{host}' is internal")
        try:
            infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise UnresolvableHostError(f"could not resolve host '{host}'") from exc
        addrs = [ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos]
    if not addrs:
        raise UnsafeURLError(f"host '{host}' has no addresses")
    for ip in addrs:
        if not _ip_is_public(ip):
            raise UnsafeURLError(f"host '{host}' resolves to a non-public address ({ip})")
    return [str(a) for a in addrs]


def check_url(raw: str) -> str:
    url = normalize_url(raw)
    resolve_public(urlsplit(url).hostname or "")
    return url
