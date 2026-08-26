# Packaging

The package family has one entry tarball and one platform tarball per supported architecture. The entry package declares platform packages as optional dependencies, so npm selects only the current Linux CPU payload.

Platform tarballs contain static musl binaries with executable mode. Pack verification compares their bytes with the native workspace build and verifies the entry resolver. Linux file capability extended attributes are not representable in npm tarballs; packed verification therefore requires the installed binary to fail closed until deployment applies `setcap cap_sys_admin,cap_setpcap+ep`.

The entry tarball includes `src/pid-isolate-run.c`. No platform tarball or release workflow includes a fault-injection test binary.
