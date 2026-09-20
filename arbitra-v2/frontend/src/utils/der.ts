/**
 * Utility to parse an ASN.1 DER ECDSA signature into raw `r` and `s` integers.
 * EIP-7951 requires raw 32-byte R and S coordinates, but the WebAuthn API
 * returns an ASN.1 DER sequence.
 */
export function parseDERSignature(signature: Uint8Array): { r: Uint8Array, s: Uint8Array } {
    let offset = 0;
    
    // 0x30 is the ASN.1 Sequence tag
    if (signature[offset++] !== 0x30) {
        throw new Error("Invalid DER signature: not a sequence");
    }
    
    // Skip sequence length
    const seqLength = signature[offset++];
    
    // Parse 'r' integer
    // 0x02 is the ASN.1 Integer tag
    if (signature[offset++] !== 0x02) {
        throw new Error("Invalid DER signature: expected integer for r");
    }
    const rLength = signature[offset++];
    let r = signature.slice(offset, offset + rLength);
    offset += rLength;
    
    // Parse 's' integer
    if (signature[offset++] !== 0x02) {
        throw new Error("Invalid DER signature: expected integer for s");
    }
    const sLength = signature[offset++];
    let s = signature.slice(offset, offset + sLength);
    
    // DER encoding pads positive integers with 0x00 if the most significant bit is 1.
    // We must strip this padding to get the raw 32-byte integer.
    if (r.length === 33 && r[0] === 0x00) r = r.slice(1);
    if (s.length === 33 && s[0] === 0x00) s = s.slice(1);
    
    // EIP-7951 precompile expects exactly 32 bytes for R and S.
    // If the integer is smaller than 32 bytes (rare but mathematically possible), pad it.
    const padTo32Bytes = (arr: Uint8Array) => {
        if (arr.length === 32) return arr;
        if (arr.length > 32) throw new Error("Invalid coordinate length: > 32 bytes");
        
        const padded = new Uint8Array(32);
        padded.set(arr, 32 - arr.length); // Left-pad with zeros
        return padded;
    };
    
    return {
        r: padTo32Bytes(r),
        s: padTo32Bytes(s)
    };
}
