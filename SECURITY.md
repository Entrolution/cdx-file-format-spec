# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this specification, please report it responsibly.

### For Specification Issues

If you find a security flaw in the specification itself (e.g., a cryptographic weakness, a design flaw that could be exploited), please:

1. **Do not** open a public issue
2. Email [greg.vonnessi@entrolution.ai](mailto:greg.vonnessi@entrolution.ai) with details
3. Allow reasonable time for the issue to be addressed before public disclosure

### For Implementation Issues

If you find a security issue in the reference implementation ([cdx-core](https://github.com/Entrolution/cdx-core)), please report it in that repository's security advisories.

## Scope

This security policy covers:

- The CDX specification
- JSON schemas in this repository
- Example documents in this repository

## Security Considerations in the Specification

The specification includes several security-relevant sections:

- **Security Model** (spec/core/11-security-model.md) - The consolidated map: attacker model, guarantees and non-guarantees, disclosed limitations, and the verifier-obligations index — start here
- **Document Hashing** (spec/core/06-document-hashing.md) - Content integrity
- **State Machine** (spec/core/07-state-machine.md) - Document lifecycle security
- **Security Extension** (spec/extensions/security/) - Signatures and encryption

When implementing the specification, pay particular attention to these sections.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
