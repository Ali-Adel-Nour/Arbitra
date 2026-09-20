import { decode } from 'cbor-x';

/**
 * Parses a COSE formatted public key from a WebAuthn authenticator
 * and extracts the uncompressed P-256 `X` and `Y` coordinates.
 */
export function extractP256Coordinates(coseKeyBuffer: Uint8Array): { x: string, y: string } {
    // Decode the CBOR encoded COSE map
    const decoded = decode(coseKeyBuffer);
    
    // In the COSE specification (RFC 8152):
    // -2: the X coordinate
    // -3: the Y coordinate
    // These keys might be retrieved using Map.get() or object properties depending on the decoder output.
    const xBuffer = (decoded instanceof Map) ? decoded.get(-2) : decoded[-2];
    const yBuffer = (decoded instanceof Map) ? decoded.get(-3) : decoded[-3];
    
    if (!xBuffer || !yBuffer) {
        throw new Error("Invalid COSE key: Missing X or Y coordinate. Ensure this is an ES256/P256 key.");
    }
    
    // EIP-7951 expects hex strings (bytes32) prefixed with 0x
    const bufferToHex = (buf: Uint8Array) => '0x' + Buffer.from(buf).toString('hex');
    
    return {
        x: bufferToHex(xBuffer),
        y: bufferToHex(yBuffer)
    };
}
