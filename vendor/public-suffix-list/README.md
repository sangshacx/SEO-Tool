# Pinned Public Suffix List

`openjdk-public_suffix_list.dat` is the complete Public Suffix List archive
shipped by Ubuntu package `openjdk-17-jre-headless 17.0.20+8-1~24.04`.

- Upstream data project: https://publicsuffix.org/list/
- Upstream repository: https://github.com/publicsuffix/list
- Source package format: OpenJDK `public_suffix_list.dat` ZIP archive
- Source SHA-256: `16b42002aa6f83a7763c4cdbd399ecf738460377d447e362884495545afd60a3`
- Generated module SHA-256: `fd1b926ccd2149a934f5ebeb8b4111ab523b91b6de716fddf1e8385b9bf3784d`
- Policy: both the ICANN section (`0x00`) and PRIVATE section (`0x01`) are enabled
- License: Mozilla Public License 2.0; see `LICENSE`

Regenerate the checked-in Worker module with:

```sh
python3 scripts/generate-public-suffix-list.py
```

Verify that it is deterministic and current with:

```sh
python3 scripts/generate-public-suffix-list.py --check
```

The Worker imports only the generated JavaScript module. It performs no
runtime network or filesystem access.
