export function utf8Prefix(bytes, limit) {
  let end = Math.max(0, Math.min(bytes.length, Math.floor(limit)));
  while (
    end > 0 &&
    end < bytes.length &&
    (bytes.readUInt8(end) & 0xc0) === 0x80
  )
    end--;
  return bytes.subarray(0, end).toString("utf8");
}

export function textPage(value, offset, limit) {
  const bytes = Buffer.from(value);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > bytes.length ||
    (offset < bytes.length && (bytes.readUInt8(offset) & 0xc0) === 0x80)
  )
    throw new Error("文本偏移无效。");
  const text = utf8Prefix(bytes.subarray(offset), limit);
  const next = offset + Buffer.byteLength(text);
  return {
    offset,
    nextOffset: next < bytes.length ? next : null,
    totalBytes: bytes.length,
    encoding: "utf8",
    text,
  };
}
