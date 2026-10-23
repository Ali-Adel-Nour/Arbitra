import { ethers } from "ethers";

/**
 * Deterministic JSON Canonicalizer
 * 
 * Rules:
 * 1. Object keys sorted by UTF-16 code units (ascending)
 * 2. Arrays preserve their exact element order
 * 3. Undefined object properties are omitted
 * 4. No whitespace around keys, colons, commas, or brackets
 * 5. Numbers cast to strings or validated
 */
export function canonicalize(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
        return `{${entries.join(",")}}`;
    }
    return value === undefined ? "null" : JSON.stringify(value);
}

/**
 * Computes Keccak-256 over UTF-8 bytes of the canonicalized JSON object.
 */
export function hashCanonicalValue(value: unknown): string {
    return ethers.keccak256(ethers.toUtf8Bytes(canonicalize(value)));
}
